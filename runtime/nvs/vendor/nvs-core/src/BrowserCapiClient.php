<?php

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Logger.php';
require_once __DIR__ . '/Settings.php';

class BrowserCapiClient {

    private const DEFAULT_ALLOWED_EVENTS = 'page_view,view_content,initiate_checkout,lead';

    public static function maybeSend(array $payload, array $serverContext = [], array $ingestResult = []): array {
        $eventName = self::cleanKey($payload['event_name'] ?? ($ingestResult['event_name'] ?? 'page_view'), 'page_view');
        $eventId = self::cleanString($payload['event_id'] ?? ($ingestResult['event_id'] ?? null), 190);
        $propertyId = self::cleanKey(
            $payload['property_id']
            ?? ($payload['context']['property_id'] ?? null)
            ?? ($ingestResult['property_id'] ?? null)
            ?? 'default',
            'default'
        );

        $metaEventName = self::mapMetaEventName($eventName);

        if (!$eventId) {
            return self::result(false, false, 'skipped', 'missing_event_id', null, null);
        }

        $property = self::getProperty($propertyId);

        if (!$property) {
            $result = self::result(false, false, 'property_missing', 'property_not_found', null, null);

            self::saveDelivery([
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $metaEventName,
                'mode' => 'property_missing',
                'sent' => false,
                'ok' => false,
                'http_code' => null,
                'payload' => null,
                'response' => $result,
                'error_message' => 'Property not found.',
                'curl_error' => null,
            ]);

            return $result;
        }

        if (!self::boolValue($property['is_active'] ?? 0)) {
            $result = self::result(true, false, 'disabled', 'property_inactive', null, null);

            self::saveDelivery([
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $metaEventName,
                'mode' => 'property_inactive',
                'sent' => false,
                'ok' => true,
                'http_code' => null,
                'payload' => null,
                'response' => $result,
                'error_message' => null,
                'curl_error' => null,
            ]);

            return $result;
        }

        if (!self::boolValue($property['browser_capi_enabled'] ?? 0)) {
            $result = self::result(true, false, 'disabled', 'browser_capi_disabled_for_property', null, null);

            self::saveDelivery([
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $metaEventName,
                'mode' => 'disabled',
                'sent' => false,
                'ok' => true,
                'http_code' => null,
                'payload' => null,
                'response' => $result,
                'error_message' => null,
                'curl_error' => null,
            ]);

            return $result;
        }

        if (!self::isAllowedEvent($eventName, $property)) {
            $result = self::result(true, false, 'skipped', 'event_not_allowed_for_property', null, null, [
                'event_name' => $eventName,
                'allowed_events' => self::allowedEvents($property),
            ]);

            self::saveDelivery([
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $metaEventName,
                'mode' => 'event_not_allowed',
                'sent' => false,
                'ok' => true,
                'http_code' => null,
                'payload' => null,
                'response' => $result,
                'error_message' => null,
                'curl_error' => null,
            ]);

            return $result;
        }

        $pixelId = trim((string) ($property['meta_pixel_id'] ?? ''));
        $accessToken = trim((string) ($property['meta_access_token'] ?? ''));
        $apiVersion = trim((string) ($property['meta_api_version'] ?? 'v19.0')) ?: 'v19.0';
        $testEventCode = trim((string) ($property['meta_test_event_code'] ?? ''));
        $debugMode = self::boolValue($property['debug_mode'] ?? 0);

        if ($pixelId === '' || $accessToken === '') {
            $result = self::result(false, false, 'config_missing', 'property_meta_pixel_or_token_missing', null, null);

            self::saveDelivery([
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $metaEventName,
                'mode' => 'config_missing',
                'sent' => false,
                'ok' => false,
                'http_code' => null,
                'payload' => null,
                'response' => $result,
                'error_message' => 'Property Meta Pixel ID or Access Token missing.',
                'curl_error' => null,
            ]);

            return $result;
        }

        if (self::hasSuccessfulDelivery($eventId, $propertyId)) {
            $result = self::result(true, false, 'deduped', 'already_sent_successfully', null, null);

            self::saveDelivery([
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $metaEventName,
                'mode' => 'deduped',
                'sent' => false,
                'ok' => true,
                'http_code' => null,
                'payload' => null,
                'response' => $result,
                'error_message' => null,
                'curl_error' => null,
            ]);

            return $result;
        }

        $metaPayload = self::buildMetaPayload($payload, $serverContext, $ingestResult, $metaEventName, $property);

        if ($testEventCode !== '') {
            $metaPayload['test_event_code'] = $testEventCode;
        }

        if ($debugMode) {
            $result = self::result(true, false, 'debug', 'property_debug_mode_enabled', null, [
                'debug_mode' => true,
            ]);

            self::saveDelivery([
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'event_name' => $metaEventName,
                'mode' => 'debug',
                'sent' => false,
                'ok' => true,
                'http_code' => null,
                'payload' => $metaPayload,
                'response' => $result,
                'error_message' => null,
                'curl_error' => null,
            ]);

            return $result;
        }

        $delivery = self::postToMeta($pixelId, $accessToken, $apiVersion, $metaPayload);

        self::saveDelivery([
            'property_id' => $propertyId,
            'event_id' => $eventId,
            'event_name' => $metaEventName,
            'mode' => 'live',
            'sent' => true,
            'ok' => (bool) ($delivery['ok'] ?? false),
            'http_code' => $delivery['http_code'] ?? null,
            'payload' => $metaPayload,
            'response' => $delivery['response'] ?? null,
            'error_message' => $delivery['error_message'] ?? null,
            'curl_error' => $delivery['curl_error'] ?? null,
        ]);

        return self::result(
            (bool) ($delivery['ok'] ?? false),
            true,
            'live',
            ($delivery['ok'] ?? false) ? null : 'meta_delivery_failed',
            $delivery['http_code'] ?? null,
            [
                'response' => $delivery['response'] ?? null,
                'curl_error' => $delivery['curl_error'] ?? null,
                'error_message' => $delivery['error_message'] ?? null,
            ]
        );
    }

