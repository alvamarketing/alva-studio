<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

require_once __DIR__ . '/../../src/Env.php';
require_once __DIR__ . '/../../src/Logger.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/EventRepository.php';
require_once __DIR__ . '/../../src/CheckoutTranslatorRegistry.php';
require_once __DIR__ . '/../../src/EventFanout.php';
require_once __DIR__ . '/../../src/NvsApiSupport.php';
require_once __DIR__ . '/../../src/WebhookPropertyResolver.php';
require_once __DIR__ . '/../../src/WebhookAuthenticator.php';
require_once __DIR__ . '/../../src/RateLimiter.php';

Env::load(__DIR__ . '/../../.env');

/**
 * Resposta única de recusa.
 *
 * Antes, a resposta distinguia projeto inexistente, projeto pausado e projeto
 * processado, e devolvia os IDs sequenciais gravados no banco. Sem autenticação,
 * isso permitia varrer property_ids para descobrir quais sites existiam em um
 * Core, quais estavam ativos, e estimar o volume de vendas de cada um pelo
 * crescimento dos IDs. O motivo real continua registrado no log do servidor.
 */
function rejectRequest(string $logChannel, array $logData, int $statusCode = 400): void
{
    Logger::write($logChannel, $logData);

    jsonResponse([
        'ok' => false,
        'error' => 'rejected',
    ], $statusCode);
}

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

