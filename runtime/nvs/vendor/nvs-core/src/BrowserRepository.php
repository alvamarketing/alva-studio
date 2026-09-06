<?php

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Logger.php';

class BrowserRepository {

    public static function ingest(array $payload, array $serverContext = []): array {
        $now = date('Y-m-d H:i:s');

        $context = is_array($payload['context'] ?? null) ? $payload['context'] : [];

        $propertyId = self::cleanKey(
            $payload['property_id']
            ?? $payload['nvs_property_id']
            ?? ($context['property_id'] ?? null)
            ?? ($context['nvs_property_id'] ?? null)
            ?? 'default',
            'default'
        );

        $cookiePrefix = self::cleanString(
            $payload['cookie_prefix']
            ?? ($context['cookie_prefix'] ?? null)
            ?? null,
            100
        );

        $eventName = self::cleanKey($payload['event_name'] ?? 'page_view', 'page_view');
        $metaEventName = self::mapMetaEventName($eventName);

        $nvsUid = self::cleanString(
            $payload['nvs_uid'] ?? ($context['nvs_uid'] ?? null),
            190
        );

        $nvsSid = self::cleanString(
            $payload['nvs_sid'] ?? ($context['nvs_sid'] ?? null),
            190
        );

        $eventId = self::cleanString($payload['event_id'] ?? null, 190);

        if (!$eventId) {
            $eventId = self::generateEventId($propertyId, $eventName, $nvsUid, $nvsSid);
        }

        $pageUrl = self::cleanLongText(
            $payload['page_url']
            ?? ($context['page_url'] ?? null)
            ?? ($payload['url'] ?? null)
        );

        $referrer = self::cleanLongText(
            $payload['referrer']
            ?? ($context['referrer'] ?? null)
        );

        $eventTime = isset($payload['event_time']) && is_numeric($payload['event_time'])
            ? (int) $payload['event_time']
            : time();

        $sourcePlatform = self::cleanString($payload['source_platform'] ?? 'direct', 80);

        $params = is_array($payload['params'] ?? null) ? $payload['params'] : [];
        $user = is_array($payload['user'] ?? null) ? $payload['user'] : [];

        $context = array_merge($context, [
            'property_id' => $propertyId,
            'cookie_prefix' => $cookiePrefix,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'page_url' => $pageUrl,
            'referrer' => $referrer,
            'ip_address' => $serverContext['ip_address'] ?? null,
            'user_agent' => $serverContext['user_agent'] ?? null,
        ]);

        $providerIds = self::extractProviderIds($payload, $context);
        $utm = self::extractUtm($payload, $context);

        if (!isset($context['provider_ids'])) {
            $context['provider_ids'] = $providerIds;
        }

        if (!isset($context['utm'])) {
            $context['utm'] = $utm;
        }

        $identityId = null;
        $sessionId = null;
        $browserEventId = null;
        $duplicate = false;

        if ($nvsUid) {
            $identityId = self::upsertIdentity([
                'property_id' => $propertyId,
                'nvs_uid' => $nvsUid,
                'email' => $user['email'] ?? null,
                'phone' => $user['phone'] ?? null,
                'first_name' => $user['first_name'] ?? null,
                'last_name' => $user['last_name'] ?? null,
                'full_name' => $user['full_name'] ?? null,
                'country' => $user['country'] ?? null,
                'locale' => $context['locale'] ?? null,
                'fbp' => $providerIds['fbp'] ?? null,
                'fbc' => $providerIds['fbc'] ?? null,
                'fbclid' => $providerIds['fbclid'] ?? null,
                'gclid' => $providerIds['gclid'] ?? null,
                'ttclid' => $providerIds['ttclid'] ?? null,
                'supreme_stuid' => $providerIds['supremeStuid'] ?? null,
                'landing_url' => $context['landing_url'] ?? $pageUrl,
                'referrer' => $referrer,
                'utm' => $utm,
                'provider_ids' => $providerIds,
                'seen_at' => $now,
                'ip_address' => $serverContext['ip_address'] ?? null,
                'user_agent' => $serverContext['user_agent'] ?? null,
            ]);
        }

        if ($nvsSid) {
            $sessionId = self::upsertSession([
                'property_id' => $propertyId,
                'nvs_sid' => $nvsSid,
                'nvs_uid' => $nvsUid,
                'landing_url' => $context['landing_url'] ?? $pageUrl,
                'last_page_url' => $pageUrl,
                'referrer' => $referrer,
                'utm' => $utm,
                'provider_ids' => $providerIds,
                'seen_at' => $now,
                'ip_address' => $serverContext['ip_address'] ?? null,
                'user_agent' => $serverContext['user_agent'] ?? null,
                'is_pageview' => $eventName === 'page_view',
            ]);
        }

        $savedEvent = self::saveBrowserEvent([
            'property_id' => $propertyId,
            'event_id' => $eventId,
            'event_name' => $eventName,
            'meta_event_name' => $metaEventName,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'page_url' => $pageUrl,
            'referrer' => $referrer,
            'event_time' => $eventTime,
            'source_platform' => $sourcePlatform,
            'params' => $params,
            'user' => $user,
            'context' => $context,
            'raw_payload' => $payload,
        ]);

        $browserEventId = $savedEvent['id'];
        $duplicate = $savedEvent['duplicate'];

        return [
            'ok' => true,
            'property_id' => $propertyId,
            'event_id' => $eventId,
            'event_name' => $eventName,
            'meta_event_name' => $metaEventName,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'identity_db_id' => $identityId,
            'session_db_id' => $sessionId,
            'browser_event_db_id' => $browserEventId,
            'duplicate' => $duplicate,
        ];
    }

