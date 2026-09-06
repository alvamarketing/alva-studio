<?php
require_once __DIR__ . '/../../src/Env.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Logger.php';
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    NvsApiSupport::json(['ok' => false, 'system' => 'nvs-track-core', 'error' => 'method_not_allowed', 'message' => 'Use POST with JSON body.'], 405);
}

$auth = NvsApiSupport::requireAuth();
$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    NvsApiSupport::json(['ok' => false, 'system' => 'nvs-track-core', 'error' => 'invalid_json', 'message' => json_last_error_msg()], 400);
}

function nvsCleanPropertyId($value): string {
    $value = strtolower(trim((string) $value));
    $value = preg_replace('/[^a-z0-9_]/', '_', $value);
    $value = preg_replace('/_+/', '_', $value);
    return trim($value, '_');
}

function nvsCleanText($value, int $max = 190): string {
    $value = trim((string) $value);
    if ($value === '') { return ''; }
    return function_exists('mb_substr') ? mb_substr($value, 0, $max, 'UTF-8') : substr($value, 0, $max);
}

function nvsCleanDomain($value): string {
    $value = nvsCleanText($value, 190);
    $value = preg_replace('#^https?://#i', '', $value);
    $value = preg_replace('#/.*$#', '', $value);
    return strtolower(trim((string) $value));
}

function nvsColumn(PDO $pdo, string $table, string $column): bool {
    try {
        $stmt = $pdo->query('SHOW COLUMNS FROM ' . NvsApiSupport::q($table) . ' LIKE ' . $pdo->quote($column));
        return (bool) ($stmt ? $stmt->fetchColumn() : false);
    } catch (Throwable $e) { return false; }
}

function nvsSetIfColumn(PDO $pdo, string $table, array &$columns, array &$placeholders, array &$params, string $column, $value): void {
    if (!nvsColumn($pdo, $table, $column)) { return; }
    $columns[] = NvsApiSupport::q($column);
    if ($value === '__NOW__') { $placeholders[] = 'NOW()'; return; }
    $param = ':' . $column;
    $placeholders[] = $param;
    $params[$param] = $value;
}

