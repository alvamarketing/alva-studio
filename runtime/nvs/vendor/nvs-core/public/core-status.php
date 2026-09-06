<?php
header('Content-Type: text/html; charset=utf-8');

require_once __DIR__ . '/../src/Env.php';
require_once __DIR__ . '/../src/Database.php';

Env::load(__DIR__ . '/../.env');

$key = $_GET['key'] ?? '';
$dashboardKey = Env::get('DASHBOARD_KEY');

if (!$dashboardKey || !hash_equals($dashboardKey, $key)) {
    http_response_code(403);
    echo 'Acesso negado';
    exit;
}

function h($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function q(string $identifier): string {
    return '`' . str_replace('`', '``', $identifier) . '`';
}

function boolText($value): string {
    return $value ? 'Sim' : 'Não';
}

function boolClass($value): string {
    return $value ? 'ok' : 'bad';
}

function baseUrl(): string {
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $script = $_SERVER['SCRIPT_NAME'] ?? '';

    $basePath = preg_replace('#/public/core-status\.php$#', '', $script);
    $basePath = preg_replace('#/core-status\.php$#', '', $basePath);

    return rtrim($scheme . '://' . $host . $basePath, '/');
}

function tableExists(PDO $pdo, string $table): bool {
    try {
        $stmt = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table));
        return (bool) ($stmt ? $stmt->fetchColumn() : false);
    } catch (Throwable $e) {
        return false;
    }
}

