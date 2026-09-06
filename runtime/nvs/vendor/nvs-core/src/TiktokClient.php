<?php

require_once __DIR__ . '/EventDestination.php';
require_once __DIR__ . '/Env.php';
require_once __DIR__ . '/Settings.php';
require_once __DIR__ . '/Logger.php';

/**
 * Envio de eventos para a Events API do TikTok.
 *
 * Confirmado na documentacao oficial: o token vai no header `Access-Token`;
 * e-mail, telefone e external_id exigem SHA-256 do valor normalizado; a compra e
 * `CompletePayment`; o `event_id` e a chave de deduplicacao do lado do TikTok.
 *
 * `ttclid` e o identificador do clique no anuncio e `ttp` e o cookie do pixel.
 * Nenhum dos dois e hasheado.
 *
 * PRECISA DE VALIDACAO contra uma conta real. A Events API tem duas formas em
 * circulacao — `pixel/track` com `pixel_code` e `context`, e `event/track` com
 * `event_source` e `data[]`. Esta implementacao usa a segunda, que e a
 * documentada como atual, e mantem endpoint e versao configuraveis para que uma
 * troca nao exija alterar codigo.
 */
final class TiktokClient implements EventDestination
{
    private const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api';
    private const DEFAULT_API_VERSION = 'v1.3';
    private const TIMEOUT_SECONDS = 12;

    public static function key(): string
    {
        return 'tiktok';
    }

    public static function label(): string
    {
        return 'TikTok Events API';
    }

    public static function isConfigured(string $propertyId): bool
    {
        return self::pixelCode() !== null && self::accessToken() !== null;
    }

