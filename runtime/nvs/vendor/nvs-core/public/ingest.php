<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if ($origin) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
} else {
    header('Access-Control-Allow-Origin: *');
}

header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../src/Env.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Logger.php';
require_once __DIR__ . '/../src/BrowserRepository.php';
require_once __DIR__ . '/../src/NvsApiSupport.php';
require_once __DIR__ . '/../src/TrafficClassifier.php';

$browserCapiClientPath = __DIR__ . '/../src/BrowserCapiClient.php';
if (is_file($browserCapiClientPath)) {
    require_once $browserCapiClientPath;
}

require_once __DIR__ . '/../src/BrowserEventNormalizer.php';
require_once __DIR__ . '/../src/EventFanout.php';

Env::load(__DIR__ . '/../.env');

function jsonResponse(array $data, int $statusCode = 200): void
{
    $data['system'] = 'nvs-track-core';
    $data['contract_version'] = NvsApiSupport::CONTRACT_VERSION;
    $data['core_version'] = NvsApiSupport::CORE_VERSION;
    $data['timezone'] = NvsApiSupport::VIEWER_TIMEZONE;
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function q(string $identifier): string
{
    return '`' . str_replace('`', '``', $identifier) . '`';
}

function readJsonBody(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $decoded = json_decode($rawBody, true);

    if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
        return $decoded;
    }

    return [
        '__invalid_json' => true,
        '__raw_body' => $rawBody,
        '__json_error' => json_last_error_msg(),
    ];
}

function cleanKey($value, string $fallback): string
{
    $value = strtolower(trim((string) $value));
    $value = preg_replace('/[^a-z0-9_]/', '_', $value);
    $value = preg_replace('/_+/', '_', $value);
    $value = trim($value, '_');

    return $value !== '' ? $value : $fallback;
}

function getClientIp(): ?string
{
    $candidates = [
        $_SERVER['HTTP_CF_CONNECTING_IP'] ?? null,
        $_SERVER['HTTP_X_REAL_IP'] ?? null,
        $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null,
        $_SERVER['REMOTE_ADDR'] ?? null,
    ];

    foreach ($candidates as $candidate) {
        if (!$candidate) {
            continue;
        }

        $parts = explode(',', (string) $candidate);
        $ip = trim($parts[0]);

        if ($ip !== '') {
            return $ip;
        }
    }

    return null;
}

function generateId(string $prefix): string
{
    try {
        return $prefix . '_' . time() . '_' . bin2hex(random_bytes(10));
    } catch (Throwable $e) {
        return $prefix . '_' . time() . '_' . uniqid('', true);
    }
}

function cookieOptions(int $maxAge): array
{
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';

    return [
        'expires' => time() + $maxAge,
        'path' => '/',
        'secure' => $secure,
        'httponly' => false,
        'samesite' => 'Lax',
    ];
}

function setTrackingCookie(string $name, string $value, int $maxAge): void
{
    if ($name === '' || $value === '') {
        return;
    }

    setcookie($name, $value, cookieOptions($maxAge));
}

function tableExists(PDO $pdo, string $table): bool
{
    try {
        $stmt = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table));
        return (bool) ($stmt ? $stmt->fetchColumn() : false);
    } catch (Throwable $e) {
        return false;
    }
}

function normalizeHost(?string $host): string
{
    $host = strtolower(trim((string) $host));
    $host = preg_replace('/:\d+$/', '', $host);
    $host = trim($host, " \t\n\r\0\x0B.");

    return $host;
}

function extractHostFromUrl(?string $url): string
{
    $url = trim((string) $url);

    if ($url === '') {
        return '';
    }

    $host = parse_url($url, PHP_URL_HOST);

    if (!$host && !preg_match('#^https?://#i', $url)) {
        $host = parse_url('https://' . ltrim($url, '/'), PHP_URL_HOST);
    }

    return normalizeHost($host ?: '');
}

function extractHostFromPayload(array $payload, string $origin = ''): string
{
    $context = is_array($payload['context'] ?? null) ? $payload['context'] : [];

    $candidates = [
        $origin,
        $payload['page_url'] ?? null,
        $payload['url'] ?? null,
        $context['page_url'] ?? null,
        $context['url'] ?? null,
        $context['landing_url'] ?? null,
        $payload['referrer'] ?? null,
        $context['referrer'] ?? null,
    ];

    foreach ($candidates as $candidate) {
        $host = extractHostFromUrl(is_string($candidate) ? $candidate : '');

        if ($host !== '') {
            return $host;
        }
    }

    return '';
}

