<?php

/**
 * Converte o payload do navegador para o evento canonico.
 *
 * O `nvs.js` envia um formato proprio ao `ingest.php`, e o BrowserCapiClient
 * consome esse formato direto. Para que os demais destinos recebam eventos de
 * navegador sem reimplementar cada um o parsing do payload cru, o formato e
 * convertido aqui para o mesmo evento canonico que os tradutores de checkout
 * produzem.
 *
 * O caminho da Meta continua no BrowserCapiClient. Ele carrega o comportamento
 * de PageView Browser + Server com identificador compartilhado, validado em
 * producao, e nao vale reescrever para ganhar simetria.
 */
class BrowserEventNormalizer
{
    /**
     * Motivos que valem para qualquer destino, nao apenas para a Meta.
     *
     * `config_missing` esta deliberadamente fora: ele significa que falta Pixel ou
     * token DA META. Bloquear o TikTok por isso o impediria de receber eventos de
     * quem ainda nao configurou a Meta.
     */
    private const BLOCKING_REASONS = [
        'missing_event_id',
        'property_not_found',
        'property_inactive',
        'browser_capi_disabled_for_property',
        'event_not_allowed_for_property',
    ];

    private const BLOCKING_MODES = [
        'debug',
        'property_missing',
        'browser_capi_client_missing',
    ];

    /**
     * O evento passou pelos portoes de projeto e de tipo de evento, e pode seguir
     * para os outros destinos.
     */
    public static function allowsAdditionalDestinations(array $metaResult): bool
    {
        $reason = (string) ($metaResult['reason'] ?? '');
        $mode = (string) ($metaResult['mode'] ?? '');

        if (in_array($reason, self::BLOCKING_REASONS, true)) {
            return false;
        }

        return !in_array($mode, self::BLOCKING_MODES, true);
    }

    public static function toCanonicalEvent(
        array $payload,
        array $serverContext = [],
        array $ingestResult = []
    ): array {
        $payloadContext = is_array($payload['context'] ?? null) ? $payload['context'] : [];

        $propertyId = self::cleanKey(
            $ingestResult['property_id']
            ?? $payload['property_id']
            ?? $payloadContext['property_id']
            ?? 'default',
            'default'
        );

        $eventName = self::cleanKey(
            $ingestResult['event_name'] ?? $payload['event_name'] ?? 'page_view',
            'page_view'
        );

        $params = is_array($payload['params'] ?? null) ? $payload['params'] : [];
        $utm = self::collect($payload, $payloadContext, 'utm');
        $providerIds = self::collect($payload, $payloadContext, 'provider_ids', 'providerIds');

        return [
            'property_id' => $propertyId,
            'event_id' => self::text($ingestResult['event_id'] ?? $payload['event_id'] ?? null),
            'event_name' => $eventName,
            'meta_event_name' => self::text($ingestResult['meta_event_name'] ?? null),
            'event_time' => self::timestamp($payload['event_time'] ?? $payloadContext['event_time'] ?? null) ?? time(),
            'source' => 'browser',
            'source_platform' => self::text($payload['source_platform'] ?? null) ?? 'browser',

            'context' => [
                'property_id' => $propertyId,
                'cookie_prefix' => self::text($payload['cookie_prefix'] ?? $payloadContext['cookie_prefix'] ?? null),
                'nvs_uid' => self::text($ingestResult['nvs_uid'] ?? $payload['nvs_uid'] ?? $payloadContext['nvs_uid'] ?? null),
                'nvs_sid' => self::text($ingestResult['nvs_sid'] ?? $payload['nvs_sid'] ?? $payloadContext['nvs_sid'] ?? null),
                'page_url' => self::text($payload['page_url'] ?? $payloadContext['page_url'] ?? null),
                'landing_url' => self::text($payload['landing_url'] ?? $payloadContext['landing_url'] ?? null),
                'checkout_url' => self::text($payload['checkout_url'] ?? $payloadContext['checkout_url'] ?? null),
                'referrer' => self::text($payload['referrer'] ?? $payloadContext['referrer'] ?? null),
                'ip_address' => self::text($serverContext['ip_address'] ?? null),
                'user_agent' => self::text($serverContext['user_agent'] ?? null),
                'utm' => self::normalizeUtm($utm),
                'provider_ids' => self::normalizeProviderIds($providerIds),
                'checkout_session_id' => self::text($payloadContext['checkout_session_id'] ?? null),
                'captured_at' => self::text($payloadContext['captured_at'] ?? null),
            ],

            'user' => [
                'customer_id' => self::text($params['customer_id'] ?? null),
                'email' => self::text($params['email'] ?? $payload['email'] ?? null),
                'phone' => self::text($params['phone'] ?? $payload['phone'] ?? null),
                'full_name' => self::text($params['full_name'] ?? $params['name'] ?? null),
                'first_name' => self::text($params['first_name'] ?? null),
                'last_name' => self::text($params['last_name'] ?? null),
                'country' => self::text($params['country'] ?? null),
                'locale' => self::text($params['locale'] ?? null),
            ],

            'params' => array_merge($params, [
                'value' => isset($params['value']) ? (float) $params['value'] : null,
                'currency' => self::text($params['currency'] ?? null) ?? 'BRL',
                'items' => is_array($params['items'] ?? null) ? $params['items'] : [],
            ]),
        ];
    }

