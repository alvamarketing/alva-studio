<?php

require_once __DIR__ . '/Env.php';
require_once __DIR__ . '/Settings.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Logger.php';

class MetaClient {

    private static array $propertyConfigCache = [];

    public static function sendEvent(array $event): array {
        $propertyId = self::getPropertyId($event);
        $config = self::getMetaConfig($propertyId);

        $payload = self::buildPayload($event, $config['test_event_code'] ?? null);

        if (!empty($config['property_missing'])) {
            Logger::write('meta-send-skipped', [
                'reason' => 'property_missing',
                'property_id' => $propertyId,
                'payload' => $payload,
            ]);

            return [
                'ok' => false,
                'sent' => false,
                'mode' => 'property_missing',
                'reason' => 'property_missing',
                'http_code' => null,
                'curl_error' => null,
                'payload' => $payload,
                'response' => [
                    'error' => 'property_missing',
                    'property_id' => $propertyId,
                    'message' => 'Property not found in nvs_properties.'
                ],
            ];
        }

        if (empty($config['is_active'])) {
            Logger::write('meta-send-skipped', [
                'reason' => 'property_inactive',
                'property_id' => $propertyId,
                'payload' => $payload,
            ]);

            return [
                'ok' => false,
                'sent' => false,
                'mode' => 'property_inactive',
                'reason' => 'property_inactive',
                'http_code' => null,
                'curl_error' => null,
                'payload' => $payload,
                'response' => [
                    'error' => 'property_inactive',
                    'property_id' => $propertyId,
                    'message' => 'Property is inactive.'
                ],
            ];
        }

        if (!empty($config['debug_mode'])) {
            Logger::write('meta-debug-payload', [
                'reason' => 'debug_mode_enabled',
                'property_id' => $propertyId,
                'config_source' => $config['source'] ?? null,
                'pixel_id_configured' => !empty($config['pixel_id']),
                'access_token_configured' => !empty($config['access_token']),
                'payload' => $payload,
            ]);

            return [
                'ok' => true,
                'sent' => false,
                'mode' => 'debug',
                'reason' => 'debug_mode_enabled',
                'http_code' => null,
                'curl_error' => null,
                'payload' => $payload,
                'response' => [
                    'debug' => true,
                    'property_id' => $propertyId,
                    'message' => 'DEBUG_MODE is enabled. Payload was not sent to Meta.'
                ],
            ];
        }

        if (empty($config['pixel_id']) || empty($config['access_token'])) {
            Logger::write('meta-send-skipped', [
                'reason' => 'missing_meta_credentials',
                'property_id' => $propertyId,
                'config_source' => $config['source'] ?? null,
                'pixel_id_configured' => !empty($config['pixel_id']),
                'access_token_configured' => !empty($config['access_token']),
                'payload' => $payload,
            ]);

            return [
                'ok' => false,
                'sent' => false,
                'mode' => 'skipped',
                'reason' => 'missing_meta_credentials',
                'http_code' => null,
                'curl_error' => null,
                'payload' => $payload,
                'response' => [
                    'error' => 'missing_meta_credentials',
                    'property_id' => $propertyId,
                ],
            ];
        }

        $apiVersion = $config['api_version'] ?: 'v19.0';
        $pixelId = $config['pixel_id'];
        $accessToken = $config['access_token'];

        $url = 'https://graph.facebook.com/' . $apiVersion . '/' . rawurlencode($pixelId) . '/events';

        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ch = curl_init($url);

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $accessToken,
            ],
            CURLOPT_POSTFIELDS => $body,
        ]);

        $responseBody = curl_exec($ch);
        $curlError = curl_error($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

        curl_close($ch);

        $decodedResponse = json_decode((string) $responseBody, true);

        $result = [
            'ok' => $curlError === '' && $httpCode >= 200 && $httpCode < 300,
            'sent' => true,
            'mode' => 'production',
            'reason' => null,
            'http_code' => $httpCode,
            'curl_error' => $curlError ?: null,
            'payload' => $payload,
            'response' => is_array($decodedResponse) ? $decodedResponse : $responseBody,
        ];

        Logger::write('meta-delivery', [
            'property_id' => $propertyId,
            'config_source' => $config['source'] ?? null,
            'event_id' => $event['event_id'] ?? null,
            'event_name' => $event['event_name'] ?? null,
            'meta_event_name' => $event['meta_event_name'] ?? null,
            'http_code' => $httpCode,
            'ok' => $result['ok'],
            'curl_error' => $curlError ?: null,
            'payload' => $payload,
            'response' => $result['response'],
        ]);

        return $result;
    }

    public static function buildPayload(array $event, ?string $testEventCode = null): array {
        $propertyId = self::getPropertyId($event);

        if ($testEventCode === null) {
            $config = self::getMetaConfig($propertyId);
            $testEventCode = $config['test_event_code'] ?? null;
        }

        $metaEvent = [
            'event_name' => $event['meta_event_name'] ?? self::mapEventName($event['event_name'] ?? ''),
            'event_time' => (int) ($event['event_time'] ?? time()),
            'event_id' => $event['event_id'] ?? uniqid('nvs_evt_', true),
            'action_source' => 'website',
            'event_source_url' => self::getEventSourceUrl($event),
            'user_data' => self::buildUserData($event, $propertyId),
            'custom_data' => self::buildCustomData($event, $propertyId),
        ];

        $payload = [
            'data' => [
                self::removeEmptyRecursive($metaEvent),
            ],
        ];

        if ($testEventCode) {
            $payload['test_event_code'] = $testEventCode;
        }

        return $payload;
    }

    private static function getMetaConfig(string $propertyId): array {
        $propertyId = self::normalizePropertyId($propertyId);

        if (isset(self::$propertyConfigCache[$propertyId])) {
            return self::$propertyConfigCache[$propertyId];
        }

        $global = [
            'property_id' => $propertyId,
            'pixel_id' => Settings::get('meta_pixel_id'),
            'access_token' => Settings::get('meta_access_token'),
            'test_event_code' => Settings::get('meta_test_event_code'),
            'api_version' => Settings::get('meta_api_version', 'v19.0'),
            'debug_mode' => Settings::getBool('debug_mode', true),
            'is_active' => true,
            'source' => 'global_settings',
            'property_missing' => false,
            'domain' => null,
        ];

        try {
            $pdo = Database::getConnection();
            $table = Database::table('properties');

            if (!self::tableExists($pdo, $table)) {
                self::$propertyConfigCache[$propertyId] = $global;
                return $global;
            }

            $stmt = $pdo->prepare("
                SELECT *
                FROM " . self::q($table) . "
                WHERE property_id = :property_id
                LIMIT 1
            ");

            $stmt->execute([
                ':property_id' => $propertyId,
            ]);

            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$row) {
                if ($propertyId === 'default') {
                    self::$propertyConfigCache[$propertyId] = $global;
                    return $global;
                }

                $missing = $global;
                $missing['property_missing'] = true;
                $missing['is_active'] = false;
                $missing['source'] = 'property_missing';

                self::$propertyConfigCache[$propertyId] = $missing;
                return $missing;
            }

            $config = [
                'property_id' => $propertyId,
                'pixel_id' => self::firstNonEmpty([
                    $row['meta_pixel_id'] ?? null,
                    $global['pixel_id'] ?? null,
                ]),
                'access_token' => self::firstNonEmpty([
                    $row['meta_access_token'] ?? null,
                    $global['access_token'] ?? null,
                ]),
                'test_event_code' => self::firstNonEmpty([
                    $row['meta_test_event_code'] ?? null,
                ]),
                'api_version' => self::firstNonEmpty([
                    $row['meta_api_version'] ?? null,
                    $global['api_version'] ?? null,
                    'v19.0',
                ]),
                'debug_mode' => !empty($row['debug_mode']),
                'is_active' => !isset($row['is_active']) || (int) $row['is_active'] === 1,
                'source' => 'property',
                'property_missing' => false,
                'domain' => $row['domain'] ?? null,
            ];

            self::$propertyConfigCache[$propertyId] = $config;
            return $config;

        } catch (Throwable $e) {
            Logger::write('meta-config-error', [
                'property_id' => $propertyId,
                'error' => $e->getMessage(),
            ]);

            self::$propertyConfigCache[$propertyId] = $global;
            return $global;
        }
    }

    private static function buildUserData(array $event, string $propertyId): array {
        $user = $event['user'] ?? [];
        $context = $event['context'] ?? [];
        $providerIds = $context['provider_ids'] ?? [];

        $externalIdSource = self::firstNonEmpty([
            $context['nvs_uid'] ?? null,
            $user['customer_id'] ?? null,
            $user['email'] ?? null,
        ]);

        if ($externalIdSource) {
            $externalIdSource = $propertyId . '|' . $externalIdSource;
        }

        $userData = [
            'em' => self::hashList([$user['email'] ?? null]),
            'ph' => self::hashList([$user['phone'] ?? null]),
            'fn' => self::hashValue($user['first_name'] ?? null),
            'ln' => self::hashValue($user['last_name'] ?? null),
            'country' => self::hashValue($user['country'] ?? null),
            'external_id' => self::hashValue($externalIdSource),

            'client_ip_address' => $context['ip_address'] ?? null,
            'client_user_agent' => $context['user_agent'] ?? null,

            'fbp' => $providerIds['fbp'] ?? null,
            'fbc' => $providerIds['fbc'] ?? null,
        ];

        return self::removeEmptyRecursive($userData);
    }

    private static function buildCustomData(array $event, string $propertyId): array {
        $params = $event['params'] ?? [];
        $context = $event['context'] ?? [];
        $items = $params['items'] ?? [];
        $utm = $context['utm'] ?? [];

        $contents = [];
        $contentIds = [];
        $contentNames = [];

        if (is_array($items)) {
            foreach ($items as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $itemId = $item['item_id'] ?? $item['offer_id'] ?? null;
                $itemName = $item['item_name'] ?? $item['offer_name'] ?? null;

                if ($itemId) {
                    $contentIds[] = (string) $itemId;
                }

                if ($itemName) {
                    $contentNames[] = (string) $itemName;
                }

                $contents[] = self::removeEmptyRecursive([
                    'id' => $itemId,
                    'quantity' => isset($item['quantity']) ? (int) $item['quantity'] : 1,
                    'item_price' => isset($item['price']) ? (float) $item['price'] : null,
                ]);
            }
        }

        $customData = [
            'property_id' => $propertyId,
            'currency' => $params['currency'] ?? 'BRL',
            'value' => isset($params['value']) ? (float) $params['value'] : null,
            'order_id' => $params['transaction_id'] ?? null,
            'content_ids' => array_values(array_unique(array_filter($contentIds))),
            'content_name' => !empty($contentNames) ? implode(' + ', array_unique($contentNames)) : null,
            'content_type' => 'product',
            'contents' => $contents,
            'num_items' => $params['item_count'] ?? count($contents),
            'payment_type' => $params['payment_type'] ?? null,
            'status' => $params['status'] ?? null,

            'nvs_uid' => $context['nvs_uid'] ?? null,
            'nvs_sid' => $context['nvs_sid'] ?? null,
            'checkout_session_id' => $context['checkout_session_id'] ?? null,

            'utm_source' => $utm['utm_source'] ?? null,
            'utm_medium' => $utm['utm_medium'] ?? null,
            'utm_campaign' => $utm['utm_campaign'] ?? null,
            'utm_content' => $utm['utm_content'] ?? null,
            'utm_term' => $utm['utm_term'] ?? null,
            'utm_id' => $utm['utm_id'] ?? null,

            'source_domain' => self::hostFromUrl(
                $context['landing_url']
                ?? $context['checkout_url']
                ?? $context['page_url']
                ?? null
            ),
        ];

        return self::removeEmptyRecursive($customData);
    }

    private static function mapEventName(string $eventName): string {
        $map = [
            'page_view' => 'PageView',
            'view_item' => 'ViewContent',
            'view_content' => 'ViewContent',
            'add_to_cart' => 'AddToCart',
            'initiate_checkout' => 'InitiateCheckout',
            'add_payment_info' => 'AddPaymentInfo',
            'lead' => 'Lead',
            'purchase' => 'Purchase',
            'refund' => 'Refund',
            'complete_registration' => 'CompleteRegistration',
            'subscribe' => 'Subscribe',
        ];

        return $map[$eventName] ?? $eventName;
    }

    /**
     * O literal `https://www.nvspay.com/` era o ultimo recurso deste metodo.
     * Numa venda que nao passa pelo site — webhook de qualquer plataforma de
     * checkout — isso informava a Meta que o evento aconteceu no dominio da
     * NVSPay, que nao tem relacao com o anunciante. Agora o recurso final e o
     * dominio do proprio projeto.
     */
    private static function getEventSourceUrl(array $event): string {
        $context = $event['context'] ?? [];

        $fromEvent = self::firstNonEmpty([
            $context['page_url'] ?? null,
            $context['checkout_url'] ?? null,
            $context['landing_url'] ?? null,
        ]);

        if ($fromEvent !== null) {
            return $fromEvent;
        }

        $config = self::getMetaConfig(self::getPropertyId($event));
        $domain = self::firstNonEmpty([$config['domain'] ?? null]);

        if ($domain !== null) {
            return preg_match('#^https?://#i', $domain) === 1
                ? $domain
                : 'https://' . ltrim($domain, '/');
        }

        return self::firstNonEmpty([Env::get('APP_URL')]) ?? 'https://localhost/';
    }

    private static function getPropertyId(array $event): string {
        $context = $event['context'] ?? [];

        return self::normalizePropertyId(
            $event['property_id']
            ?? $context['property_id']
            ?? 'default'
        );
    }

    private static function normalizePropertyId($propertyId): string {
        $propertyId = strtolower(trim((string) ($propertyId ?? '')));

        if ($propertyId === '') {
            return 'default';
        }

        $propertyId = preg_replace('/[^a-z0-9_]/', '_', $propertyId);
        $propertyId = preg_replace('/_+/', '_', $propertyId);
        $propertyId = trim($propertyId, '_');

        return $propertyId !== '' ? $propertyId : 'default';
    }

    private static function tableExists(PDO $pdo, string $table): bool {
        try {
            $stmt = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table));
            return (bool) ($stmt ? $stmt->fetchColumn() : false);
        } catch (Throwable $e) {
            return false;
        }
    }

    private static function q(string $identifier): string {
        return '`' . str_replace('`', '``', $identifier) . '`';
    }

    private static function hashList(array $values): array {
        $hashed = [];

        foreach ($values as $value) {
            $hash = self::hashValue($value);

            if ($hash) {
                $hashed[] = $hash;
            }
        }

        return $hashed;
    }

    private static function hashValue($value): ?string {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        if ($value === '') {
            return null;
        }

        $value = mb_strtolower($value, 'UTF-8');

        return hash('sha256', $value);
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

    private static function hostFromUrl($url): ?string {
        if (!$url || !is_string($url)) {
            return null;
        }

        $host = parse_url($url, PHP_URL_HOST);

        return $host ?: null;
    }

    private static function removeEmptyRecursive($value) {
        if (is_array($value)) {
            $clean = [];

            foreach ($value as $key => $item) {
                $item = self::removeEmptyRecursive($item);

                if ($item === null || $item === '' || $item === []) {
                    continue;
                }

                $clean[$key] = $item;
            }

            return $clean;
        }

        return $value;
    }
}