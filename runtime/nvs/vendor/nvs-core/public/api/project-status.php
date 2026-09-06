<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../../src/Env.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Logger.php';

Env::load(__DIR__ . '/../../.env');

function jsonResponse(array $data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
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

function getAuthorizationHeader(): string
{
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return trim((string) $_SERVER['HTTP_AUTHORIZATION']);
    }

    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return trim((string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    }

    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();

        foreach ($headers as $name => $value) {
            if (strtolower((string) $name) === 'authorization') {
                return trim((string) $value);
            }
        }
    }

    return '';
}

function getBearerToken(): string
{
    $header = getAuthorizationHeader();

    if ($header === '' || stripos($header, 'Bearer ') !== 0) {
        return '';
    }

    return trim(substr($header, 7));
}

function authenticateRequest(): array
{
    $viewerToken = (string) Env::get('NVS_VIEWER_API_TOKEN', '');
    $dashboardKey = (string) Env::get('DASHBOARD_KEY', '');
    $providedBearer = getBearerToken();
    $providedKey = trim((string) ($_GET['key'] ?? ''));

    if ($viewerToken !== '' && $providedBearer !== '' && hash_equals($viewerToken, $providedBearer)) {
        return [
            'ok' => true,
            'mode' => 'viewer_token',
            'role' => 'viewer',
        ];
    }

    if ($dashboardKey !== '' && $providedKey !== '' && hash_equals($dashboardKey, $providedKey)) {
        return [
            'ok' => true,
            'mode' => 'dashboard_key',
            'role' => 'admin',
        ];
    }

    return [
        'ok' => false,
        'mode' => 'none',
        'role' => 'none',
    ];
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

function parseBooleanValue($value): ?bool
{
    if (is_bool($value)) {
        return $value;
    }

    if (is_int($value) || is_float($value)) {
        return ((int) $value) === 1;
    }

    if (is_string($value)) {
        $normalized = strtolower(trim($value));

        if (in_array($normalized, ['1', 'true', 'yes', 'y', 'on', 'sim', 'ativo', 'active'], true)) {
            return true;
        }

        if (in_array($normalized, ['0', 'false', 'no', 'n', 'off', 'nao', 'não', 'inativo', 'inactive'], true)) {
            return false;
        }
    }

    return null;
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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track-core',
        'error' => 'method_not_allowed',
        'message' => 'Use POST with JSON body.',
    ], 405);
}

$auth = authenticateRequest();

if (empty($auth['ok'])) {
    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track-core',
        'error' => 'forbidden',
        'message' => 'Use a valid Authorization Bearer token.',
    ], 403);
}

$payload = readJsonBody();

if (!empty($payload['__invalid_json'])) {
    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track-core',
        'error' => 'invalid_json',
        'message' => $payload['__json_error'] ?? 'Invalid JSON body.',
    ], 400);
}

$propertyId = cleanKey($payload['property_id'] ?? $payload['project_id'] ?? '');
$isActive = parseBooleanValue($payload['is_active'] ?? $payload['active'] ?? null);

if ($propertyId === '') {
    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track-core',
        'error' => 'missing_property_id',
        'message' => 'property_id is required.',
    ], 422);
}

if ($isActive === null) {
    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track-core',
        'error' => 'invalid_is_active',
        'message' => 'is_active must be true or false.',
    ], 422);
}

try {
    $pdo = Database::getConnection();
    $table = Database::table('properties');

    if (!tableExists($pdo, $table)) {
        jsonResponse([
            'ok' => false,
            'system' => 'nvs-track-core',
            'error' => 'properties_table_not_found',
            'message' => 'Properties table was not found.',
        ], 500);
    }

    $project = getProject($pdo, $propertyId);

    if (!$project) {
        jsonResponse([
            'ok' => false,
            'system' => 'nvs-track-core',
            'error' => 'project_not_found',
            'message' => 'Project not found.',
            'property_id' => $propertyId,
        ], 404);
    }

    $stmt = $pdo->prepare('
        UPDATE ' . q($table) . '
        SET is_active = :is_active,
            updated_at = NOW()
        WHERE property_id = :property_id
        LIMIT 1
    ');

    $stmt->execute([
        ':is_active' => $isActive ? 1 : 0,
        ':property_id' => $propertyId,
    ]);

    $updatedProject = getProject($pdo, $propertyId) ?: $project;

    Logger::write('project-status-updated', [
        'property_id' => $propertyId,
        'is_active' => $isActive,
        'auth_mode' => $auth['mode'],
        'remote_ip' => $_SERVER['REMOTE_ADDR'] ?? null,
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
    ]);

    jsonResponse([
        'ok' => true,
        'system' => 'nvs-track-core',
        'status' => $isActive ? 'active' : 'paused',
        'property_id' => $propertyId,
        'is_active' => $isActive,
        'project' => [
            'project_code' => $updatedProject['property_id'] ?? $propertyId,
            'project_name' => $updatedProject['name'] ?? null,
            'authorized_domain' => $updatedProject['domain'] ?? null,
            'cookie_prefix' => $updatedProject['cookie_prefix'] ?? null,
            'active' => (int) ($updatedProject['is_active'] ?? ($isActive ? 1 : 0)) === 1,
            'updated_at' => $updatedProject['updated_at'] ?? null,
        ],
    ]);
} catch (Throwable $e) {
    Logger::write('project-status-error', [
        'property_id' => $propertyId,
        'is_active' => $isActive,
        'error' => $e->getMessage(),
    ]);

    jsonResponse([
        'ok' => false,
        'system' => 'nvs-track-core',
        'error' => 'project_status_failed',
        'message' => $e->getMessage(),
    ], 500);
}
