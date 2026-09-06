<?php

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Logger.php';

class EventRepository {

    private static array $columnsCache = [];

    public static function saveWebhook(
        string $platform,
        string $action,
        string $authStatus,
        array $payload,
        array $headers = [],
        ?string $propertyId = null
    ): ?int {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('webhooks');

            $propertyId = self::normalizePropertyId($propertyId ?? self::extractPropertyIdFromPayload($payload));

            $data = [
                'property_id' => $propertyId,
                'platform' => $platform,
                'action' => $action,
                'auth_status' => $authStatus,
                'method' => $_SERVER['REQUEST_METHOD'] ?? null,
                'remote_ip' => $_SERVER['REMOTE_ADDR'] ?? null,
                'delivery_id' => $_SERVER['HTTP_X_NVS_DELIVERY_ID'] ?? null,
                'source_event' => $payload['event'] ?? $payload['body']['event'] ?? null,
                'payload_json' => self::jsonEncode($payload),
                'headers_json' => self::jsonEncode($headers),
            ];

            $insert = self::filterDataByExistingColumns($pdo, $table, $data);

            $stmt = $pdo->prepare(self::buildInsertSql($table, $insert));
            $stmt->execute(self::buildParams($insert));

            return (int) $pdo->lastInsertId();

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'saveWebhook',
                'property_id' => $propertyId,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    public static function saveEvent(array $event): ?int {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('events');

            $params = $event['params'] ?? [];
            $context = $event['context'] ?? [];

            $propertyId = self::normalizePropertyId(
                $event['property_id']
                ?? $context['property_id']
                ?? null
            );

            $eventId = $event['event_id'] ?? uniqid('nvs_evt_', true);

            $data = [
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $event['event_name'] ?? null,
                'meta_event_name' => $event['meta_event_name'] ?? null,
                'source' => $event['source'] ?? null,
                'source_platform' => $event['source_platform'] ?? null,
                'event_time' => $event['event_time'] ?? null,
                'nvs_uid' => $context['nvs_uid'] ?? null,
                'nvs_sid' => $context['nvs_sid'] ?? null,
                'transaction_id' => $params['transaction_id'] ?? null,
                'value' => isset($params['value']) ? (float) $params['value'] : null,
                'currency' => $params['currency'] ?? null,
                'status' => $params['status'] ?? null,
                'event_json' => self::jsonEncode($event),
                'raw_payload_json' => self::jsonEncode($event['_source_raw'] ?? null),
            ];

            $insert = self::filterDataByExistingColumns($pdo, $table, $data);

            $stmt = $pdo->prepare(self::buildInsertSql($table, $insert, true));
            $stmt->execute(self::buildParams($insert));

            return (int) $pdo->lastInsertId();

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'saveEvent',
                'property_id' => $event['property_id'] ?? $event['context']['property_id'] ?? null,
                'event_id' => $event['event_id'] ?? null,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Mantido para chamadas existentes. Novo codigo deve usar
     * findSuccessfulDeliveryByEventId.
     */
    public static function findSuccessfulMetaDeliveryByEventId(
        string $eventId,
        ?string $propertyId = null
    ): ?array {
        return self::findSuccessfulDeliveryByEventId($eventId, $propertyId, 'meta');
    }

    /**
     * Procura entrega bem-sucedida do mesmo evento para o mesmo destino.
     *
     * A deduplicacao e por destino: o mesmo evento pode ter sido aceito pela Meta
     * e ainda nao ter chegado ao TikTok.
     *
     * Em Cores sem a coluna `destination`, nao existe como distinguir. Nesse caso
     * o destino Meta preserva o comportamento anterior, e os demais destinos nao
     * deduplicam: um reenvio e inofensivo, porque as plataformas deduplicam pelo
     * event_id do lado delas, enquanto suprimir o envio perderia a conversao em
     * silencio.
     */
    public static function findSuccessfulDeliveryByEventId(
        string $eventId,
        ?string $propertyId = null,
        string $destination = 'meta'
    ): ?array {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('meta_deliveries');

            $propertyId = self::normalizePropertyId($propertyId);

            $hasPropertyColumn = self::hasColumn($pdo, $table, 'property_id');
            $hasDestinationColumn = self::hasColumn($pdo, $table, 'destination');

            if (!$hasDestinationColumn && $destination !== 'meta') {
                return null;
            }

            $selectColumns = [
                'id',
                'event_id',
                'event_name',
                'meta_event_name',
                'mode',
                'sent',
                'ok',
                'http_code',
                'curl_error',
                'response_json',
                'created_at',
            ];

            if ($hasPropertyColumn) {
                array_splice($selectColumns, 1, 0, 'property_id');
            }

            if ($hasDestinationColumn) {
                $selectColumns[] = 'destination';
            }

            $sql = "
                SELECT " . implode(', ', array_map([self::class, 'q'], $selectColumns)) . "
                FROM " . self::q($table) . "
                WHERE event_id = :event_id
                  AND ok = 1
                  AND sent = 1
            ";

            $bind = [
                ':event_id' => $eventId,
            ];

            if ($hasPropertyColumn && $propertyId) {
                $sql .= "
                  AND (
                    property_id = :property_id
                    OR property_id IS NULL
                    OR property_id = ''
                  )
                ";

                $bind[':property_id'] = $propertyId;
            }

            if ($hasDestinationColumn) {
                // Entregas gravadas antes da coluna existir ficam com destination
                // vazio; para o destino Meta elas ainda contam como duplicata.
                $sql .= $destination === 'meta'
                    ? "
                  AND (
                    destination = :destination
                    OR destination IS NULL
                    OR destination = ''
                  )
                "
                    : "
                  AND destination = :destination
                ";

                $bind[':destination'] = $destination;
            }

            $sql .= "
                ORDER BY created_at DESC
                LIMIT 1
            ";

            $stmt = $pdo->prepare($sql);
            $stmt->execute($bind);

            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            return $row ?: null;

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'findSuccessfulDeliveryByEventId',
                'destination' => $destination,
                'event_id' => $eventId,
                'property_id' => $propertyId,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Mantido para chamadas existentes. Novo codigo deve usar saveDelivery.
     */
    public static function saveMetaDelivery(array $event, array $metaResult): ?int {
        return self::saveDelivery($event, $metaResult, 'meta');
    }

    /**
     * Grava uma tentativa de entrega em qualquer destino.
     *
     * A coluna `destination` nao existe em Cores instalados antes do suporte a
     * multiplos destinos. filterDataByExistingColumns a descarta silenciosamente
     * nesses casos, e a gravacao continua funcionando — apenas sem distinguir o
     * destino.
     */
    public static function saveDelivery(array $event, array $metaResult, string $destination = 'meta'): ?int {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('meta_deliveries');

            $context = $event['context'] ?? [];

            $propertyId = self::normalizePropertyId(
                $event['property_id']
                ?? $context['property_id']
                ?? null
            );

            $data = [
                'property_id' => $propertyId,
                'destination' => $destination,
                'event_id' => $event['event_id'] ?? null,
                'event_name' => $event['event_name'] ?? null,
                'meta_event_name' => $event['meta_event_name'] ?? null,
                'mode' => $metaResult['mode'] ?? null,
                'sent' => !empty($metaResult['sent']) ? 1 : 0,
                'ok' => !empty($metaResult['ok']) ? 1 : 0,
                'http_code' => $metaResult['http_code'] ?? null,
                'curl_error' => $metaResult['curl_error'] ?? null,
                'payload_json' => self::jsonEncode($metaResult['payload'] ?? null),
                'response_json' => self::jsonEncode($metaResult['response'] ?? $metaResult),
            ];

            $insert = self::filterDataByExistingColumns($pdo, $table, $data);

            $stmt = $pdo->prepare(self::buildInsertSql($table, $insert));
            $stmt->execute(self::buildParams($insert));

            return (int) $pdo->lastInsertId();

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'saveDelivery',
                'destination' => $destination,
                'property_id' => $event['property_id'] ?? $event['context']['property_id'] ?? null,
                'event_id' => $event['event_id'] ?? null,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    public static function extractPropertyIdFromPayload(array $payload): string {
        $body = $payload['body'] ?? $payload;

        if (isset($payload[0]['body']) && is_array($payload[0]['body'])) {
            $body = $payload[0]['body'];
        }

        $order = is_array($body['order'] ?? null) ? $body['order'] : [];
        $tracking = [];

        if (isset($body['tracking']) && is_array($body['tracking'])) {
            $tracking = $body['tracking'];
        } elseif (isset($order['tracking']) && is_array($order['tracking'])) {
            $tracking = $order['tracking'];
        }

        $direct = self::firstNonEmpty([
            $tracking['nvsPropertyId'] ?? null,
            $tracking['nvs_property_id'] ?? null,
            $tracking['propertyId'] ?? null,
            $tracking['property_id'] ?? null,
            $order['nvs_property_id'] ?? null,
            $order['property_id'] ?? null,
            $body['nvs_property_id'] ?? null,
            $body['property_id'] ?? null,
        ]);

        if ($direct) {
            return self::normalizePropertyId($direct);
        }

        $urls = [
            $tracking['checkoutUrl'] ?? null,
            $tracking['checkout_url'] ?? null,
            $tracking['landingUrl'] ?? null,
            $tracking['landing_url'] ?? null,
            $order['checkoutUrl'] ?? null,
            $order['checkout_url'] ?? null,
        ];

        foreach ($urls as $url) {
            $propertyFromUrl = self::propertyFromUrl($url);

            if ($propertyFromUrl) {
                return $propertyFromUrl;
            }
        }

        $nvsUid = self::firstNonEmpty([
            $tracking['nvsUid'] ?? null,
            $tracking['nvs_uid'] ?? null,
        ]);

        if ($nvsUid && preg_match('/^nvs_([a-z0-9_]+?)_[a-f0-9]{8,}$/i', $nvsUid, $matches)) {
            $candidate = strtolower($matches[1]);

            if ($candidate && $candidate !== 'uid') {
                return self::normalizePropertyId($candidate);
            }
        }

        return 'default';
    }

    public static function normalizePropertyId($propertyId): string {
        $propertyId = strtolower(trim((string) ($propertyId ?? '')));

        if ($propertyId === '') {
            return 'default';
        }

        $propertyId = preg_replace('/[^a-z0-9_]/', '_', $propertyId);
        $propertyId = preg_replace('/_+/', '_', $propertyId);
        $propertyId = trim($propertyId, '_');

        return $propertyId !== '' ? $propertyId : 'default';
    }

    private static function propertyFromUrl($url): ?string {
        if (!$url || !is_string($url)) {
            return null;
        }

        $query = parse_url($url, PHP_URL_QUERY);

        if (!$query) {
            return null;
        }

        parse_str($query, $params);

        $propertyId = self::firstNonEmpty([
            $params['nvs_property_id'] ?? null,
            $params['property_id'] ?? null,
            $params['nvsPropertyId'] ?? null,
        ]);

        return $propertyId ? self::normalizePropertyId($propertyId) : null;
    }

    private static function firstNonEmpty(array $values): ?string {
        foreach ($values as $value) {
            if ($value === null) {
                continue;
            }

            $value = trim((string) $value);

            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private static function filterDataByExistingColumns(PDO $pdo, string $table, array $data): array {
        $columns = self::columns($pdo, $table);
        $filtered = [];

        foreach ($data as $key => $value) {
            if (in_array($key, $columns, true)) {
                $filtered[$key] = $value;
            }
        }

        return $filtered;
    }

    private static function columns(PDO $pdo, string $table): array {
        if (isset(self::$columnsCache[$table])) {
            return self::$columnsCache[$table];
        }

        try {
            $stmt = $pdo->query("SHOW COLUMNS FROM " . self::q($table));
            $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];

            $columns = [];

            foreach ($rows as $row) {
                if (!empty($row['Field'])) {
                    $columns[] = $row['Field'];
                }
            }

            self::$columnsCache[$table] = $columns;

            return $columns;

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'columns',
                'table' => $table,
                'error' => $e->getMessage(),
            ]);

            self::$columnsCache[$table] = [];

            return [];
        }
    }

    private static function hasColumn(PDO $pdo, string $table, string $column): bool {
        return in_array($column, self::columns($pdo, $table), true);
    }

    private static function buildInsertSql(string $table, array $data, bool $upsert = false): string {
        $columns = array_keys($data);

        $quotedColumns = array_map([self::class, 'q'], $columns);
        $placeholders = array_map(fn ($column) => ':' . $column, $columns);

        $sql = "
            INSERT INTO " . self::q($table) . " (
                " . implode(",\n                ", $quotedColumns) . "
            ) VALUES (
                " . implode(",\n                ", $placeholders) . "
            )
        ";

        if ($upsert) {
            $updates = [];

            foreach ($columns as $column) {
                if ($column === 'event_id') {
                    continue;
                }

                $updates[] = self::q($column) . " = VALUES(" . self::q($column) . ")";
            }

            $updates[] = "id = LAST_INSERT_ID(id)";

            $sql .= "
                ON DUPLICATE KEY UPDATE
                    " . implode(",\n                    ", $updates) . "
            ";
        }

        return $sql;
    }

    private static function buildParams(array $data): array {
        $params = [];

        foreach ($data as $key => $value) {
            $params[':' . $key] = $value;
        }

        return $params;
    }

    private static function q(string $identifier): string {
        return '`' . str_replace('`', '``', $identifier) . '`';
    }

    private static function jsonEncode($data): ?string {
        if ($data === null) {
            return null;
        }

        return json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
    }
}