$propertyId = nvsCleanPropertyId($payload['property_id'] ?? $payload['project_id'] ?? '');
$projectName = nvsCleanText($payload['project_name'] ?? $payload['name'] ?? $propertyId, 190) ?: $propertyId;
$domain = nvsCleanDomain($payload['authorized_domain'] ?? $payload['domain'] ?? '');
$cookiePrefix = nvsCleanPropertyId($payload['cookie_prefix'] ?? ('nvs_' . $propertyId));
$pixelId = nvsCleanText($payload['meta_pixel_id'] ?? $payload['pixel_id'] ?? '', 190);
$accessToken = trim((string) ($payload['meta_access_token'] ?? $payload['access_token'] ?? ''));
$testEventCode = nvsCleanText($payload['meta_test_event_code'] ?? $payload['test_event_code'] ?? '', 190);
$apiVersion = nvsCleanText($payload['meta_api_version'] ?? $payload['api_version'] ?? 'v19.0', 30) ?: 'v19.0';
$isActive = array_key_exists('is_active', $payload) ? (filter_var($payload['is_active'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0) : 1;
$browserCapiEnabled = array_key_exists('browser_capi_enabled', $payload)
    ? (filter_var($payload['browser_capi_enabled'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0)
    : (($pixelId !== '' && $accessToken !== '') ? 1 : null);
$browserCapiEvents = nvsCleanText(
    $payload['browser_capi_events'] ?? 'page_view,view_content,initiate_checkout,lead',
    255
);

if ($propertyId === '') {
    NvsApiSupport::json(['ok' => false, 'system' => 'nvs-track-core', 'error' => 'missing_property_id', 'message' => 'property_id is required.'], 422);
}

try {
    $pdo = Database::getConnection();
    $table = Database::table('properties');
    if (!NvsApiSupport::tableExists($pdo, $table)) {
        NvsApiSupport::json(['ok' => false, 'system' => 'nvs-track-core', 'error' => 'properties_table_not_found', 'message' => 'Properties table was not found.'], 500);
    }
    foreach (['property_id', 'name', 'cookie_prefix'] as $required) {
        if (!nvsColumn($pdo, $table, $required)) {
            NvsApiSupport::json(['ok' => false, 'system' => 'nvs-track-core', 'error' => 'properties_column_missing', 'message' => 'Required properties column is missing: ' . $required, 'property_id' => $propertyId], 500);
        }
    }

    $stmt = $pdo->prepare('SELECT * FROM ' . NvsApiSupport::q($table) . ' WHERE property_id = :property_id LIMIT 1');
    $stmt->execute([':property_id' => $propertyId]);
    $project = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($project) {
        $updates = [];
        $params = [':property_id' => $propertyId];
        $always = ['name' => $projectName, 'domain' => $domain, 'cookie_prefix' => $cookiePrefix];
        foreach ($always as $column => $value) {
            if ($value !== '' && nvsColumn($pdo, $table, $column)) { $updates[] = NvsApiSupport::q($column) . ' = :' . $column; $params[':' . $column] = $value; }
        }
        $optional = [
            'meta_pixel_id' => $pixelId,
            'meta_access_token' => $accessToken,
            'meta_test_event_code' => $testEventCode,
            'meta_api_version' => $apiVersion,
            'browser_capi_events' => $browserCapiEvents,
        ];
        foreach ($optional as $column => $value) {
            if ($value !== '' && nvsColumn($pdo, $table, $column)) { $updates[] = NvsApiSupport::q($column) . ' = :' . $column; $params[':' . $column] = $value; }
        }
        if ($browserCapiEnabled !== null && nvsColumn($pdo, $table, 'browser_capi_enabled')) {
            $updates[] = 'browser_capi_enabled = :browser_capi_enabled';
            $params[':browser_capi_enabled'] = $browserCapiEnabled;
        }
        if (array_key_exists('is_active', $payload) && nvsColumn($pdo, $table, 'is_active')) { $updates[] = 'is_active = :is_active'; $params[':is_active'] = $isActive; }
        if (nvsColumn($pdo, $table, 'updated_at')) { $updates[] = 'updated_at = NOW()'; }
        if ($updates) { $pdo->prepare('UPDATE ' . NvsApiSupport::q($table) . ' SET ' . implode(', ', $updates) . ' WHERE property_id = :property_id LIMIT 1')->execute($params); }
        $status = 'updated';
    } else {
        $columns = []; $placeholders = []; $params = [];
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'property_id', $propertyId);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'name', $projectName);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'domain', $domain ?: null);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'cookie_prefix', $cookiePrefix ?: ('nvs_' . $propertyId));
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'meta_pixel_id', $pixelId ?: null);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'meta_access_token', $accessToken ?: null);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'meta_test_event_code', $testEventCode ?: null);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'meta_api_version', $apiVersion);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'browser_capi_enabled', $browserCapiEnabled ?? 0);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'browser_capi_events', $browserCapiEvents);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'is_active', $isActive);
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'created_at', '__NOW__');
        nvsSetIfColumn($pdo, $table, $columns, $placeholders, $params, 'updated_at', '__NOW__');
        $pdo->prepare('INSERT INTO ' . NvsApiSupport::q($table) . ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')')->execute($params);
        $status = 'created';
    }

    Logger::write('project-config-' . $status, ['property_id' => $propertyId, 'project_name' => $projectName, 'authorized_domain' => $domain, 'meta_pixel_id' => $pixelId, 'has_meta_access_token' => $accessToken !== '', 'browser_capi_enabled' => $browserCapiEnabled === 1, 'is_active' => $isActive === 1, 'auth_mode' => $auth['mode'] ?? null, 'remote_ip' => $_SERVER['REMOTE_ADDR'] ?? null]);

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'status' => $status,
        'property_id' => $propertyId,
        'project' => ['property_id' => $propertyId, 'project_code' => $propertyId, 'remote_property_id' => $propertyId, 'name' => $projectName, 'project_name' => $projectName, 'domain' => $domain, 'authorized_domain' => $domain, 'cookie_prefix' => $cookiePrefix, 'is_active' => $isActive === 1, 'status' => $isActive === 1 ? 'active' : 'paused'],
        'meta' => ['pixel_id' => $pixelId, 'access_token_configured' => $accessToken !== '', 'test_event_code_configured' => $testEventCode !== '', 'api_version' => $apiVersion, 'browser_capi_enabled' => $browserCapiEnabled === 1, 'browser_capi_events' => $browserCapiEvents],
    ]);
} catch (Throwable $e) {
    Logger::write('project-config-error', ['property_id' => $propertyId, 'error' => $e->getMessage()]);
    NvsApiSupport::json(['ok' => false, 'system' => 'nvs-track-core', 'error' => 'project_config_failed', 'message' => $e->getMessage(), 'property_id' => $propertyId], 500);
}