function normalizeAllowedDomains(?string $domain): array
{
    $domain = trim((string) $domain);

    if ($domain === '') {
        return [];
    }

    $parts = preg_split('/[\s,;]+/', $domain) ?: [];
    $domains = [];

    foreach ($parts as $part) {
        $part = trim($part);

        if ($part === '') {
            continue;
        }

        $host = extractHostFromUrl($part);
        $host = $host !== '' ? $host : normalizeHost($part);

        if ($host !== '') {
            $domains[] = $host;
        }
    }

    return array_values(array_unique($domains));
}

function hostMatchesAllowedDomain(string $host, string $allowedDomain): bool
{
    $host = normalizeHost($host);
    $allowedDomain = normalizeHost($allowedDomain);

    if ($host === '' || $allowedDomain === '') {
        return false;
    }

    if ($host === $allowedDomain) {
        return true;
    }

    if (str_starts_with($host, 'www.') && substr($host, 4) === $allowedDomain) {
        return true;
    }

    if (str_starts_with($allowedDomain, 'www.') && $host === substr($allowedDomain, 4)) {
        return true;
    }

    return false;
}

function saveIgnoredEvent(PDO $pdo, string $propertyId, string $eventName, string $botName): void
{
    $table = Database::table('ignored_events');

    try {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS ' . q($table) . ' ('
            . 'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,'
            . 'property_id VARCHAR(100) NOT NULL,'
            . 'event_name VARCHAR(120) NULL,'
            . 'reason VARCHAR(80) NOT NULL,'
            . 'bot_name VARCHAR(120) NULL,'
            . 'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,'
            . 'PRIMARY KEY (id),'
            . 'KEY idx_property_id (property_id),'
            . 'KEY idx_reason (reason),'
            . 'KEY idx_created_at (created_at)'
            . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );

        $stmt = $pdo->prepare(
            'INSERT INTO ' . q($table) . ' (property_id, event_name, reason, bot_name)'
            . ' VALUES (:property_id, :event_name, :reason, :bot_name)'
        );
        $stmt->execute([
            ':property_id' => $propertyId,
            ':event_name' => $eventName,
            ':reason' => 'known_bot',
            ':bot_name' => $botName,
        ]);
    } catch (Throwable $e) {
        Logger::write('ignored-event-save-error', [
            'reason' => 'known_bot',
            'property_id' => $propertyId,
            'error' => $e->getMessage(),
        ]);
    }
}

function getProject(PDO $pdo, string $propertyId): ?array
{
    $table = Database::table('properties');

    if (!tableExists($pdo, $table)) {
        return null;
    }

    $stmt = $pdo->prepare('SELECT * FROM ' . q($table) . ' WHERE property_id = :property_id LIMIT 1');
    $stmt->execute([
        ':property_id' => $propertyId,
    ]);

    $project = $stmt->fetch(PDO::FETCH_ASSOC);

    return $project ?: null;
}

function validateProjectDomain(array $project, array $payload, string $origin = ''): array
{
    $allowedDomains = normalizeAllowedDomains($project['domain'] ?? '');

    if (!$allowedDomains) {
        return [
            'ok' => true,
            'mode' => 'no_domain_configured',
            'request_host' => extractHostFromPayload($payload, $origin),
            'allowed_domains' => [],
        ];
    }

    $requestHost = extractHostFromPayload($payload, $origin);

    if ($requestHost === '') {
        return [
            'ok' => false,
            'mode' => 'host_not_found',
            'request_host' => '',
            'allowed_domains' => $allowedDomains,
        ];
    }

    foreach ($allowedDomains as $allowedDomain) {
        if (hostMatchesAllowedDomain($requestHost, $allowedDomain)) {
            return [
                'ok' => true,
                'mode' => 'matched',
                'request_host' => $requestHost,
                'allowed_domains' => $allowedDomains,
                'matched_domain' => $allowedDomain,
            ];
        }
    }

    return [
        'ok' => false,
        'mode' => 'not_allowed',
        'request_host' => $requestHost,
        'allowed_domains' => $allowedDomains,
    ];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track',
        'error' => 'method_not_allowed',
        'message' => 'Use POST with JSON body.',
    ], 405);
}