function cleanKey($value, string $fallback = ''): string
{
    $value = strtolower(trim((string) $value));
    $value = preg_replace('/[^a-z0-9_]/', '_', $value);
    $value = preg_replace('/_+/', '_', $value);
    $value = trim($value, '_');

    return $value !== '' ? $value : $fallback;
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

function columnExists(PDO $pdo, string $table, string $column): bool
{
    try {
        if (!tableExists($pdo, $table)) {
            return false;
        }

        $stmt = $pdo->query('SHOW COLUMNS FROM ' . q($table) . ' LIKE ' . $pdo->quote($column));
        return (bool) ($stmt ? $stmt->fetchColumn() : false);
    } catch (Throwable $e) {
        return false;
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

function extractPropertyId(array $payload, ?array $canonicalEvent = null): string
{
    $queryProperty = $_GET['property_id'] ?? $_GET['project_id'] ?? null;

    return WebhookPropertyResolver::resolve(
        $payload,
        $canonicalEvent,
        $queryProperty,
        Env::get('NVS_DEFAULT_PROPERTY_ID', null)
    );
}

function attachPropertyToRecord(string $logicalTable, ?int $id, string $propertyId): void
{
    if (!$id || $propertyId === '') {
        return;
    }

    try {
        $pdo = Database::getConnection();
        $table = Database::table($logicalTable);

        if (!tableExists($pdo, $table) || !columnExists($pdo, $table, 'property_id')) {
            return;
        }

        $stmt = $pdo->prepare('UPDATE ' . q($table) . ' SET property_id = :property_id WHERE id = :id LIMIT 1');
        $stmt->execute([
            ':property_id' => $propertyId,
            ':id' => $id,
        ]);
    } catch (Throwable $e) {
        Logger::write('property-attach-error', [
            'table' => $logicalTable,
            'id' => $id,
            'property_id' => $propertyId,
            'error' => $e->getMessage(),
        ]);
    }
}

function projectCanProcess(string $propertyId): array
{
    try {
        $pdo = Database::getConnection();
        $propertiesTable = Database::table('properties');

        // Fail-closed: uma instalação sem a tabela de projetos está incompleta.
        // Antes esse caso retornava ok=true e o Core processava tudo e disparava
        // para a Meta a partir de um banco que ainda não sabia quais projetos
        // existiam.
        if (!tableExists($pdo, $propertiesTable)) {
            return [
                'ok' => false,
                'known' => false,
                'active' => false,
                'reason' => 'properties_table_missing',
            ];
        }

        $project = getProject($pdo, $propertyId);

        if (!$project) {
            return [
                'ok' => false,
                'known' => false,
                'active' => false,
                'reason' => 'unknown_project',
            ];
        }

        if ((int) ($project['is_active'] ?? 0) !== 1) {
            return [
                'ok' => false,
                'known' => true,
                'active' => false,
                'reason' => 'inactive_project',
                'project' => $project,
            ];
        }

        return [
            'ok' => true,
            'known' => true,
            'active' => true,
            'reason' => 'active_project',
            'project' => $project,
        ];
    } catch (Throwable $e) {
        Logger::write('project-status-check-error', [
            'property_id' => $propertyId,
            'error' => $e->getMessage(),
        ]);

        return [
            'ok' => false,
            'known' => false,
            'active' => false,
            'reason' => 'project_status_check_failed',
            'error' => $e->getMessage(),
        ];
    }
}

$remoteIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

$rateLimitDirectory = dirname(__DIR__, 2) . '/storage/ratelimit';
$rateLimit = (int) Env::get('NVS_WEBHOOK_RATE_LIMIT', 120);
$rateWindow = (int) Env::get('NVS_WEBHOOK_RATE_WINDOW', 60);

$rateResult = RateLimiter::check($rateLimitDirectory, $remoteIp, $rateLimit, $rateWindow);

// Varredura ocasional para que chaves inativas não acumulem arquivos.
if (random_int(1, 100) === 1) {
    RateLimiter::collectGarbage($rateLimitDirectory, $rateWindow);
}

if (!$rateResult['allowed']) {
    header('Retry-After: ' . $rateResult['retry_after']);

    rejectRequest('webhook-rate-limited', [
        'ip' => $remoteIp,
        'count' => $rateResult['count'],
        'limit' => $rateLimit,
        'window_seconds' => $rateWindow,
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
    ], 429);
}

$platform = $_GET['platform'] ?? null;
$action = $_GET['action'] ?? null;

if (!$platform || !$action) {
    rejectRequest('webhook-invalid-request', [
        'ip' => $remoteIp,
        'reason' => 'missing_platform_or_action',
    ], 400);
}

/**
 * Autenticação obrigatória.
 *
 * O segredo é exigido em todos os casos. Um Core sem NVS_WEBHOOK_SECRET
 * configurado recusa todos os webhooks: rodar sem segredo é misconfiguração,
 * não compatibilidade. Ver WebhookAuthenticator para o histórico da mudança.
 */
$auth = WebhookAuthenticator::authenticate(
    Env::get('NVS_WEBHOOK_SECRET'),
    $_SERVER,
    $_GET
);

if (!$auth['ok']) {
    rejectRequest('webhook-auth-failed', [
        'platform' => $platform,
        'action' => $action,
        'ip' => $remoteIp,
        'reason' => $auth['status'],
        'headers' => [
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
            'x_nvs_event' => $_SERVER['HTTP_X_NVS_EVENT'] ?? null,
            'x_nvs_delivery_id' => $_SERVER['HTTP_X_NVS_DELIVERY_ID'] ?? null,
            'x_nvs_timestamp' => $_SERVER['HTTP_X_NVS_TIMESTAMP'] ?? null,
        ],
    ], 401);
}

$authStatus = $auth['status'];

/**
 * Teto de corpo antes de ler e antes de gravar.
 *
 * O payload é persistido no MySQL e escrito no log em disco. Sem teto, um corpo
 * grande repetido enche o disco do servidor. CONTENT_LENGTH é apenas uma dica:
 * a leitura também é truncada e conferida.
 */
$maxBodyBytes = (int) Env::get('NVS_WEBHOOK_MAX_BODY_BYTES', 262144);

if ($maxBodyBytes > 0) {
    $declaredLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);

    if ($declaredLength > $maxBodyBytes) {
        rejectRequest('webhook-body-too-large', [
            'platform' => $platform,
            'action' => $action,
            'ip' => $remoteIp,
            'declared_bytes' => $declaredLength,
            'max_bytes' => $maxBodyBytes,
        ], 413);
    }

    $rawBody = (string) file_get_contents('php://input', false, null, 0, $maxBodyBytes + 1);

    if (strlen($rawBody) > $maxBodyBytes) {
        rejectRequest('webhook-body-too-large', [
            'platform' => $platform,
            'action' => $action,
            'ip' => $remoteIp,
            'declared_bytes' => $declaredLength,
            'read_bytes' => strlen($rawBody),
            'max_bytes' => $maxBodyBytes,
        ], 413);
    }
} else {
    $rawBody = (string) file_get_contents('php://input');
}

$payload = json_decode($rawBody, true);

if (!is_array($payload)) {
    rejectRequest('webhook-invalid-json', [
        'platform' => $platform,
        'action' => $action,
        'auth_status' => $authStatus,
        'method' => $_SERVER['REQUEST_METHOD'] ?? null,
        'ip' => $remoteIp,
        // Amostra suficiente para diagnosticar sem copiar o corpo inteiro no log.
        'raw_body_sample' => substr($rawBody, 0, 2048),
        'raw_body_bytes' => strlen($rawBody),
        'headers' => [
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
            'x_nvs_event' => $_SERVER['HTTP_X_NVS_EVENT'] ?? null,
            'x_nvs_delivery_id' => $_SERVER['HTTP_X_NVS_DELIVERY_ID'] ?? null,
            'x_nvs_timestamp' => $_SERVER['HTTP_X_NVS_TIMESTAMP'] ?? null,
        ],
    ], 400);
}

$headersForStorage = [
    'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
    'x_nvs_event' => $_SERVER['HTTP_X_NVS_EVENT'] ?? null,
    'x_nvs_delivery_id' => $_SERVER['HTTP_X_NVS_DELIVERY_ID'] ?? null,
    'x_nvs_timestamp' => $_SERVER['HTTP_X_NVS_TIMESTAMP'] ?? null,
];

$preliminaryPropertyId = extractPropertyId($payload, null);

Logger::write('webhook-received', [
    'platform' => $platform,
    'action' => $action,
    'property_id' => $preliminaryPropertyId,
    'auth_status' => $authStatus,
    'method' => $_SERVER['REQUEST_METHOD'] ?? null,
    'ip' => $_SERVER['REMOTE_ADDR'] ?? null,
    'headers' => $headersForStorage,
    'payload' => $payload,
]);

$webhookDbId = EventRepository::saveWebhook(
    $platform,
    $action,
    $authStatus,
    $payload,
    $headersForStorage
);

attachPropertyToRecord('webhooks', $webhookDbId, $preliminaryPropertyId);

$canonicalEvent = CheckoutTranslatorRegistry::translate($platform, $action, $payload);

if (!$canonicalEvent) {
    Logger::write('event-ignored', [
        'platform' => $platform,
        'action' => $action,
        'property_id' => $preliminaryPropertyId,
        'webhook_db_id' => $webhookDbId,
        'reason' => 'empty_translation_or_unsupported_event',
        'payload_event' => $payload['event'] ?? $payload['body']['event'] ?? null,
        'payload_status' => $payload['order']['status'] ?? $payload['body']['order']['status'] ?? null,
    ]);

    // 200 proposital: o evento foi recebido e registrado, apenas não gera
    // conversão. Responder erro faria a plataforma reenviar indefinidamente.
    // O motivo fica no log; a resposta não distingue os casos de recusa.
    jsonResponse([
        'ok' => true,
        'system' => 'nvs-track',
        'platform' => $platform,
        'action' => $action,
        'status' => 'ignored',
    ]);
}

$propertyId = extractPropertyId($payload, $canonicalEvent);

$canonicalEvent['property_id'] = $propertyId;

if (!isset($canonicalEvent['context']) || !is_array($canonicalEvent['context'])) {
    $canonicalEvent['context'] = [];
}

$canonicalEvent['context']['property_id'] = $propertyId;
$canonicalEvent['context']['nvs_property_id'] = $propertyId;

attachPropertyToRecord('webhooks', $webhookDbId, $propertyId);

$projectStatus = projectCanProcess($propertyId);

if (empty($projectStatus['ok'])) {
    Logger::write('event-ignored', [
        'platform' => $platform,
        'action' => $action,
        'property_id' => $propertyId,
        'webhook_db_id' => $webhookDbId,
        'reason' => $projectStatus['reason'] ?? 'project_not_processable',
        'canonical_event' => $canonicalEvent,
    ]);

    jsonResponse([
        'ok' => true,
        'system' => 'nvs-track',
        'platform' => $platform,
        'action' => $action,
        'status' => 'ignored',
    ]);
}

Logger::write('event-translated', [
    'platform' => $platform,
    'action' => $action,
    'property_id' => $propertyId,
    'auth_status' => $authStatus,
    'webhook_db_id' => $webhookDbId,
    'event' => $canonicalEvent,
]);

$eventDbId = EventRepository::saveEvent($canonicalEvent);
attachPropertyToRecord('events', $eventDbId, $propertyId);

/**
 * Um evento canonico, N destinos.
 *
 * A logica de leque mora em EventFanout, compartilhada com a ingestao de eventos
 * do navegador, para que as duas entradas nao divirjam em deduplicacao e
 * tratamento de falha.
 */
$deliveryDetails = EventFanout::deliver($canonicalEvent, [], [
    'platform' => $platform,
    'action' => $action,
    'webhook_db_id' => $webhookDbId,
    'event_db_id' => $eventDbId,
]);

$deliveryResults = EventFanout::summarize($deliveryDetails);

foreach ($deliveryDetails as $key => $entry) {
    attachPropertyToRecord('meta_deliveries', $entry['delivery_db_id'], $propertyId);
}

// O bloco `meta` da resposta e do log e mantido por compatibilidade: o dashboard e
// o reprocessamento ainda leem esse formato.
$metaResult = $deliveryDetails['meta']['result'] ?? null;
$metaDeliveryDbId = $deliveryDetails['meta']['delivery_db_id'] ?? null;

Logger::write('event-processed', [
    'platform' => $platform,
    'action' => $action,
    'property_id' => $propertyId,
    'auth_status' => $authStatus,
    'webhook_db_id' => $webhookDbId,
    'event_db_id' => $eventDbId,
    'meta_delivery_db_id' => $metaDeliveryDbId,
    'event_id' => $canonicalEvent['event_id'] ?? null,
    'event_name' => $canonicalEvent['event_name'] ?? null,
    'meta_event_name' => $canonicalEvent['meta_event_name'] ?? null,
    'meta_result' => $metaResult,
    'deliveries' => $deliveryResults,
]);

// Os IDs sequenciais de banco saíram da resposta: eles não servem a quem chama
// e, enfileirados, revelam o volume de vendas do Core. O event_id devolvido é o
// mesmo que a plataforma já enviou, e continua sendo a chave de rastreio.
jsonResponse([
    'ok' => true,
    'system' => 'nvs-track',
    'platform' => $platform,
    'action' => $action,
    'property_id' => $propertyId,
    'status' => 'processed',
    'event_name' => $canonicalEvent['event_name'] ?? null,
    'event_id' => $canonicalEvent['event_id'] ?? null,
    'meta' => [
        'ok' => $metaResult['ok'] ?? false,
        'sent' => $metaResult['sent'] ?? false,
        'mode' => $metaResult['mode'] ?? null,
        'reason' => $metaResult['reason'] ?? null,
        'http_code' => $metaResult['http_code'] ?? null,
    ],
    'deliveries' => $deliveryResults,
]);
