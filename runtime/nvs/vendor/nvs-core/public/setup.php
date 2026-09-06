<?php
/**
 * setup.php - NVS Track Core Setup SIMPLIFICADO v0.2.2
 *
 * Esta é a versão correta para o instalador do usuário final.
 *
 * Campos visíveis:
 * - Host do banco
 * - Nome do banco
 * - Usuário do banco
 * - Senha do banco
 * - Nome do projeto
 * - Domínio autorizado
 * - ID do Pixel da Meta
 * - Token da API de Conversões
 *
 * Campos técnicos ficam fixos/ocultos:
 * - URL base detectada automaticamente
 * - Porta MySQL: 3306
 * - Prefixo das tabelas: nvs_
 * - Meta API: v19.0
 * - Código de teste Meta: vazio
 * - Debug: desativado
 * - Browser CAPI: ativo
 */

header('Content-Type: text/html; charset=utf-8');

define('NVS_SETUP_VERSION', '0.3.10');
define('NVS_ROOT_PATH', dirname(__DIR__));
define('NVS_ENV_PATH', NVS_ROOT_PATH . '/.env');
define('NVS_INSTALLED_MARKER', NVS_ROOT_PATH . '/.nvs_installed');

define('NVS_DB_PORT', '3306');
define('NVS_DB_PREFIX', 'nvs_');
define('NVS_META_API_VERSION', 'v19.0');
define('NVS_BROWSER_CAPI_ENABLED', true);
define('NVS_BROWSER_CAPI_EVENTS', 'page_view,view_content,initiate_checkout,lead');
define('NVS_DEBUG_MODE', false);

function h($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function q(string $identifier): string {
    return '`' . str_replace('`', '``', $identifier) . '`';
}

function post($key, $default = '') {
    return $_POST[$key] ?? $default;
}

function clean_key($value, string $fallback = ''): string {
    $value = trim((string) $value);

    if (function_exists('iconv')) {
        $converted = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if ($converted !== false) {
            $value = $converted;
        }
    }

    $value = strtolower($value);
    $value = preg_replace('/[^a-z0-9_]/', '_', $value);
    $value = preg_replace('/_+/', '_', $value);
    $value = trim($value, '_');

    return $value !== '' ? $value : $fallback;
}

function clean_domain($value): string {
    $value = trim((string) $value);
    $value = preg_replace('#^https?://#i', '', $value);
    $value = preg_replace('#/.*$#', '', $value);
    $value = trim($value, "/ \t\n\r\0\x0B");

    return strtolower($value);
}

function current_base_url(): string {
    $https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443)
        || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');

    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = $_SERVER['SCRIPT_NAME'] ?? '/setup.php';
    $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');

    return rtrim($scheme . '://' . $host . $dir, '/');
}

function random_token(string $prefix, int $bytes = 24): string {
    try {
        return $prefix . bin2hex(random_bytes($bytes));
    } catch (Throwable $e) {
        return $prefix . sha1(uniqid('', true) . microtime(true));
    }
}

function env_quote($value): string {
    $value = (string) $value;
    $value = str_replace(["\\", "\n", "\r", '"'], ["\\\\", "\\n", "\\r", '\\"'], $value);

    return '"' . $value . '"';
}

function ensure_directories(): void {
    $dirs = [
        NVS_ROOT_PATH . '/storage',
        NVS_ROOT_PATH . '/storage/logs',
    ];

    foreach ($dirs as $dir) {
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
    }
}