function countRows(PDO $pdo, string $table): int {
    try {
        if (!tableExists($pdo, $table)) {
            return 0;
        }

        $stmt = $pdo->query("SELECT COUNT(*) FROM " . q($table));
        return (int) $stmt->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}

function loadProjects(PDO $pdo): array {
    $table = Database::table('properties');

    if (!tableExists($pdo, $table)) {
        return [];
    }

    try {
        $stmt = $pdo->query("
            SELECT
                property_id,
                name,
                domain,
                cookie_prefix,
                meta_pixel_id,
                meta_test_event_code,
                debug_mode,
                browser_capi_enabled,
                is_active,
                updated_at
            FROM " . q($table) . "
            ORDER BY id ASC
        ");

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return [];
    }
}

$baseUrl = baseUrl();

$health = [
    'database_connected' => false,
    'database_error' => null,
    'tables' => [],
    'projects' => [],
];

try {
    $pdo = Database::getConnection();
    $health['database_connected'] = true;

    $tables = [
        'Projetos' => Database::table('properties'),
        'Eventos recebidos' => Database::table('events'),
        'Eventos do navegador' => Database::table('browser_events'),
        'Sessões' => Database::table('sessions'),
        'Visitantes identificados' => Database::table('identities'),
        'Webhooks' => Database::table('webhooks'),
        'Envios para Meta' => Database::table('meta_deliveries'),
        'Configurações' => Database::table('settings'),
        'Integrações' => Database::table('integrations'),
    ];

    foreach ($tables as $label => $table) {
        $exists = tableExists($pdo, $table);

        $health['tables'][] = [
            'label' => $label,
            'table' => $table,
            'exists' => $exists,
            'rows' => $exists ? countRows($pdo, $table) : 0,
        ];
    }

    $health['projects'] = loadProjects($pdo);

} catch (Throwable $e) {
    $health['database_error'] = $e->getMessage();
}

$viewerTokenConfigured = Env::get('NVS_VIEWER_API_TOKEN') ? true : false;
$dashboardKeyConfigured = Env::get('DASHBOARD_KEY') ? true : false;
$webhookSecretConfigured = Env::get('NVS_WEBHOOK_SECRET') ? true : false;

$dashboardDataUrl = $baseUrl . '/api/dashboard-data.php';
$viewerHealthUrl = $baseUrl . '/api/viewer-health.php';
$ingestUrl = $baseUrl . '/ingest.php';
$webhookUrl = $baseUrl . '/webhook/dispatch.php';

$activeProjects = array_filter($health['projects'], function ($project) {
    return (int) ($project['is_active'] ?? 0) === 1;
});
?>
<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <title>NVS Track Core - Status</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <style>
        :root {
            --bg: #0b1020;
            --card: #111827;
            --card2: #0f172a;
            --line: #1f2937;
            --line2: #334155;
            --text: #e5e7eb;
            --muted: #94a3b8;
            --blue: #93c5fd;
            --green: #22c55e;
            --red: #ef4444;
            --yellow: #facc15;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 24px;
            background: var(--bg);
            color: var(--text);
            font-family: Arial, Helvetica, sans-serif;
        }

        .wrap {
            max-width: 1400px;
            margin: 0 auto;
        }

        .top {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: flex-start;
            margin-bottom: 20px;
        }

        h1 {
            margin: 0 0 8px;
            font-size: 30px;
        }

        h2 {
            margin: 24px 0 12px;
            font-size: 20px;
        }

        p {
            margin: 0;
            color: var(--muted);
            line-height: 1.5;
        }

        a {
            color: var(--blue);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: flex-end;
        }

        .btn {
            display: inline-block;
            color: var(--blue);
            background: var(--card2);
            border: 1px solid var(--line2);
            border-radius: 10px;
            padding: 9px 12px;
            font-size: 13px;
            text-decoration: none;
        }

        .btn:hover {
            background: #1e293b;
            text-decoration: none;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 14px;
            margin-bottom: 18px;
        }

        .card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 16px;
        }

        .card small {
            display: block;
            color: var(--muted);
            margin-bottom: 8px;
            font-size: 12px;
        }

        .card strong {
            display: block;
            font-size: 24px;
            word-break: break-word;
        }

        .ok {
            color: var(--green);
            font-weight: 700;
        }

        .bad {
            color: var(--red);
            font-weight: 700;
        }

        .warn {
            color: var(--yellow);
            font-weight: 700;
        }

        .muted {
            color: var(--muted);
        }

        .box {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 16px;
            margin-bottom: 18px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 16px;
            overflow: hidden;
        }

        th,
        td {
            padding: 12px;
            border-bottom: 1px solid var(--line);
            text-align: left;
            vertical-align: top;
            font-size: 13px;
        }

        th {
            background: #020617;
            color: #cbd5e1;
            font-weight: 700;
        }

        tr:hover td {
            background: #182235;
        }

        code {
            color: var(--blue);
            word-break: break-all;
            font-size: 12px;
        }

        .pill {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 999px;
            background: #172554;
            border: 1px solid #1d4ed8;
            color: #bfdbfe;
            font-size: 12px;
            white-space: nowrap;
        }

        .notice {
            background: #451a03;
            border: 1px solid #92400e;
            color: #fed7aa;
            border-radius: 14px;
            padding: 14px;
            margin-bottom: 18px;
        }

        @media (max-width: 1000px) {
            body {
                padding: 14px;
            }

            .top {
                display: block;
            }

            .actions {
                justify-content: flex-start;
                margin-top: 14px;
            }

            .grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            table {
                display: block;
                overflow: auto;
                white-space: nowrap;
            }
        }

        @media (max-width: 640px) {
            .grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>

<body>
<div class="wrap">

    <div class="top">
        <div>
            <h1>NVS Track Core</h1>
            <p>Status técnico da instalação local. Esta tela não é o painel de relatórios; ela serve apenas para suporte e validação da instalação.</p>
        </div>

        <div class="actions">
            <a class="btn" href="/nvs-track/dashboard.php?key=<?= h($key) ?>">Painel local</a>
            <a class="btn" href="/nvs-track/install.php?key=<?= h($key) ?>">Instalação</a>
            <a class="btn" href="/nvs-track/properties.php?key=<?= h($key) ?>">Projetos</a>
            <a class="btn" href="/nvs-track/api/viewer-health.php?key=<?= h($key) ?>">API Health</a>
        </div>
    </div>

    <div class="grid">
        <div class="card">
            <small>Instalação</small>
            <strong class="ok">Ativa</strong>
        </div>

        <div class="card">
            <small>Banco de dados</small>
            <strong class="<?= h(boolClass($health['database_connected'])) ?>">
                <?= h($health['database_connected'] ? 'Conectado' : 'Erro') ?>
            </strong>
        </div>

        <div class="card">
            <small>Token do Viewer</small>
            <strong class="<?= h(boolClass($viewerTokenConfigured)) ?>">
                <?= h(boolText($viewerTokenConfigured)) ?>
            </strong>
        </div>

        <div class="card">
            <small>Projetos ativos</small>
            <strong><?= h(count($activeProjects)) ?> / <?= h(count($health['projects'])) ?></strong>
        </div>
    </div>

    <?php if (!$health['database_connected']): ?>
        <div class="notice">
            <strong>Erro no banco:</strong>
            <?= h($health['database_error']) ?>
        </div>
    <?php endif; ?>

    <h2>URLs da instalação</h2>

    <div class="box">
        <p><strong>Base da instalação</strong></p>
        <code><?= h($baseUrl) ?></code>
        <br><br>

        <p><strong>API para o Viewer/SaaS</strong></p>
        <code><?= h($dashboardDataUrl) ?></code>
        <br><br>

        <p><strong>API de status</strong></p>
        <code><?= h($viewerHealthUrl) ?></code>
        <br><br>

        <p><strong>Endpoint de eventos do navegador</strong></p>
        <code><?= h($ingestUrl) ?></code>
        <br><br>

        <p><strong>Webhook de checkout</strong></p>
        <code><?= h($webhookUrl) ?></code>
    </div>

    <h2>Ambiente</h2>

    <div class="grid">
        <div class="card">
            <small>PHP</small>
            <strong><?= h(PHP_VERSION) ?></strong>
        </div>

        <div class="card">
            <small>HTTPS</small>
            <strong class="<?= h(boolClass(!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')) ?>">
                <?= h(boolText(!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')) ?>
            </strong>
        </div>

        <div class="card">
            <small>Dashboard Key</small>
            <strong class="<?= h(boolClass($dashboardKeyConfigured)) ?>">
                <?= h(boolText($dashboardKeyConfigured)) ?>
            </strong>
        </div>

        <div class="card">
            <small>Webhook Secret</small>
            <strong class="<?= h($webhookSecretConfigured ? 'ok' : 'warn') ?>">
                <?= h(boolText($webhookSecretConfigured)) ?>
            </strong>
        </div>
    </div>

    <h2>Tabelas do sistema</h2>

    <table>
        <thead>
        <tr>
            <th>Área</th>
            <th>Tabela</th>
            <th>Status</th>
            <th>Registros</th>
        </tr>
        </thead>
        <tbody>
        <?php foreach ($health['tables'] as $table): ?>
            <tr>
                <td><?= h($table['label']) ?></td>
                <td><code><?= h($table['table']) ?></code></td>
                <td class="<?= h(boolClass($table['exists'])) ?>">
                    <?= h($table['exists'] ? 'Existe' : 'Não encontrada') ?>
                </td>
                <td><?= h($table['rows']) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>

    <h2>Projetos configurados</h2>

    <table>
        <thead>
        <tr>
            <th>Projeto</th>
            <th>Código</th>
            <th>Domínio autorizado</th>
            <th>Eventos do navegador via servidor</th>
            <th>Código de teste Meta</th>
            <th>Status</th>
            <th>Atualização</th>
        </tr>
        </thead>
        <tbody>
        <?php if (empty($health['projects'])): ?>
            <tr>
                <td colspan="7" class="muted">Nenhum projeto configurado.</td>
            </tr>
        <?php endif; ?>

        <?php foreach ($health['projects'] as $project): ?>
            <?php
            $active = (int) ($project['is_active'] ?? 0) === 1;
            $browserCapi = (int) ($project['browser_capi_enabled'] ?? 0) === 1;
            $hasTestCode = trim((string) ($project['meta_test_event_code'] ?? '')) !== '';
            ?>
            <tr>
                <td><?= h($project['name'] ?? '-') ?></td>
                <td><span class="pill"><?= h($project['property_id'] ?? '-') ?></span></td>
                <td><code><?= h($project['domain'] ?? '-') ?></code></td>
                <td class="<?= h(boolClass($browserCapi)) ?>"><?= h(boolText($browserCapi)) ?></td>
                <td class="<?= h($hasTestCode ? 'warn' : 'ok') ?>">
                    <?= h($hasTestCode ? 'Preenchido' : 'Vazio') ?>
                </td>
                <td class="<?= h(boolClass($active)) ?>"><?= h($active ? 'Ativo' : 'Inativo') ?></td>
                <td><?= h($project['updated_at'] ?? '-') ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>

</div>
</body>
</html>