$payload = readJsonBody();

if (!empty($payload['__invalid_json'])) {
    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track',
        'error' => 'invalid_json',
        'message' => $payload['__json_error'] ?? 'Invalid JSON body.',
    ], 400);
}

$context = is_array($payload['context'] ?? null) ? $payload['context'] : [];

$propertyId = cleanKey(
    $payload['property_id']
    ?? $payload['nvs_property_id']
    ?? ($context['property_id'] ?? null)
    ?? ($context['nvs_property_id'] ?? null)
    ?? Env::get('NVS_DEFAULT_PROPERTY_ID', 'default'),
    'default'
);

$cookiePrefix = cleanKey(
    $payload['cookie_prefix']
    ?? ($context['cookie_prefix'] ?? null)
    ?? ($propertyId === 'default' ? 'nvs' : 'nvs_' . $propertyId),
    $propertyId === 'default' ? 'nvs' : 'nvs_' . $propertyId
);

try {
    $pdo = Database::getConnection();
    $project = getProject($pdo, $propertyId);

    if (!$project) {
        Logger::write('browser-ingest-ignored', [
            'reason' => 'unknown_project',
            'property_id' => $propertyId,
            'origin' => $origin,
            'ip' => getClientIp(),
        ]);

        jsonResponse([
            'ok' => false,
            'ignored' => true,
            'system' => 'nvs-track',
            'reason' => 'unknown_project',
            'property_id' => $propertyId,
        ], 404);
    }

    if ((int) ($project['is_active'] ?? 0) !== 1) {
        Logger::write('browser-ingest-ignored', [
            'reason' => 'inactive_project',
            'property_id' => $propertyId,
            'origin' => $origin,
            'ip' => getClientIp(),
        ]);

        jsonResponse([
            'ok' => false,
            'ignored' => true,
            'system' => 'nvs-track',
            'reason' => 'inactive_project',
            'property_id' => $propertyId,
        ]);
    }

    $domainValidation = validateProjectDomain($project, $payload, $origin);

    if (empty($domainValidation['ok'])) {
        Logger::write('browser-ingest-blocked', [
            'reason' => 'origin_not_allowed',
            'property_id' => $propertyId,
            'origin' => $origin,
            'request_host' => $domainValidation['request_host'] ?? null,
            'allowed_domains' => $domainValidation['allowed_domains'] ?? [],
            'ip' => getClientIp(),
        ]);

        jsonResponse([
            'ok' => false,
            'ignored' => true,
            'system' => 'nvs-track',
            'reason' => 'origin_not_allowed',
            'property_id' => $propertyId,
            'request_host' => $domainValidation['request_host'] ?? null,
        ], 403);
    }

    $knownBot = TrafficClassifier::knownBotName($_SERVER['HTTP_USER_AGENT'] ?? null);

    if ($knownBot !== null) {
        $eventName = cleanKey($payload['event_name'] ?? 'page_view', 'page_view');
        saveIgnoredEvent($pdo, $propertyId, $eventName, $knownBot);
        Logger::write('browser-ingest-ignored', [
            'reason' => 'known_bot',
            'property_id' => $propertyId,
            'event_name' => $eventName,
            'bot_name' => $knownBot,
        ]);

        jsonResponse([
            'ok' => false,
            'ignored' => true,
            'system' => 'nvs-track-core',
            'reason' => 'known_bot',
            'property_id' => $propertyId,
        ]);
    }
} catch (Throwable $e) {
    Logger::write('browser-ingest-project-check-error', [
        'error' => $e->getMessage(),
        'property_id' => $propertyId,
        'origin' => $origin,
    ]);

    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track',
        'error' => 'project_check_failed',
        'message' => $e->getMessage(),
    ], 500);
}

$uidCookieName = $cookiePrefix . '_uid';
$sidCookieName = $cookiePrefix . '_sid';

$nvsUid = $payload['nvs_uid']
    ?? $context['nvs_uid']
    ?? ($_COOKIE[$uidCookieName] ?? null);

$nvsSid = $payload['nvs_sid']
    ?? $context['nvs_sid']
    ?? ($_COOKIE[$sidCookieName] ?? null);

if (!$nvsUid) {
    $nvsUid = generateId($cookiePrefix);
}