function write_env_file(array $config): bool {
    $lines = [
        'APP_ENV=production',
        'APP_DEBUG=false',
        'APP_URL=' . env_quote($config['app_url']),
        '',
        'DB_HOST=' . env_quote($config['db_host']),
        'DB_PORT=' . env_quote($config['db_port']),
        'DB_DATABASE=' . env_quote($config['db_name']),
        'DB_USERNAME=' . env_quote($config['db_user']),
        'DB_PASSWORD=' . env_quote($config['db_pass']),
        'DB_CHARSET=utf8mb4',
        'DB_PREFIX=' . env_quote($config['db_prefix']),
        '',
        'DASHBOARD_KEY=' . env_quote($config['dashboard_key']),
        'NVS_VIEWER_API_TOKEN=' . env_quote($config['viewer_token']),
        'NVS_WEBHOOK_SECRET=' . env_quote($config['webhook_secret']),
        '',
        'NVS_INSTALLATION_ID=' . env_quote($config['installation_id']),
        'NVS_VIEWER_URL=' . env_quote($config['viewer_url']),
        '',
        'NVS_DEFAULT_PROPERTY_ID=' . env_quote($config['property_id']),
        'NVS_VERSION=' . env_quote(NVS_SETUP_VERSION),
    ];

    return file_put_contents(NVS_ENV_PATH, implode("\n", $lines) . "\n") !== false;
}

