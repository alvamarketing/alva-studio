<?php

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/EventRepository.php';
require_once __DIR__ . '/MetaClient.php';
require_once __DIR__ . '/NvspayTranslator.php';

class WebhookRepairService
{
    private const MAX_WEBHOOKS = 20;

    public static function reprocessOrphanPurchases(
        array $repairs,
        string $propertyId,
        bool $sendMeta = false
    ): array
    {
        $propertyId = EventRepository::normalizePropertyId($propertyId);
        $expectedTransactions = self::normalizeRepairs($repairs);
        $webhookIds = array_keys($expectedTransactions);

        if (!$webhookIds) {
            throw new InvalidArgumentException('Provide at least one webhook id with its expected transaction id.');
        }

        if (count($webhookIds) > self::MAX_WEBHOOKS) {
            throw new InvalidArgumentException('Too many webhook ids.');
        }

        if ($propertyId === 'default') {
            throw new InvalidArgumentException('Target property must be explicit.');
        }

        $pdo = Database::getConnection();
        self::assertActiveProject($pdo, $propertyId);

        $webhookTable = Database::table('webhooks');
        $eventsTable = Database::table('events');
        $placeholders = implode(', ', array_fill(0, count($webhookIds), '?'));
        $eventsForMeta = [];
        $summary = [
            'requested' => count($webhookIds),
            'found' => 0,
            'reprocessed' => 0,
            'already_target' => 0,
            'skipped' => count($webhookIds),
            'send_meta' => $sendMeta,
            'meta_attempted' => 0,
            'meta_accepted' => 0,
            'meta_failed' => 0,
            'meta_already_successful' => 0,
            'meta_deliveries_created' => 0,
            'reasons' => [],
        ];

        $pdo->beginTransaction();

        try {
            $stmt = $pdo->prepare(
                'SELECT id, property_id, platform, action, payload_json'
                . ' FROM ' . self::q($webhookTable)
                . ' WHERE id IN (' . $placeholders . ')'
                . ' ORDER BY id ASC FOR UPDATE'
            );
            $stmt->execute($webhookIds);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $summary['found'] = count($rows);
            $summary['skipped'] = count($webhookIds) - count($rows);

            foreach ($rows as $row) {
                $reason = self::validateWebhookRow($row, $propertyId);

                if ($reason !== '') {
                    self::incrementReason($summary, $reason);
                    $summary['skipped']++;
                    continue;
                }

                $payload = json_decode((string) ($row['payload_json'] ?? ''), true);

                if (!is_array($payload)) {
                    self::incrementReason($summary, 'invalid_payload');
                    $summary['skipped']++;
                    continue;
                }

                $event = NvspayTranslator::translatePurchaseApproved($payload);

                if (!$event) {
                    self::incrementReason($summary, 'unsupported_purchase');
                    $summary['skipped']++;
                    continue;
                }

                $actualTransactionId = trim((string) ($event['params']['transaction_id'] ?? ''));
                $expectedTransactionId = $expectedTransactions[(int) $row['id']] ?? '';

                if ($actualTransactionId === '' || !hash_equals($expectedTransactionId, $actualTransactionId)) {
                    self::incrementReason($summary, 'transaction_mismatch');
                    $summary['skipped']++;
                    continue;
                }

                $event['property_id'] = $propertyId;
                $event['context'] = is_array($event['context'] ?? null) ? $event['context'] : [];
                $event['context']['property_id'] = $propertyId;
                $event['context']['nvs_property_id'] = $propertyId;

                if (!self::eventCanMoveToProperty($pdo, $eventsTable, (string) ($event['event_id'] ?? ''), $propertyId)) {
                    self::incrementReason($summary, 'event_property_conflict');
                    $summary['skipped']++;
                    continue;
                }

                if (!EventRepository::saveEvent($event)) {
                    throw new RuntimeException('Could not persist repaired purchase.');
                }

                $update = $pdo->prepare(
                    'UPDATE ' . self::q($webhookTable)
                    . ' SET property_id = :property_id WHERE id = :id LIMIT 1'
                );
                $update->execute([
                    ':property_id' => $propertyId,
                    ':id' => (int) $row['id'],
                ]);

                if (EventRepository::normalizePropertyId($row['property_id'] ?? null) === $propertyId) {
                    $summary['already_target']++;
                } else {
                    $summary['reprocessed']++;
                }

                $eventsForMeta[] = $event;
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }

        if ($sendMeta) {
            self::sendEventsToMeta($eventsForMeta, $propertyId, $summary);
        }

        return $summary;
    }

    private static function sendEventsToMeta(array $events, string $propertyId, array &$summary): void
    {
        foreach ($events as $event) {
            $eventId = trim((string) ($event['event_id'] ?? ''));
            $previous = $eventId !== ''
                ? EventRepository::findSuccessfulMetaDeliveryByEventId($eventId, $propertyId)
                : null;

            if ($previous) {
                $summary['meta_already_successful']++;
                continue;
            }

            $summary['meta_attempted']++;
            $metaResult = MetaClient::sendEvent($event);

            if (empty($metaResult['payload'])) {
                $metaResult['payload'] = MetaClient::buildPayload($event);
            }

            $deliveryId = EventRepository::saveMetaDelivery($event, $metaResult);

            if ($deliveryId) {
                $summary['meta_deliveries_created']++;
            } else {
                self::incrementReason($summary, 'meta_delivery_persist_failed');
            }

            if (!empty($metaResult['ok']) && !empty($metaResult['sent'])) {
                $summary['meta_accepted']++;
            } else {
                $summary['meta_failed']++;
                self::incrementReason(
                    $summary,
                    trim((string) ($metaResult['reason'] ?? '')) ?: 'meta_delivery_failed'
                );
            }
        }
    }

    private static function normalizeRepairs(array $repairs): array
    {
        $normalized = [];

        foreach ($repairs as $repair) {
            if (!is_array($repair)) {
                continue;
            }

            $id = (int) ($repair['webhook_id'] ?? 0);
            $transactionId = trim((string) ($repair['transaction_id'] ?? ''));

            if ($id > 0 && $transactionId !== '') {
                $normalized[$id] = $transactionId;
            }
        }

        return $normalized;
    }

    private static function assertActiveProject(PDO $pdo, string $propertyId): void
    {
        $table = Database::table('properties');
        $stmt = $pdo->prepare(
            'SELECT property_id, is_active FROM ' . self::q($table)
            . ' WHERE property_id = :property_id LIMIT 1'
        );
        $stmt->execute([':property_id' => $propertyId]);
        $project = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$project) {
            throw new DomainException('Target project was not found.');
        }

        if ((int) ($project['is_active'] ?? 0) !== 1) {
            throw new DomainException('Target project is inactive.');
        }
    }