if (!$nvsSid) {
    $nvsSid = generateId($cookiePrefix . '_sid');
}

$payload['property_id'] = $propertyId;
$payload['nvs_property_id'] = $propertyId;
$payload['cookie_prefix'] = $cookiePrefix;
$payload['nvs_uid'] = $nvsUid;
$payload['nvs_sid'] = $nvsSid;

if (!isset($payload['context']) || !is_array($payload['context'])) {
    $payload['context'] = [];
}

$payload['context']['property_id'] = $propertyId;
$payload['context']['nvs_property_id'] = $propertyId;
$payload['context']['cookie_prefix'] = $cookiePrefix;
$payload['context']['nvs_uid'] = $nvsUid;
$payload['context']['nvs_sid'] = $nvsSid;

if (empty($payload['source_platform'])) {
    $payload['source_platform'] = 'browser';
}

setTrackingCookie($uidCookieName, $nvsUid, 60 * 60 * 24 * 395);
setTrackingCookie($sidCookieName, $nvsSid, 60 * 30);

$serverContext = [
    'ip_address' => getClientIp(),
    'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
];

try {
    $result = BrowserRepository::ingest($payload, $serverContext);

    $metaResult = [
        'ok' => false,
        'sent' => false,
        'mode' => 'browser_capi_client_missing',
        'reason' => 'BrowserCapiClient class not available',
        'http_code' => null,
    ];

    if (class_exists('BrowserCapiClient')) {
        $metaResult = BrowserCapiClient::maybeSend($payload, $serverContext, $result);
    }

    /**
     * Destinos alem da Meta.
     *
     * A Meta continua no BrowserCapiClient, que carrega o PageView Browser +
     * Server com identificador compartilhado, validado em producao. Os demais
     * destinos recebem o mesmo evento em formato canonico.
     *
     * Os portoes de projeto e de tipo de evento sao decisao do operador e valem
     * para todos os destinos, entao a elegibilidade e lida do resultado da Meta.
     * A excecao e `config_missing`, que significa falta de Pixel ou token DA
     * META e nao pode impedir os outros destinos.
     */
    $browserDeliveries = [];

    if (BrowserEventNormalizer::allowsAdditionalDestinations($metaResult)) {
        $browserDeliveries = EventFanout::summarize(
            EventFanout::deliver(
                BrowserEventNormalizer::toCanonicalEvent($payload, $serverContext, $result),
                ['meta'],
                [
                    'source' => 'browser_ingest',
                    'property_id' => $result['property_id'] ?? $propertyId,
                ]
            )
        );
    }

    Logger::write('browser-ingest', [
        'ok' => true,
        'property_id' => $result['property_id'] ?? $propertyId,
        'event_id' => $result['event_id'] ?? null,
        'event_name' => $result['event_name'] ?? null,
        'meta_event_name' => $result['meta_event_name'] ?? null,
        'nvs_uid' => $result['nvs_uid'] ?? null,
        'nvs_sid' => $result['nvs_sid'] ?? null,
        'duplicate' => $result['duplicate'] ?? false,
        'meta' => [
            'ok' => $metaResult['ok'] ?? null,
            'sent' => $metaResult['sent'] ?? null,
            'mode' => $metaResult['mode'] ?? null,
            'reason' => $metaResult['reason'] ?? null,
            'http_code' => $metaResult['http_code'] ?? null,
        ],
        'deliveries' => $browserDeliveries,
    ]);

    jsonResponse([
        'ok' => true,
        'system' => 'nvs-track',
        'status' => !empty($result['duplicate']) ? 'duplicate' : 'saved',
        'data' => $result,
        'meta' => [
            'ok' => $metaResult['ok'] ?? false,
            'sent' => $metaResult['sent'] ?? false,
            'mode' => $metaResult['mode'] ?? null,
            'reason' => $metaResult['reason'] ?? null,
            'http_code' => $metaResult['http_code'] ?? null,
            'extra' => $metaResult['extra'] ?? null,
        ],
        'deliveries' => $browserDeliveries,
    ]);
} catch (Throwable $e) {
    Logger::write('browser-ingest-error', [
        'error' => $e->getMessage(),
        'property_id' => $propertyId ?? null,
        'payload' => $payload,
    ]);

    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track',
        'error' => 'browser_ingest_failed',
        'message' => $e->getMessage(),
    ], 500);
}
