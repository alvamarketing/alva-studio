<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

function nvsInstallationBaseUrl(): string
{
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $script = $_SERVER['SCRIPT_NAME'] ?? '';

    $basePath = preg_replace('#/public/api/viewer-health\.php$#', '', $script);
    $basePath = preg_replace('#/api/viewer-health\.php$#', '', $basePath);

    return rtrim($scheme . '://' . $host . $basePath, '/');
}

function nvsCountRows(PDO $pdo, string $table): int
{
    try {
        if (!NvsApiSupport::tableExists($pdo, $table)) {
            return 0;
        }

        $stmt = $pdo->query('SELECT COUNT(*) FROM ' . NvsApiSupport::q($table));
        return (int) $stmt->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}

function nvsGetProjects(PDO $pdo): array
{
    $table = Database::table('properties');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return [];
    }

    $stmt = $pdo->query('
        SELECT
            property_id,
            name,
            domain,
            cookie_prefix,
            meta_pixel_id,
            meta_test_event_code,
            meta_api_version,
            debug_mode,
            browser_capi_enabled,
            browser_capi_events,
            is_active,
            created_at,
            updated_at
        FROM ' . NvsApiSupport::q($table) . '
        ORDER BY id ASC
    ');

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    return array_map(function (array $row): array {
        $active = (int) ($row['is_active'] ?? 0) === 1;
        $hasMetaPixel = trim((string) ($row['meta_pixel_id'] ?? '')) !== '';

        return [
            'project_code' => $row['property_id'] ?? '',
            'remote_property_id' => $row['property_id'] ?? '',
            'property_id' => $row['property_id'] ?? '',
            'project_name' => $row['name'] ?? '',
            'name' => $row['name'] ?? '',
            'authorized_domain' => $row['domain'] ?? '',
            'domain' => $row['domain'] ?? '',
            'cookie_prefix' => $row['cookie_prefix'] ?? '',
            'meta_pixel_id' => $row['meta_pixel_id'] ?? '',
            'has_meta_pixel_id' => $hasMetaPixel,
            'has_test_event_code' => trim((string) ($row['meta_test_event_code'] ?? '')) !== '',
            'meta_api_version' => $row['meta_api_version'] ?? '',
            'debug_mode' => (int) ($row['debug_mode'] ?? 0) === 1,
            'browser_server_events_enabled' => (int) ($row['browser_capi_enabled'] ?? 0) === 1,
            'browser_server_events' => $row['browser_capi_events'] ?? '',
            'active' => $active,
            'is_active' => $active,
            'status' => $active ? 'active' : 'paused',
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }, $rows);
}

try {
    $pdo = Database::getConnection();
    $baseUrl = nvsInstallationBaseUrl();

    $tables = [
        'properties' => Database::table('properties'),
        'events' => Database::table('events'),
        'browser_events' => Database::table('browser_events'),
        'sessions' => Database::table('sessions'),
        'identities' => Database::table('identities'),
        'webhooks' => Database::table('webhooks'),
        'meta_deliveries' => Database::table('meta_deliveries'),
        'ignored_events' => Database::table('ignored_events'),
        'settings' => Database::table('settings'),
        'integrations' => Database::table('integrations'),
    ];

    $tableStatus = [];
    foreach ($tables as $key => $table) {
        $tableStatus[$key] = [
            'table' => $table,
            'exists' => NvsApiSupport::tableExists($pdo, $table),
            'rows' => nvsCountRows($pdo, $table),
        ];
    }

    $propertiesTable = Database::table('properties');
    $projectStatusEndpointExists = is_file(__DIR__ . '/project-status.php');
    $propertiesTableSupportsActive = NvsApiSupport::columnExists($pdo, $propertiesTable, 'is_active');
    $projectStatusCapability = $projectStatusEndpointExists && $propertiesTableSupportsActive;

    $endpointFiles = [
        'dashboard_data' => 'dashboard-data.php',
        'viewer_health' => 'viewer-health.php',
        'project_status' => 'project-status.php',
        'events' => 'events.php',
        'browser_events' => 'browser-events.php',
        'sessions' => 'sessions.php',
        'identities' => 'identities.php',
        'webhooks' => 'webhooks.php',
        'meta_deliveries' => 'meta-deliveries.php',
        'purchases' => 'purchases.php',
        'journey' => 'journey.php',
        'server_metrics' => 'server-metrics.php',
    ];

    $endpointStatus = [];
    foreach ($endpointFiles as $key => $file) {
        $endpointStatus[$key] = [
            'available' => is_file(__DIR__ . '/' . $file),
            'url' => $baseUrl . '/api/' . $file,
        ];
    }

    $projects = nvsGetProjects($pdo);

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'version' => NvsApiSupport::CORE_VERSION,
        'auth' => [
            'mode' => $auth['mode'],
            'role' => $auth['role'],
        ],
        'capabilities' => [
            'viewer_health' => true,
            'dashboard_data' => $endpointStatus['dashboard_data']['available'],
            'project_status' => $projectStatusCapability,
            'pause_tracking' => $projectStatusCapability,
            'reactivate_tracking' => $projectStatusCapability,
            'inactive_project_blocking' => true,
            'events' => $endpointStatus['events']['available'] && $tableStatus['events']['exists'],
            'browser_events' => $endpointStatus['browser_events']['available'] && $tableStatus['browser_events']['exists'],
            'sessions' => $endpointStatus['sessions']['available'] && $tableStatus['sessions']['exists'],
            'identities' => $endpointStatus['identities']['available'] && $tableStatus['identities']['exists'],
            'webhooks' => $endpointStatus['webhooks']['available'] && $tableStatus['webhooks']['exists'],
            'meta_deliveries' => $endpointStatus['meta_deliveries']['available'] && $tableStatus['meta_deliveries']['exists'],
            'purchases' => $endpointStatus['purchases']['available'] && $tableStatus['events']['exists'],
            'journey' => $endpointStatus['journey']['available'],
            'official_collections' => true,
            'manual_core_update' => true,
            'server_metrics' => $endpointStatus['server_metrics']['available'],
            'contract_v1' => true,
            'exact_dashboard_summary' => true,
            'known_bot_filtering' => true,
        ],
        'installation' => [
            'base_url' => $baseUrl,
            'api_dashboard_data' => $baseUrl . '/api/dashboard-data.php',
            'api_viewer_health' => $baseUrl . '/api/viewer-health.php',
            'api_project_status' => $baseUrl . '/api/project-status.php',
            'api_events' => $baseUrl . '/api/events.php',
            'api_browser_events' => $baseUrl . '/api/browser-events.php',
            'api_sessions' => $baseUrl . '/api/sessions.php',
            'api_identities' => $baseUrl . '/api/identities.php',
            'api_webhooks' => $baseUrl . '/api/webhooks.php',
            'api_meta_deliveries' => $baseUrl . '/api/meta-deliveries.php',
            'api_purchases' => $baseUrl . '/api/purchases.php',
            'api_journey' => $baseUrl . '/api/journey.php',
            'api_server_metrics' => $baseUrl . '/api/server-metrics.php',
            'ingest_url' => $baseUrl . '/ingest.php',
            'webhook_url' => $baseUrl . '/webhook/dispatch.php',
        ],
        'endpoints' => $endpointStatus,
        'environment' => [
            'php_version' => PHP_VERSION,
            'server_software' => $_SERVER['SERVER_SOFTWARE'] ?? null,
            'https' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
            'viewer_token_configured' => Env::get('NVS_VIEWER_API_TOKEN') ? true : false,
            'dashboard_key_configured' => Env::get('DASHBOARD_KEY') ? true : false,
            'default_property_id' => Env::get('NVS_DEFAULT_PROPERTY_ID'),
        ],
        'database' => [
            'connected' => true,
            'tables' => $tableStatus,
        ],
        'projects' => [
            'total' => count($projects),
            'active' => count(array_filter($projects, function ($project) {
                return !empty($project['active']);
            })),
            'paused' => count(array_filter($projects, function ($project) {
                return empty($project['active']);
            })),
            'items' => $projects,
        ],
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'version' => NvsApiSupport::CORE_VERSION,
        'error' => 'viewer_health_failed',
        'message' => $e->getMessage(),
        'capabilities' => [
            'viewer_health' => true,
            'project_status' => false,
            'pause_tracking' => false,
            'reactivate_tracking' => false,
            'official_collections' => false,
            'server_metrics' => false,
        ],
        'database' => [
            'connected' => false,
        ],
    ], 500);
}