    private static function getProperty(string $propertyId): ?array {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('properties');

            $stmt = $pdo->prepare("SELECT * FROM {$table} WHERE property_id = :property_id LIMIT 1");
            $stmt->execute([':property_id' => $propertyId]);

            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            return $row ?: null;
        } catch (Throwable $e) {
            Logger::write('browser-capi-property-error', [
                'property_id' => $propertyId,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private static function buildMetaPayload(array $payload, array $serverContext, array $ingestResult, string $metaEventName, array $property): array {
        $context = is_array($payload['context'] ?? null) ? $payload['context'] : [];
        $params = is_array($payload['params'] ?? null) ? $payload['params'] : [];
        $user = is_array($payload['user'] ?? null) ? $payload['user'] : [];

        $providerIds = self::extractProviderIds($payload, $context);

        $propertyId = self::cleanKey(
            $payload['property_id']
            ?? ($context['property_id'] ?? null)
            ?? ($property['property_id'] ?? null)
            ?? 'default',
            'default'
        );

        $nvsUid = self::cleanString(
            $payload['nvs_uid']
            ?? ($context['nvs_uid'] ?? null)
            ?? ($ingestResult['nvs_uid'] ?? null),
            190
        );

        $eventId = self::cleanString(
            $payload['event_id']
            ?? ($ingestResult['event_id'] ?? null),
            190
        );

        $eventTime = isset($payload['event_time']) && is_numeric($payload['event_time'])
            ? (int) $payload['event_time']
            : time();

        $pageUrl = self::cleanLongText(
            $payload['page_url']
            ?? ($context['page_url'] ?? null)
            ?? ($context['landing_url'] ?? null)
            ?? ($params['page_url'] ?? null)
        );

        $userData = [
            'client_ip_address' => self::cleanString($serverContext['ip_address'] ?? null, 120),
            'client_user_agent' => self::cleanLongText($serverContext['user_agent'] ?? null),
        ];

        if (!empty($providerIds['fbp'])) {
            $userData['fbp'] = self::cleanString($providerIds['fbp'], 190);
        }

        if (!empty($providerIds['fbc'])) {
            $userData['fbc'] = self::cleanString($providerIds['fbc'], 190);
        }

        if ($nvsUid) {
            $userData['external_id'] = hash('sha256', $propertyId . '|' . $nvsUid);
        }

        $email = self::firstNonEmpty([
            $user['email'] ?? null,
            $params['email'] ?? null,
        ]);

        if ($email) {
            $userData['em'] = [self::hashEmail($email)];
        }

        $phone = self::firstNonEmpty([
            $user['phone'] ?? null,
            $params['phone'] ?? null,
        ]);

        if ($phone) {
            $userData['ph'] = [self::hashPhone($phone)];
        }

        $customData = self::buildCustomData($params, $payload, $context, $propertyId);

        $event = [
            'event_name' => $metaEventName,
            'event_time' => $eventTime,
            'event_id' => $eventId,
            'action_source' => 'website',
            'event_source_url' => $pageUrl,
            'user_data' => self::removeEmpty($userData),
        ];

        if (!empty($customData)) {
            $event['custom_data'] = $customData;
        }

        return [
            'data' => [self::removeEmpty($event)],
        ];
    }

    private static function buildCustomData(array $params, array $payload, array $context, string $propertyId): array {
        $custom = [
            'property_id' => $propertyId,
        ];

        foreach ([
            'value',
            'currency',
            'content_name',
            'content_type',
            'num_items',
            'status',
            'search_string',
            'order_id',
        ] as $key) {
            if (isset($params[$key]) && $params[$key] !== '') {
                $custom[$key] = $params[$key];
            }
        }

        if (!empty($params['content_ids']) && is_array($params['content_ids'])) {
            $custom['content_ids'] = array_values($params['content_ids']);
        } elseif (!empty($params['content_id'])) {
            $custom['content_ids'] = [(string) $params['content_id']];
        }

        $utm = [];

        if (isset($payload['utm']) && is_array($payload['utm'])) {
            $utm = array_merge($utm, $payload['utm']);
        }

        if (isset($context['utm']) && is_array($context['utm'])) {
            $utm = array_merge($utm, $context['utm']);
        }

        foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as $key) {
            if (!empty($utm[$key])) {
                $custom[$key] = (string) $utm[$key];
            }
        }

        if (!empty($context['source_domain'])) {
            $custom['source_domain'] = (string) $context['source_domain'];
        }

        return self::removeEmpty($custom);
    }

    private static function postToMeta(string $pixelId, string $accessToken, string $apiVersion, array $payload): array {
        if (!function_exists('curl_init')) {
            return [
                'ok' => false,
                'http_code' => null,
                'response' => null,
                'curl_error' => 'curl_not_available',
                'error_message' => 'PHP cURL extension is not available.',
            ];
        }

        $url = 'https://graph.facebook.com/' . rawurlencode($apiVersion) . '/' . rawurlencode($pixelId) . '/events?access_token=' . rawurlencode($accessToken);

        $ch = curl_init($url);

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);

        $rawResponse = curl_exec($ch);
        $curlError = curl_error($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

        curl_close($ch);

        $decodedResponse = null;

        if (is_string($rawResponse) && $rawResponse !== '') {
            $decoded = json_decode($rawResponse, true);
            $decodedResponse = json_last_error() === JSON_ERROR_NONE ? $decoded : $rawResponse;
        }

        $hasMetaError = is_array($decodedResponse) && isset($decodedResponse['error']);
        $ok = !$curlError && $httpCode >= 200 && $httpCode < 300 && !$hasMetaError;

        return [
            'ok' => $ok,
            'http_code' => $httpCode ?: null,
            'response' => $decodedResponse,
            'curl_error' => $curlError ?: null,
            'error_message' => $hasMetaError ? ($decodedResponse['error']['message'] ?? 'Meta API error.') : null,
        ];
    }

    private static function saveDelivery(array $delivery): ?int {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('meta_deliveries');
            $columns = self::tableColumns($table);

            if (empty($columns)) {
                return null;
            }

            $row = [
                'property_id' => $delivery['property_id'] ?? null,
                'event_id' => $delivery['event_id'] ?? null,
                'event_name' => $delivery['event_name'] ?? null,
                'source' => 'browser',
                'source_platform' => 'browser',
                'mode' => $delivery['mode'] ?? null,
                'sent' => !empty($delivery['sent']) ? 1 : 0,
                'ok' => !empty($delivery['ok']) ? 1 : 0,
                'http_code' => $delivery['http_code'] ?? null,
                'curl_error' => $delivery['curl_error'] ?? null,
                'error_message' => $delivery['error_message'] ?? null,
                'payload_json' => isset($delivery['payload']) ? json_encode($delivery['payload'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
                'response_json' => isset($delivery['response']) ? json_encode($delivery['response'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
                'created_at' => date('Y-m-d H:i:s'),
            ];

            $filtered = [];

            foreach ($row as $key => $value) {
                if (in_array($key, $columns, true)) {
                    $filtered[$key] = $value;
                }
            }

            if (empty($filtered)) {
                return null;
            }

            $fieldNames = array_keys($filtered);
            $sql = 'INSERT INTO ' . $table . ' (' . implode(', ', $fieldNames) . ') VALUES (:' . implode(', :', $fieldNames) . ')';

            $stmt = $pdo->prepare($sql);

            foreach ($filtered as $key => $value) {
                $stmt->bindValue(':' . $key, $value);
            }

            $stmt->execute();

            return (int) $pdo->lastInsertId();
        } catch (Throwable $e) {
            Logger::write('browser-capi-save-delivery-error', [
                'error' => $e->getMessage(),
                'delivery' => $delivery,
            ]);

            return null;
        }
    }

    private static function hasSuccessfulDelivery(string $eventId, string $propertyId): bool {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('meta_deliveries');
            $columns = self::tableColumns($table);

            if (!in_array('event_id', $columns, true)) {
                return false;
            }

            $where = ['event_id = :event_id'];
            $params = [':event_id' => $eventId];

            if (in_array('property_id', $columns, true)) {
                $where[] = 'property_id = :property_id';
                $params[':property_id'] = $propertyId;
            }

            if (in_array('ok', $columns, true)) {
                $where[] = 'ok = 1';
            }

            if (in_array('sent', $columns, true)) {
                $where[] = 'sent = 1';
            }

            $sql = 'SELECT 1 FROM ' . $table . ' WHERE ' . implode(' AND ', $where) . ' LIMIT 1';
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);

            return (bool) $stmt->fetchColumn();
        } catch (Throwable $e) {
            Logger::write('browser-capi-dedupe-check-error', [
                'error' => $e->getMessage(),
                'event_id' => $eventId,
                'property_id' => $propertyId,
            ]);

            return false;
        }
    }

    private static function tableColumns(string $table): array {
        try {
            $pdo = Database::getConnection();
            $stmt = $pdo->query('SHOW COLUMNS FROM ' . $table);
            $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];

            return array_values(array_filter(array_map(function ($row) {
                return $row['Field'] ?? null;
            }, $rows)));
        } catch (Throwable $e) {
            return [];
        }
    }

    private static function isAllowedEvent(string $eventName, array $property): bool {
        return in_array($eventName, self::allowedEvents($property), true);
    }

    private static function allowedEvents(array $property): array {
        $raw = trim((string) ($property['browser_capi_events'] ?? self::DEFAULT_ALLOWED_EVENTS));

        if ($raw === '') {
            $raw = self::DEFAULT_ALLOWED_EVENTS;
        }

        $parts = preg_split('/[,\n\r]+/', $raw) ?: [];

        return array_values(array_unique(array_filter(array_map(function ($event) {
            return self::cleanKey($event, '');
        }, $parts))));
    }

    private static function mapMetaEventName(string $eventName): string {
        $map = [
            'page_view' => 'PageView',
            'view_content' => 'ViewContent',
            'view_item' => 'ViewContent',
            'initiate_checkout' => 'InitiateCheckout',
            'lead' => 'Lead',
            'complete_registration' => 'CompleteRegistration',
            'add_to_cart' => 'AddToCart',
            'purchase' => 'Purchase',
        ];

        return $map[$eventName] ?? $eventName;
    }

    private static function extractProviderIds(array $payload, array $context): array {
        $providerIds = [];

        foreach (['provider_ids', 'providerIds'] as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                $providerIds = array_merge($providerIds, $payload[$key]);
            }

            if (isset($context[$key]) && is_array($context[$key])) {
                $providerIds = array_merge($providerIds, $context[$key]);
            }
        }

        return array_filter($providerIds, function ($value) {
            return $value !== null && $value !== '';
        });
    }

    private static function result(bool $ok, bool $sent, string $mode, ?string $reason, ?int $httpCode, $extra = null, array $merge = []): array {
        return array_merge([
            'ok' => $ok,
            'sent' => $sent,
            'mode' => $mode,
            'reason' => $reason,
            'http_code' => $httpCode,
            'extra' => $extra,
        ], $merge);
    }

    private static function firstNonEmpty(array $candidates): ?string {
        foreach ($candidates as $candidate) {
            $value = trim((string) $candidate);

            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private static function removeEmpty(array $data): array {
        $clean = [];

        foreach ($data as $key => $value) {
            if ($value === null || $value === '' || $value === []) {
                continue;
            }

            $clean[$key] = $value;
        }

        return $clean;
    }

    private static function boolValue($value): bool {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }

    private static function hashEmail(string $email): string {
        return hash('sha256', strtolower(trim($email)));
    }

    private static function hashPhone(string $phone): string {
        $digits = preg_replace('/\D+/', '', $phone) ?: $phone;

        return hash('sha256', strtolower(trim($digits)));
    }

    private static function cleanKey($value, string $fallback): string {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('/[^a-z0-9_]/', '_', $value);
        $value = preg_replace('/_+/', '_', $value);
        $value = trim($value, '_');

        return $value !== '' ? $value : $fallback;
    }

    private static function cleanString($value, int $maxLength): ?string {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        if ($value === '') {
            return null;
        }

        if (function_exists('mb_substr')) {
            return mb_substr($value, 0, $maxLength, 'UTF-8');
        }

        return substr($value, 0, $maxLength);
    }

    private static function cleanLongText($value): ?string {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}