function connect_pdo(array $config): PDO {
    $dsn = "mysql:host={$config['db_host']};port={$config['db_port']};dbname={$config['db_name']};charset=utf8mb4";

    return new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function create_tables(PDO $pdo, string $prefix): void {
    $properties = $prefix . 'properties';
    $webhooks = $prefix . 'webhooks';
    $events = $prefix . 'events';
    $meta = $prefix . 'meta_deliveries';
    $identities = $prefix . 'identities';
    $sessions = $prefix . 'sessions';
    $browser = $prefix . 'browser_events';
    $ignored = $prefix . 'ignored_events';
    $settings = $prefix . 'settings';
    $integrations = $prefix . 'integrations';

    $sql = [];

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($properties) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NOT NULL,
            name VARCHAR(190) NOT NULL,
            domain VARCHAR(190) NULL,
            cookie_prefix VARCHAR(100) NOT NULL,
            meta_pixel_id VARCHAR(190) NULL,
            meta_access_token TEXT NULL,
            meta_test_event_code VARCHAR(190) NULL,
            meta_api_version VARCHAR(30) NULL DEFAULT 'v19.0',
            debug_mode TINYINT(1) NOT NULL DEFAULT 0,
            browser_capi_enabled TINYINT(1) NOT NULL DEFAULT 0,
            browser_capi_events TEXT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_property_id (property_id),
            KEY idx_domain (domain),
            KEY idx_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($webhooks) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NULL,
            platform VARCHAR(80) NULL,
            action VARCHAR(120) NULL,
            auth_status VARCHAR(80) NULL,
            method VARCHAR(20) NULL,
            remote_ip VARCHAR(80) NULL,
            delivery_id VARCHAR(190) NULL,
            source_event VARCHAR(190) NULL,
            payload_json LONGTEXT NULL,
            headers_json LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_property_id (property_id),
            KEY idx_platform (platform),
            KEY idx_action (action),
            KEY idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($events) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NULL,
            event_id VARCHAR(190) NOT NULL,
            event_name VARCHAR(120) NULL,
            meta_event_name VARCHAR(120) NULL,
            source VARCHAR(80) NULL,
            source_platform VARCHAR(80) NULL,
            event_time BIGINT NULL,
            nvs_uid VARCHAR(190) NULL,
            nvs_sid VARCHAR(190) NULL,
            transaction_id VARCHAR(190) NULL,
            value DECIMAL(12,2) NULL,
            currency VARCHAR(20) NULL,
            status VARCHAR(80) NULL,
            event_json LONGTEXT NULL,
            raw_payload_json LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_event_id (event_id),
            KEY idx_property_id (property_id),
            KEY idx_event_name (event_name),
            KEY idx_meta_event_name (meta_event_name),
            KEY idx_nvs_uid (nvs_uid),
            KEY idx_nvs_sid (nvs_sid),
            KEY idx_transaction_id (transaction_id),
            KEY idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($meta) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NULL,
            destination VARCHAR(40) NOT NULL DEFAULT 'meta',
            event_id VARCHAR(190) NULL,
            event_name VARCHAR(120) NULL,
            meta_event_name VARCHAR(120) NULL,
            mode VARCHAR(80) NULL,
            sent TINYINT(1) NOT NULL DEFAULT 0,
            ok TINYINT(1) NOT NULL DEFAULT 0,
            http_code INT NULL,
            curl_error TEXT NULL,
            payload_json LONGTEXT NULL,
            response_json LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_property_id (property_id),
            KEY idx_event_id (event_id),
            KEY idx_destination_event (destination, event_id),
            KEY idx_ok_sent (ok, sent),
            KEY idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($identities) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NOT NULL DEFAULT 'default',
            nvs_uid VARCHAR(190) NOT NULL,
            email VARCHAR(190) NULL,
            phone VARCHAR(80) NULL,
            first_name VARCHAR(190) NULL,
            last_name VARCHAR(190) NULL,
            full_name VARCHAR(255) NULL,
            country VARCHAR(20) NULL,
            locale VARCHAR(40) NULL,
            fbp VARCHAR(255) NULL,
            fbc VARCHAR(255) NULL,
            fbclid VARCHAR(255) NULL,
            gclid VARCHAR(255) NULL,
            ttclid VARCHAR(255) NULL,
            supreme_stuid VARCHAR(190) NULL,
            first_landing_url LONGTEXT NULL,
            last_landing_url LONGTEXT NULL,
            first_referrer LONGTEXT NULL,
            last_referrer LONGTEXT NULL,
            first_utm_json LONGTEXT NULL,
            last_utm_json LONGTEXT NULL,
            provider_ids_json LONGTEXT NULL,
            first_seen_at DATETIME NULL,
            last_seen_at DATETIME NULL,
            last_ip VARCHAR(80) NULL,
            last_user_agent LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_property_uid (property_id, nvs_uid),
            KEY idx_property_id (property_id),
            KEY idx_nvs_uid (nvs_uid),
            KEY idx_email (email),
            KEY idx_phone (phone),
            KEY idx_last_seen_at (last_seen_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($sessions) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NOT NULL DEFAULT 'default',
            nvs_sid VARCHAR(190) NOT NULL,
            nvs_uid VARCHAR(190) NULL,
            landing_url LONGTEXT NULL,
            last_page_url LONGTEXT NULL,
            last_url LONGTEXT NULL,
            first_url LONGTEXT NULL,
            referrer LONGTEXT NULL,
            utm_json LONGTEXT NULL,
            provider_ids_json LONGTEXT NULL,
            utm_source VARCHAR(190) NULL,
            utm_medium VARCHAR(190) NULL,
            utm_campaign VARCHAR(190) NULL,
            utm_content VARCHAR(190) NULL,
            utm_term VARCHAR(190) NULL,
            fbclid VARCHAR(255) NULL,
            fbp VARCHAR(255) NULL,
            fbc VARCHAR(255) NULL,
            started_at DATETIME NULL,
            last_seen_at DATETIME NULL,
            pageview_count INT NOT NULL DEFAULT 0,
            event_count INT NOT NULL DEFAULT 0,
            ip_address VARCHAR(80) NULL,
            user_agent LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_property_sid (property_id, nvs_sid),
            KEY idx_property_id (property_id),
            KEY idx_nvs_uid (nvs_uid),
            KEY idx_nvs_sid (nvs_sid),
            KEY idx_last_seen_at (last_seen_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($browser) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NOT NULL DEFAULT 'default',
            event_id VARCHAR(190) NOT NULL,
            event_name VARCHAR(120) NULL,
            meta_event_name VARCHAR(120) NULL,
            nvs_uid VARCHAR(190) NULL,
            nvs_sid VARCHAR(190) NULL,
            page_url LONGTEXT NULL,
            url LONGTEXT NULL,
            referrer LONGTEXT NULL,
            event_time BIGINT NULL,
            source VARCHAR(80) NULL,
            source_platform VARCHAR(80) NULL,
            params_json LONGTEXT NULL,
            user_json LONGTEXT NULL,
            context_json LONGTEXT NULL,
            raw_payload_json LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_event_id (event_id),
            KEY idx_property_id (property_id),
            KEY idx_event_name (event_name),
            KEY idx_meta_event_name (meta_event_name),
            KEY idx_nvs_uid (nvs_uid),
            KEY idx_nvs_sid (nvs_sid),
            KEY idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($ignored) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            property_id VARCHAR(100) NOT NULL,
            event_name VARCHAR(120) NULL,
            reason VARCHAR(80) NOT NULL,
            bot_name VARCHAR(120) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_property_id (property_id),
            KEY idx_reason (reason),
            KEY idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($settings) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            setting_key VARCHAR(190) NOT NULL,
            setting_value LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_setting_key (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    $sql[] = "
        CREATE TABLE IF NOT EXISTS " . q($integrations) . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            integration_key VARCHAR(190) NULL,
            name VARCHAR(190) NULL,
            type VARCHAR(80) NULL,
            config_json LONGTEXT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_integration_key (integration_key),
            KEY idx_type (type),
            KEY idx_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ";

    foreach ($sql as $statement) {
        $pdo->exec($statement);
    }
}

function upsert_setting(PDO $pdo, string $table, string $key, string $value): void {
    $stmt = $pdo->prepare("
        INSERT INTO " . q($table) . " (setting_key, setting_value)
        VALUES (:setting_key, :setting_value)
        ON DUPLICATE KEY UPDATE
            setting_value = VALUES(setting_value),
            updated_at = CURRENT_TIMESTAMP
    ");

    $stmt->execute([
        ':setting_key' => $key,
        ':setting_value' => $value,
    ]);
}

function create_first_project(PDO $pdo, string $prefix, array $config): void {
    $table = $prefix . 'properties';

    $stmt = $pdo->prepare("
        INSERT INTO " . q($table) . " (
            property_id,
            name,
            domain,
            cookie_prefix,
            meta_pixel_id,
            meta_access_token,
            meta_test_event_code,
            meta_api_version,
            debug_mode,
            browser_capi_enabled,
            browser_capi_events,
            is_active,
            notes,
            created_at,
            updated_at
        ) VALUES (
            :property_id,
            :name,
            :domain,
            :cookie_prefix,
            :meta_pixel_id,
            :meta_access_token,
            :meta_test_event_code,
            :meta_api_version,
            :debug_mode,
            :browser_capi_enabled,
            :browser_capi_events,
            :is_active,
            :notes,
            :created_at,
            :updated_at
        )
        ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            domain = VALUES(domain),
            cookie_prefix = VALUES(cookie_prefix),
            meta_pixel_id = VALUES(meta_pixel_id),
            meta_access_token = VALUES(meta_access_token),
            meta_test_event_code = VALUES(meta_test_event_code),
            meta_api_version = VALUES(meta_api_version),
            debug_mode = VALUES(debug_mode),
            browser_capi_enabled = VALUES(browser_capi_enabled),
            browser_capi_events = VALUES(browser_capi_events),
            is_active = VALUES(is_active),
            notes = VALUES(notes),
            updated_at = VALUES(updated_at)
    ");

    $now = date('Y-m-d H:i:s');

    $stmt->execute([
        ':property_id' => $config['property_id'],
        ':name' => $config['project_name'],
        ':domain' => $config['project_domain'],
        ':cookie_prefix' => $config['cookie_prefix'],
        ':meta_pixel_id' => $config['meta_pixel_id'] ?: null,
        ':meta_access_token' => $config['meta_access_token'] ?: null,
        ':meta_test_event_code' => null,
        ':meta_api_version' => NVS_META_API_VERSION,
        ':debug_mode' => NVS_DEBUG_MODE ? 1 : 0,
        ':browser_capi_enabled' => NVS_BROWSER_CAPI_ENABLED ? 1 : 0,
        ':browser_capi_events' => NVS_BROWSER_CAPI_EVENTS,
        ':is_active' => 1,
        ':notes' => 'Projeto criado pelo setup inicial do NVS Track Core.',
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);

    $settingsTable = $prefix . 'settings';

    upsert_setting($pdo, $settingsTable, 'meta_pixel_id', $config['meta_pixel_id']);
    upsert_setting($pdo, $settingsTable, 'meta_access_token', $config['meta_access_token']);
    upsert_setting($pdo, $settingsTable, 'meta_test_event_code', '');
    upsert_setting($pdo, $settingsTable, 'meta_api_version', NVS_META_API_VERSION);
}

function notify_viewer(array $config, array $result): array {
    $callbackUrl = trim((string) ($config['viewer_callback_url'] ?? ''));
    $installToken = trim((string) ($config['viewer_install_token'] ?? ''));

    if ($callbackUrl === '') {
        return [
            'attempted' => false,
            'ok' => null,
            'message' => 'Sem callback do Viewer.',
        ];
    }

    if (!extension_loaded('curl')) {
        return [
            'attempted' => true,
            'ok' => false,
            'message' => 'cURL indisponível para notificar o Viewer.',
        ];
    }

    if (!preg_match('#^https://#i', $callbackUrl)) {
        return [
            'attempted' => true,
            'ok' => false,
            'message' => 'Callback do Viewer precisa usar HTTPS.',
        ];
    }

    $payload = [
        'system' => 'nvs-track-core',
        'event' => 'installation_completed',
        'version' => NVS_SETUP_VERSION,
        'installation_id' => $config['installation_id'],
        'project_id' => $config['property_id'],
        'project_name' => $config['project_name'],
        'base_url' => $config['app_url'],
        'viewer_token' => $result['viewer_token'],
        'endpoints' => [
            'dashboard_data' => $result['api_dashboard_data'],
            'viewer_health' => $result['api_viewer_health'],
            'ingest' => $result['ingest_url'],
            'webhook' => $result['webhook_url'],
        ],
        'installed_at' => date('c'),
    ];

    $headers = [
        'Content-Type: application/json',
        'User-Agent: NVSCoreSetup/' . NVS_SETUP_VERSION,
    ];

    if ($installToken !== '') {
        $headers[] = 'Authorization: Bearer ' . $installToken;
    }

    $ch = curl_init($callbackUrl);

    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    $body = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

    curl_close($ch);

    $ok = $body !== false && $httpCode >= 200 && $httpCode < 300;

    return [
        'attempted' => true,
        'ok' => $ok,
        'http_code' => $httpCode,
        'message' => $ok ? 'Viewer notificado com sucesso.' : 'Não foi possível notificar o Viewer automaticamente.',
        'error' => $error ?: null,
    ];
}

function is_installed(): bool {
    return file_exists(NVS_ENV_PATH) || file_exists(NVS_INSTALLED_MARKER);
}

function field_value(array $defaults, string $key): string {
    return h($defaults[$key] ?? '');
}

$installed = is_installed();
$errors = [];
$success = false;
$result = null;
$viewerNotification = null;

$projectNameFromViewer = trim((string) ($_GET['project_name'] ?? ''));
$projectDomainFromViewer = trim((string) ($_GET['domain'] ?? ''));
$projectIdFromViewer = clean_key($_GET['project_id'] ?? '', '');
$viewerUrlFromViewer = trim((string) ($_GET['viewer_url'] ?? ''));
$viewerCallbackFromViewer = trim((string) ($_GET['callback_url'] ?? ''));
$viewerInstallTokenFromViewer = trim((string) ($_GET['install_token'] ?? ''));
$installationIdFromViewer = trim((string) ($_GET['installation_id'] ?? ''));

$defaults = [
    'db_host' => 'localhost',
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',
    'project_name' => $projectNameFromViewer !== '' ? $projectNameFromViewer : 'Meu Projeto',
    'property_id' => $projectIdFromViewer,
    'project_domain' => clean_domain($projectDomainFromViewer !== '' ? $projectDomainFromViewer : ($_SERVER['HTTP_HOST'] ?? '')),
    'meta_pixel_id' => trim((string) ($_GET['meta_pixel_id'] ?? '')),
    'meta_access_token' => '',
    'viewer_url' => $viewerUrlFromViewer,
    'viewer_callback_url' => $viewerCallbackFromViewer,
    'viewer_install_token' => $viewerInstallTokenFromViewer,
    'installation_id' => $installationIdFromViewer !== '' ? $installationIdFromViewer : random_token('nvs_install_', 10),
];

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$installed) {
    $projectName = trim((string) post('project_name', 'Meu Projeto'));
    $projectId = clean_key(post('property_id'), '');

    if ($projectId === '') {
        $projectId = clean_key($projectName, 'meu_projeto');
    }

    $cookiePrefix = 'nvs_' . $projectId;

    $config = [
        'app_url' => current_base_url(),
        'db_host' => trim((string) post('db_host')),
        'db_port' => NVS_DB_PORT,
        'db_name' => trim((string) post('db_name')),
        'db_user' => trim((string) post('db_user')),
        'db_pass' => (string) post('db_pass'),
        'db_prefix' => NVS_DB_PREFIX,
        'dashboard_key' => random_token('nvs_dash_', 24),
        'viewer_token' => random_token('nvs_viewer_', 32),
        'webhook_secret' => random_token('nvs_webhook_', 24),
        'installation_id' => trim((string) post('installation_id', random_token('nvs_install_', 10))),
        'viewer_url' => trim((string) post('viewer_url', '')),
        'viewer_callback_url' => trim((string) post('viewer_callback_url', '')),
        'viewer_install_token' => trim((string) post('viewer_install_token', '')),
        'property_id' => $projectId,
        'project_name' => $projectName,
        'project_domain' => clean_domain(post('project_domain')),
        'cookie_prefix' => $cookiePrefix,
        'meta_pixel_id' => trim((string) post('meta_pixel_id')),
        'meta_access_token' => trim((string) post('meta_access_token')),
    ];

    if ($config['db_host'] === '') {
        $errors[] = 'Informe o host do banco.';
    }

    if ($config['db_name'] === '') {
        $errors[] = 'Informe o nome do banco.';
    }

    if ($config['db_user'] === '') {
        $errors[] = 'Informe o usuário do banco.';
    }

    if ($config['project_name'] === '') {
        $errors[] = 'Informe o nome do projeto.';
    }

    if ($config['project_domain'] === '') {
        $errors[] = 'Informe o domínio autorizado.';
    }

    if (!is_writable(NVS_ROOT_PATH)) {
        $errors[] = 'A pasta da instalação não possui permissão de escrita.';
    }

    if (!extension_loaded('pdo_mysql')) {
        $errors[] = 'A extensão pdo_mysql não está ativa neste servidor.';
    }

    if (empty($errors)) {
        try {
            ensure_directories();

            $pdo = connect_pdo($config);
            create_tables($pdo, $config['db_prefix']);
            create_first_project($pdo, $config['db_prefix'], $config);

            if (!write_env_file($config)) {
                throw new RuntimeException('Não foi possível criar o arquivo de configuração.');
            }

            $result = [
                'dashboard_key' => $config['dashboard_key'],
                'viewer_token' => $config['viewer_token'],
                'webhook_secret' => $config['webhook_secret'],
                'project_id' => $config['property_id'],
                'project_name' => $config['project_name'],
                'app_url' => $config['app_url'],
                'api_dashboard_data' => rtrim($config['app_url'], '/') . '/api/dashboard-data.php',
                'api_viewer_health' => rtrim($config['app_url'], '/') . '/api/viewer-health.php',
                'ingest_url' => rtrim($config['app_url'], '/') . '/ingest.php',
                'webhook_url' => rtrim($config['app_url'], '/') . '/webhook/dispatch.php',
            ];

            $viewerNotification = notify_viewer($config, $result);

            file_put_contents(NVS_INSTALLED_MARKER, json_encode([
                'installed_at' => date('c'),
                'version' => NVS_SETUP_VERSION,
                'installation_id' => $config['installation_id'],
                'project_id' => $config['property_id'],
                'viewer_notification' => $viewerNotification,
            ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));

            $success = true;

        } catch (Throwable $e) {
            $errors[] = $e->getMessage();
        }
    }

    foreach ($config as $key => $value) {
        if (array_key_exists($key, $defaults) && !is_bool($value)) {
            $defaults[$key] = $value;
        }
    }
}

?>
<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <title>NVS Track Core - Instalação</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- NVS_SETUP_SIMPLIFICADO_v0.2.2 -->

    <style>
        :root{
            --bg:#0b1020;
            --card:#111827;
            --card2:#0f172a;
            --line:#1f2937;
            --line2:#334155;
            --text:#e5e7eb;
            --muted:#94a3b8;
            --blue:#93c5fd;
            --green:#22c55e;
            --red:#ef4444;
            --yellow:#facc15;
        }

        *{box-sizing:border-box}

        body{
            margin:0;
            padding:24px;
            background:var(--bg);
            color:var(--text);
            font-family:Arial,Helvetica,sans-serif;
        }

        .wrap{max-width:880px;margin:0 auto}

        h1{margin:0 0 8px;font-size:30px}
        h2{margin:22px 0 12px;font-size:20px}
        p{color:var(--muted);line-height:1.5;margin:0 0 16px}

        .card{
            background:var(--card);
            border:1px solid var(--line);
            border-radius:16px;
            padding:18px;
            margin-bottom:18px;
        }

        .grid{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:14px;
        }

        label{
            display:block;
            color:#cbd5e1;
            font-size:13px;
            font-weight:700;
            margin:0 0 6px;
        }

        input{
            width:100%;
            background:#020617;
            border:1px solid var(--line2);
            color:var(--text);
            border-radius:10px;
            padding:11px;
            outline:none;
        }

        .help{
            color:var(--muted);
            font-size:12px;
            margin-top:5px;
        }

        .btn{
            display:inline-block;
            border:1px solid #2563eb;
            background:#1d4ed8;
            color:#eff6ff;
            border-radius:12px;
            padding:12px 16px;
            font-weight:700;
            cursor:pointer;
            text-decoration:none;
        }

        .alert{
            border-radius:14px;
            padding:16px;
            margin-bottom:18px;
        }

        .error{
            background:#450a0a;
            border:1px solid #7f1d1d;
            color:#fecaca;
        }

        .success{
            background:#052e16;
            border:1px solid #166534;
            color:#bbf7d0;
        }

        .warn{
            background:#451a03;
            border:1px solid #92400e;
            color:#fed7aa;
        }

        .okline{
            background:var(--card2);
            border:1px solid var(--line);
            border-radius:12px;
            padding:12px;
            margin-top:10px;
        }

        @media(max-width:760px){
            body{padding:14px}
            .grid{grid-template-columns:1fr}
        }
    </style>
</head>
<body>
<div class="wrap">

    <h1>Instalação do NVS Track</h1>
    <p>Preencha os dados abaixo para concluir a instalação no seu servidor.</p>

    <?php if ($installed && !$success): ?>
        <div class="alert warn">
            <strong>Esta instalação já foi configurada.</strong><br>
            Por segurança, esta tela foi bloqueada para evitar sobrescrever dados existentes.
        </div>
    <?php endif; ?>

    <?php if (!empty($errors)): ?>
        <div class="alert error">
            <strong>Não foi possível concluir:</strong>
            <ul>
                <?php foreach ($errors as $error): ?>
                    <li><?= h($error) ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <?php if ($success): ?>
        <div class="alert success">
            <strong>Instalação concluída com sucesso.</strong><br>
            O NVS Track Core foi configurado neste servidor.
        </div>

        <div class="card">
            <h2>Próximo passo</h2>
            <p>Volte para o NVS Track Viewer e clique em <strong>Validar instalação</strong>.</p>

            <?php if (is_array($viewerNotification) && !empty($viewerNotification['attempted'])): ?>
                <div class="okline">
                    Conexão com o Viewer:
                    <strong><?= !empty($viewerNotification['ok']) ? 'confirmada' : 'aguardando validação manual' ?></strong>
                </div>
            <?php else: ?>
                <div class="okline">
                    Instalação local finalizada. A validação será feita pelo painel.
                </div>
            <?php endif; ?>
        </div>

        <div class="card">
            <h2>Segurança</h2>
            <p>Após validar no painel, remova ou bloqueie este arquivo de instalação.</p>
        </div>

    <?php elseif (!$installed): ?>

        <form method="post">
            <input type="hidden" name="installation_id" value="<?= field_value($defaults, 'installation_id') ?>">
            <input type="hidden" name="viewer_url" value="<?= field_value($defaults, 'viewer_url') ?>">
            <input type="hidden" name="viewer_callback_url" value="<?= field_value($defaults, 'viewer_callback_url') ?>">
            <input type="hidden" name="viewer_install_token" value="<?= field_value($defaults, 'viewer_install_token') ?>">
            <input type="hidden" name="property_id" value="<?= field_value($defaults, 'property_id') ?>">

            <div class="card">
                <h2>1. Banco de dados MySQL</h2>

                <div class="grid">
                    <div>
                        <label>Host do banco</label>
                        <input type="text" name="db_host" value="<?= field_value($defaults, 'db_host') ?>" placeholder="localhost">
                    </div>

                    <div>
                        <label>Nome do banco</label>
                        <input type="text" name="db_name" value="<?= field_value($defaults, 'db_name') ?>" placeholder="nome completo do banco">
                    </div>

                    <div>
                        <label>Usuário do banco</label>
                        <input type="text" name="db_user" value="<?= field_value($defaults, 'db_user') ?>" placeholder="usuário completo do banco">
                    </div>

                    <div>
                        <label>Senha do banco</label>
                        <input type="password" name="db_pass" value="<?= field_value($defaults, 'db_pass') ?>" placeholder="senha do banco">
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>2. Projeto</h2>

                <div class="grid">
                    <div>
                        <label>Nome do projeto</label>
                        <input type="text" name="project_name" value="<?= field_value($defaults, 'project_name') ?>" placeholder="Ex: Minha Loja">
                    </div>

                    <div>
                        <label>Domínio autorizado</label>
                        <input type="text" name="project_domain" value="<?= field_value($defaults, 'project_domain') ?>" placeholder="seudominio.com.br">
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>3. Meta API de Conversões</h2>

                <div class="grid">
                    <div>
                        <label>ID do Pixel da Meta <span style="color:#94a3b8;font-weight:400">(opcional)</span></label>
                        <input type="text" name="meta_pixel_id" value="<?= field_value($defaults, 'meta_pixel_id') ?>" placeholder="Ex: 1234567890">
                    </div>

                    <div>
                        <label>Token da API de Conversões <span style="color:#94a3b8;font-weight:400">(opcional)</span></label>
                        <input type="password" name="meta_access_token" value="<?= field_value($defaults, 'meta_access_token') ?>" placeholder="Cole o token da API de Conversões">
                    </div>
                </div>

                <div class="help">Você pode deixar em branco e configurar a Meta depois pelo NVS Track Viewer.</div>
            </div>

            <button class="btn" type="submit">Concluir instalação</button>
        </form>

    <?php endif; ?>

</div>
</body>
</html>