    private static function validateWebhookRow(array $row, string $propertyId): string
    {
        if (strtolower(trim((string) ($row['platform'] ?? ''))) !== 'nvspay') {
            return 'invalid_platform';
        }

        if (strtolower(trim((string) ($row['action'] ?? ''))) !== 'purchase_approved') {
            return 'invalid_action';
        }

        $currentProperty = EventRepository::normalizePropertyId($row['property_id'] ?? null);

        if ($currentProperty !== 'default' && $currentProperty !== $propertyId) {
            return 'webhook_property_conflict';
        }

        return '';
    }

    private static function eventCanMoveToProperty(
        PDO $pdo,
        string $eventsTable,
        string $eventId,
        string $propertyId
    ): bool {
        if ($eventId === '') {
            return false;
        }

        $stmt = $pdo->prepare(
            'SELECT property_id FROM ' . self::q($eventsTable)
            . ' WHERE event_id = :event_id LIMIT 1'
        );
        $stmt->execute([':event_id' => $eventId]);
        $current = $stmt->fetchColumn();

        if ($current === false) {
            return true;
        }

        $currentProperty = EventRepository::normalizePropertyId($current);

        return $currentProperty === 'default' || $currentProperty === $propertyId;
    }

    private static function incrementReason(array &$summary, string $reason): void
    {
        $summary['reasons'][$reason] = (int) ($summary['reasons'][$reason] ?? 0) + 1;
    }

    private static function q(string $identifier): string
    {
        return '`' . str_replace('`', '``', $identifier) . '`';
    }
}