    public static function send(array $event): array
    {
        $payload = self::buildPayload($event);

        $pixelCode = self::pixelCode();
        $accessToken = self::accessToken();

        if ($pixelCode === null || $accessToken === null) {
            return self::result(false, false, 'not_configured', 'missing_pixel_code_or_access_token', $payload, null, null, null);
        }

        $url = rtrim(self::baseUrl(), '/') . '/' . self::apiVersion() . '/event/track/';
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Access-Token: ' . $accessToken,
            ],
        ]);

        $raw = curl_exec($handle);
        $httpCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $curlError = curl_error($handle) ?: null;
        curl_close($handle);

        $response = is_string($raw) ? json_decode($raw, true) : null;

        if (!is_array($response)) {
            $response = ['raw' => is_string($raw) ? substr($raw, 0, 2000) : null];
        }

        // A Events API responde HTTP 200 mesmo em erro de negocio: o que decide e
        // o campo `code`, onde 0 significa sucesso.
        $businessCode = $response['code'] ?? null;
        $ok = $httpCode >= 200 && $httpCode < 300 && ($businessCode === 0 || $businessCode === '0');

        if (!$ok) {
            Logger::write('tiktok-delivery-failed', [
                'event_id' => $event['event_id'] ?? null,
                'property_id' => $event['property_id'] ?? null,
                'http_code' => $httpCode,
                'code' => $businessCode,
                'message' => $response['message'] ?? null,
                'curl_error' => $curlError,
            ]);
        }

        return self::result($ok, true, 'event_track', null, $payload, $httpCode, $curlError, $response);
    }

    public static function buildPayload(array $event): array
    {
        $context = $event['context'] ?? [];
        $user = $event['user'] ?? [];
        $params = $event['params'] ?? [];
        $providerIds = $context['provider_ids'] ?? [];

        $data = [
            'event' => self::mapEventName((string) ($event['event_name'] ?? 'purchase')),
            'event_time' => (int) ($event['event_time'] ?? time()),
            'event_id' => $event['event_id'] ?? null,
            'user' => self::buildUser($user, $context, $providerIds),
            'properties' => self::buildProperties($params),
        ];

        $pageUrl = self::firstNonEmpty([
            $context['page_url'] ?? null,
            $context['checkout_url'] ?? null,
            $context['landing_url'] ?? null,
        ]);

        if ($pageUrl !== null) {
            $data['page'] = ['url' => $pageUrl];

            if (!empty($context['referrer'])) {
                $data['page']['referrer'] = $context['referrer'];
            }
        }

        $payload = [
            'event_source' => 'web',
            'event_source_id' => self::pixelCode(),
            'data' => [self::removeEmptyRecursive($data)],
        ];

        $testEventCode = self::firstNonEmpty([Settings::get('tiktok_test_event_code'), Env::get('TIKTOK_TEST_EVENT_CODE')]);

        if ($testEventCode !== null) {
            $payload['test_event_code'] = $testEventCode;
        }

        return $payload;
    }

    /**
     * E-mail, telefone e external_id vao hasheados. ttclid e ttp vao em claro:
     * hashear um identificador de clique o torna inutil para a plataforma.
     */
    private static function buildUser(array $user, array $context, array $providerIds): array
    {
        $email = self::firstNonEmpty([$user['email'] ?? null]);
        $phone = self::normalizePhone(self::firstNonEmpty([$user['phone'] ?? null]));
        $externalId = self::firstNonEmpty([
            $context['nvs_uid'] ?? null,
            $user['customer_id'] ?? null,
        ]);

        return [
            'email' => self::hash($email),
            'phone' => self::hash($phone),
            'external_id' => self::hash($externalId),
            'ttclid' => self::firstNonEmpty([$providerIds['ttclid'] ?? null]),
            'ttp' => self::firstNonEmpty([$providerIds['ttp'] ?? null]),
            'ip' => self::firstNonEmpty([$context['ip_address'] ?? null]),
            'user_agent' => self::firstNonEmpty([$context['user_agent'] ?? null]),
        ];
    }

    private static function buildProperties(array $params): array
    {
        $value = isset($params['value']) ? (float) $params['value'] : null;
        $currency = self::firstNonEmpty([$params['currency'] ?? null]) ?? 'BRL';

        $contents = [];

        foreach ($params['items'] ?? [] as $item) {
            $contents[] = self::removeEmptyRecursive([
                'content_id' => self::firstNonEmpty([$item['item_id'] ?? null]),
                'content_name' => self::firstNonEmpty([$item['item_name'] ?? null]),
                'quantity' => isset($item['quantity']) ? (int) $item['quantity'] : 1,
                'price' => isset($item['price']) ? (float) $item['price'] : null,
            ]);
        }

        return [
            'value' => $value,
            'currency' => $currency,
            'order_id' => self::firstNonEmpty([$params['transaction_id'] ?? null]),
            'contents' => $contents,
            'content_type' => $contents !== [] ? 'product' : null,
        ];
    }

    /**
     * O TikTok usa `Pageview`, com V minusculo apenas no P — diferente do
     * `PageView` da Meta.
     */
    private static function mapEventName(string $eventName): string
    {
        $map = [
            'purchase' => 'CompletePayment',
            'initiate_checkout' => 'InitiateCheckout',
            'add_to_cart' => 'AddToCart',
            'page_view' => 'Pageview',
            'view_content' => 'ViewContent',
            'lead' => 'SubmitForm',
            'complete_registration' => 'CompleteRegistration',
            'search' => 'Search',
        ];

        $key = strtolower(trim($eventName));

        return $map[$key] ?? 'CompletePayment';
    }

    private static function pixelCode(): ?string
    {
        return self::firstNonEmpty([
            Settings::get('tiktok_pixel_code'),
            Env::get('TIKTOK_PIXEL_CODE'),
        ]);
    }

    private static function accessToken(): ?string
    {
        return self::firstNonEmpty([
            Settings::get('tiktok_access_token'),
            Env::get('TIKTOK_ACCESS_TOKEN'),
        ]);
    }

    private static function baseUrl(): string
    {
        return self::firstNonEmpty([
            Settings::get('tiktok_base_url'),
            Env::get('TIKTOK_BASE_URL'),
        ]) ?? self::DEFAULT_BASE_URL;
    }

    private static function apiVersion(): string
    {
        return self::firstNonEmpty([
            Settings::get('tiktok_api_version'),
            Env::get('TIKTOK_API_VERSION'),
        ]) ?? self::DEFAULT_API_VERSION;
    }

    private static function result(
        bool $ok,
        bool $sent,
        ?string $mode,
        ?string $reason,
        array $payload,
        ?int $httpCode,
        ?string $curlError,
        $response
    ): array {
        return [
            'ok' => $ok,
            'sent' => $sent,
            'mode' => $mode,
            'reason' => $reason,
            'http_code' => $httpCode,
            'curl_error' => $curlError,
            'payload' => $payload,
            'response' => $response,
        ];
    }

    private static function hash(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = mb_strtolower(trim($value), 'UTF-8');

        return $value !== '' ? hash('sha256', $value) : null;
    }

    private static function normalizePhone(?string $phone): ?string
    {
        if ($phone === null) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $phone);

        if ($digits === '') {
            return null;
        }

        // O TikTok espera E.164. Numeros brasileiros sem codigo de pais recebem o 55.
        if (strlen($digits) <= 11 && strpos($digits, '55') !== 0) {
            $digits = '55' . $digits;
        }

        return '+' . $digits;
    }

    private static function firstNonEmpty(array $values): ?string
    {
        foreach ($values as $value) {
            if ($value === null || is_array($value)) {
                continue;
            }

            $value = trim((string) $value);

            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private static function removeEmptyRecursive($value)
    {
        if (!is_array($value)) {
            return $value;
        }

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
}