    /**
     * Reune um bloco que pode chegar na raiz do payload ou no contexto, aceitando
     * nome em snake_case e camelCase.
     */
    private static function collect(array $payload, array $context, string ...$keys): array
    {
        $collected = [];

        foreach ($keys as $key) {
            foreach ([$context[$key] ?? null, $payload[$key] ?? null] as $candidate) {
                if (is_array($candidate)) {
                    $collected = array_merge($collected, $candidate);
                }
            }
        }

        return $collected;
    }

    private static function normalizeUtm(array $utm): array
    {
        $pick = static function (array $keys) use ($utm): ?string {
            foreach ($keys as $key) {
                $value = self::text($utm[$key] ?? null);

                if ($value !== null) {
                    return $value;
                }
            }

            return null;
        };

        return [
            'utm_source' => $pick(['utm_source', 'source']),
            'utm_medium' => $pick(['utm_medium', 'medium']),
            'utm_campaign' => $pick(['utm_campaign', 'campaign']),
            'utm_content' => $pick(['utm_content', 'content']),
            'utm_term' => $pick(['utm_term', 'term']),
            'utm_id' => $pick(['utm_id', 'id']),
        ];
    }

    private static function normalizeProviderIds(array $providerIds): array
    {
        $pick = static function (array $keys) use ($providerIds): ?string {
            foreach ($keys as $key) {
                $value = self::text($providerIds[$key] ?? null);

                if ($value !== null) {
                    return $value;
                }
            }

            return null;
        };

        return [
            'fbp' => $pick(['fbp', '_fbp']),
            'fbc' => $pick(['fbc', '_fbc']),
            'fbclid' => $pick(['fbclid']),
            'gclid' => $pick(['gclid']),
            'ttclid' => $pick(['ttclid']),
            'ttp' => $pick(['ttp', '_ttp']),
        ];
    }

    private static function timestamp($value): ?int
    {
        if ($value === null || $value === '' || is_array($value)) {
            return null;
        }

        if (is_numeric($value)) {
            $number = (float) $value;

            return $number > 9999999999 ? (int) floor($number / 1000) : (int) $number;
        }

        $parsed = strtotime((string) $value);

        return $parsed !== false ? $parsed : null;
    }

    private static function text($value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }

    private static function cleanKey($value, string $fallback): string
    {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('/[^a-z0-9_]/', '_', $value);
        $value = preg_replace('/_+/', '_', $value);
        $value = trim($value, '_');

        return $value !== '' ? $value : $fallback;
    }
}