    private static function upsertIdentity(array $data): ?int {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('identities');

            $stmt = $pdo->prepare("
                INSERT INTO {$table} (
                    property_id,
                    nvs_uid,
                    email,
                    phone,
                    first_name,
                    last_name,
                    full_name,
                    country,
                    locale,
                    fbp,
                    fbc,
                    fbclid,
                    gclid,
                    ttclid,
                    supreme_stuid,
                    first_landing_url,
                    last_landing_url,
                    first_referrer,
                    last_referrer,
                    first_utm_json,
                    last_utm_json,
                    provider_ids_json,
                    first_seen_at,
                    last_seen_at,
                    last_ip,
                    last_user_agent
                ) VALUES (
                    :property_id,
                    :nvs_uid,
                    :email,
                    :phone,
                    :first_name,
                    :last_name,
                    :full_name,
                    :country,
                    :locale,
                    :fbp,
                    :fbc,
                    :fbclid,
                    :gclid,
                    :ttclid,
                    :supreme_stuid,
                    :first_landing_url,
                    :last_landing_url,
                    :first_referrer,
                    :last_referrer,
                    :first_utm_json,
                    :last_utm_json,
                    :provider_ids_json,
                    :first_seen_at,
                    :last_seen_at,
                    :last_ip,
                    :last_user_agent
                )
                ON DUPLICATE KEY UPDATE
                    property_id = COALESCE(NULLIF(VALUES(property_id), ''), property_id),
                    email = COALESCE(NULLIF(VALUES(email), ''), email),
                    phone = COALESCE(NULLIF(VALUES(phone), ''), phone),
                    first_name = COALESCE(NULLIF(VALUES(first_name), ''), first_name),
                    last_name = COALESCE(NULLIF(VALUES(last_name), ''), last_name),
                    full_name = COALESCE(NULLIF(VALUES(full_name), ''), full_name),
                    country = COALESCE(NULLIF(VALUES(country), ''), country),
                    locale = COALESCE(NULLIF(VALUES(locale), ''), locale),
                    fbp = COALESCE(NULLIF(VALUES(fbp), ''), fbp),
                    fbc = COALESCE(NULLIF(VALUES(fbc), ''), fbc),
                    fbclid = COALESCE(NULLIF(VALUES(fbclid), ''), fbclid),
                    gclid = COALESCE(NULLIF(VALUES(gclid), ''), gclid),
                    ttclid = COALESCE(NULLIF(VALUES(ttclid), ''), ttclid),
                    supreme_stuid = COALESCE(NULLIF(VALUES(supreme_stuid), ''), supreme_stuid),
                    last_landing_url = COALESCE(VALUES(last_landing_url), last_landing_url),
                    last_referrer = COALESCE(VALUES(last_referrer), last_referrer),
                    last_utm_json = COALESCE(VALUES(last_utm_json), last_utm_json),
                    provider_ids_json = COALESCE(VALUES(provider_ids_json), provider_ids_json),
                    last_seen_at = VALUES(last_seen_at),
                    last_ip = VALUES(last_ip),
                    last_user_agent = VALUES(last_user_agent)
            ");

            $stmt->execute([
                ':property_id' => $data['property_id'],
                ':nvs_uid' => $data['nvs_uid'],
                ':email' => self::cleanString($data['email'] ?? null, 190),
                ':phone' => self::cleanString($data['phone'] ?? null, 80),
                ':first_name' => self::cleanString($data['first_name'] ?? null, 190),
                ':last_name' => self::cleanString($data['last_name'] ?? null, 190),
                ':full_name' => self::cleanString($data['full_name'] ?? null, 255),
                ':country' => self::cleanString($data['country'] ?? null, 20),
                ':locale' => self::cleanString($data['locale'] ?? null, 40),
                ':fbp' => self::cleanString($data['fbp'] ?? null, 255),
                ':fbc' => self::cleanString($data['fbc'] ?? null, 255),
                ':fbclid' => self::cleanString($data['fbclid'] ?? null, 255),
                ':gclid' => self::cleanString($data['gclid'] ?? null, 255),
                ':ttclid' => self::cleanString($data['ttclid'] ?? null, 255),
                ':supreme_stuid' => self::cleanString($data['supreme_stuid'] ?? null, 190),
                ':first_landing_url' => self::cleanLongText($data['landing_url'] ?? null),
                ':last_landing_url' => self::cleanLongText($data['landing_url'] ?? null),
                ':first_referrer' => self::cleanLongText($data['referrer'] ?? null),
                ':last_referrer' => self::cleanLongText($data['referrer'] ?? null),
                ':first_utm_json' => self::jsonEncode($data['utm'] ?? []),
                ':last_utm_json' => self::jsonEncode($data['utm'] ?? []),
                ':provider_ids_json' => self::jsonEncode($data['provider_ids'] ?? []),
                ':first_seen_at' => $data['seen_at'],
                ':last_seen_at' => $data['seen_at'],
                ':last_ip' => self::cleanString($data['ip_address'] ?? null, 80),
                ':last_user_agent' => self::cleanLongText($data['user_agent'] ?? null),
            ]);

            $select = $pdo->prepare("
                SELECT id
                FROM {$table}
                WHERE property_id = :property_id
                  AND nvs_uid = :nvs_uid
                LIMIT 1
            ");

            $select->execute([
                ':property_id' => $data['property_id'],
                ':nvs_uid' => $data['nvs_uid'],
            ]);

            $id = $select->fetchColumn();

            return $id ? (int) $id : null;

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'BrowserRepository::upsertIdentity',
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private static function upsertSession(array $data): ?int {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('sessions');

            $stmt = $pdo->prepare("
                INSERT INTO {$table} (
                    property_id,
                    nvs_sid,
                    nvs_uid,
                    landing_url,
                    last_page_url,
                    referrer,
                    utm_json,
                    provider_ids_json,
                    started_at,
                    last_seen_at,
                    pageview_count,
                    event_count,
                    ip_address,
                    user_agent
                ) VALUES (
                    :property_id,
                    :nvs_sid,
                    :nvs_uid,
                    :landing_url,
                    :last_page_url,
                    :referrer,
                    :utm_json,
                    :provider_ids_json,
                    :started_at,
                    :last_seen_at,
                    :pageview_count,
                    :event_count,
                    :ip_address,
                    :user_agent
                )
                ON DUPLICATE KEY UPDATE
                    property_id = COALESCE(NULLIF(VALUES(property_id), ''), property_id),
                    nvs_uid = COALESCE(NULLIF(VALUES(nvs_uid), ''), nvs_uid),
                    last_page_url = COALESCE(VALUES(last_page_url), last_page_url),
                    referrer = COALESCE(VALUES(referrer), referrer),
                    utm_json = COALESCE(VALUES(utm_json), utm_json),
                    provider_ids_json = COALESCE(VALUES(provider_ids_json), provider_ids_json),
                    last_seen_at = VALUES(last_seen_at),
                    pageview_count = pageview_count + VALUES(pageview_count),
                    event_count = event_count + 1,
                    ip_address = VALUES(ip_address),
                    user_agent = VALUES(user_agent)
            ");

            $stmt->execute([
                ':property_id' => $data['property_id'],
                ':nvs_sid' => $data['nvs_sid'],
                ':nvs_uid' => $data['nvs_uid'],
                ':landing_url' => self::cleanLongText($data['landing_url'] ?? null),
                ':last_page_url' => self::cleanLongText($data['last_page_url'] ?? null),
                ':referrer' => self::cleanLongText($data['referrer'] ?? null),
                ':utm_json' => self::jsonEncode($data['utm'] ?? []),
                ':provider_ids_json' => self::jsonEncode($data['provider_ids'] ?? []),
                ':started_at' => $data['seen_at'],
                ':last_seen_at' => $data['seen_at'],
                ':pageview_count' => !empty($data['is_pageview']) ? 1 : 0,
                ':event_count' => 1,
                ':ip_address' => self::cleanString($data['ip_address'] ?? null, 80),
                ':user_agent' => self::cleanLongText($data['user_agent'] ?? null),
            ]);

            $select = $pdo->prepare("
                SELECT id
                FROM {$table}
                WHERE property_id = :property_id
                  AND nvs_sid = :nvs_sid
                LIMIT 1
            ");

            $select->execute([
                ':property_id' => $data['property_id'],
                ':nvs_sid' => $data['nvs_sid'],
            ]);

            $id = $select->fetchColumn();

            return $id ? (int) $id : null;

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'BrowserRepository::upsertSession',
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private static function saveBrowserEvent(array $data): array {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('browser_events');

            $stmt = $pdo->prepare("
                INSERT INTO {$table} (
                    property_id,
                    event_id,
                    event_name,
                    meta_event_name,
                    nvs_uid,
                    nvs_sid,
                    page_url,
                    referrer,
                    event_time,
                    source,
                    source_platform,
                    params_json,
                    user_json,
                    context_json,
                    raw_payload_json
                ) VALUES (
                    :property_id,
                    :event_id,
                    :event_name,
                    :meta_event_name,
                    :nvs_uid,
                    :nvs_sid,
                    :page_url,
                    :referrer,
                    :event_time,
                    'browser',
                    :source_platform,
                    :params_json,
                    :user_json,
                    :context_json,
                    :raw_payload_json
                )
                ON DUPLICATE KEY UPDATE
                    event_id = event_id
            ");

            $stmt->execute([
                ':property_id' => $data['property_id'],
                ':event_id' => $data['event_id'],
                ':event_name' => $data['event_name'],
                ':meta_event_name' => $data['meta_event_name'],
                ':nvs_uid' => $data['nvs_uid'],
                ':nvs_sid' => $data['nvs_sid'],
                ':page_url' => self::cleanLongText($data['page_url'] ?? null),
                ':referrer' => self::cleanLongText($data['referrer'] ?? null),
                ':event_time' => $data['event_time'],
                ':source_platform' => $data['source_platform'],
                ':params_json' => self::jsonEncode($data['params'] ?? []),
                ':user_json' => self::jsonEncode($data['user'] ?? []),
                ':context_json' => self::jsonEncode($data['context'] ?? []),
                ':raw_payload_json' => self::jsonEncode($data['raw_payload'] ?? []),
            ]);

            $duplicate = $stmt->rowCount() === 0;

            $select = $pdo->prepare("
                SELECT id
                FROM {$table}
                WHERE event_id = :event_id
                LIMIT 1
            ");

            $select->execute([
                ':event_id' => $data['event_id'],
            ]);

            $id = $select->fetchColumn();

            return [
                'id' => $id ? (int) $id : null,
                'duplicate' => $duplicate,
            ];

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'BrowserRepository::saveBrowserEvent',
                'event_id' => $data['event_id'] ?? null,
                'property_id' => $data['property_id'] ?? null,
                'error' => $e->getMessage(),
            ]);

            return [
                'id' => null,
                'duplicate' => false,
            ];
        }
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

        foreach (['fbp', 'fbc', 'fbclid', 'gclid', 'ttclid', 'supremeStuid'] as $key) {
            if (!empty($payload[$key])) {
                $providerIds[$key] = $payload[$key];
            }

            if (!empty($context[$key])) {
                $providerIds[$key] = $context[$key];
            }
        }

        return array_filter($providerIds, function ($value) {
            return $value !== null && $value !== '';
        });
    }

    private static function extractUtm(array $payload, array $context): array {
        $utm = [];

        foreach (['utm', 'utm_params', 'utmParams'] as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                $utm = array_merge($utm, $payload[$key]);
            }

            if (isset($context[$key]) && is_array($context[$key])) {
                $utm = array_merge($utm, $context[$key]);
            }
        }

        foreach ([
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_content',
            'utm_term',
            'utm_id'
        ] as $key) {
            if (!empty($payload[$key])) {
                $utm[$key] = $payload[$key];
            }

            if (!empty($context[$key])) {
                $utm[$key] = $context[$key];
            }
        }

        return array_filter($utm, function ($value) {
            return $value !== null && $value !== '';
        });
    }

    private static function mapMetaEventName(string $eventName): string {
        $map = [
            'page_view' => 'PageView',
            'view_item' => 'ViewContent',
            'view_content' => 'ViewContent',
            'add_to_cart' => 'AddToCart',
            'initiate_checkout' => 'InitiateCheckout',
            'add_payment_info' => 'AddPaymentInfo',
            'lead' => 'Lead',
            'purchase' => 'Purchase',
            'complete_registration' => 'CompleteRegistration',
            'subscribe' => 'Subscribe',
        ];

        return $map[$eventName] ?? $eventName;
    }

    private static function generateEventId(string $propertyId, string $eventName, ?string $nvsUid, ?string $nvsSid): string {
        $property = preg_replace('/[^a-zA-Z0-9_]/', '_', $propertyId);
        $event = preg_replace('/[^a-zA-Z0-9_]/', '_', $eventName);

        try {
            $random = bin2hex(random_bytes(8));
        } catch (Throwable $e) {
            $random = uniqid('', true);
        }

        return 'nvs_browser_' . $property . '_' . $event . '_' . time() . '_' . ($nvsSid ?: $nvsUid ?: 'anon') . '_' . $random;
    }

    private static function jsonEncode($value): ?string {
        if ($value === null) {
            return null;
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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
