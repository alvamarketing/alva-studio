<?php

require_once __DIR__ . '/../../src/NvsApiSupport.php';
require_once __DIR__ . '/../../src/Logger.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

function nvsDashboardWhere(
    PDO $pdo,
    string $table,
    string $alias,
    string $propertyId,
    string $dateFrom,
    string $dateTo,
    array &$params,
    string $prefix
): array {
    $where = [];
    $variants = NvsApiSupport::propertyVariants($propertyId);

    if ($variants && NvsApiSupport::columnExists($pdo, $table, 'property_id')) {
        $placeholders = [];

        foreach ($variants as $index => $variant) {
            $key = ':' . $prefix . '_property_' . $index;
            $params[$key] = $variant;
            $placeholders[] = $key;
        }

        $where[] = $alias . '.`property_id` IN (' . implode(', ', $placeholders) . ')';
    }

    if (NvsApiSupport::columnExists($pdo, $table, 'created_at')) {
        $where = array_merge(
            $where,
            NvsApiSupport::dateWhere($alias, 'created_at', $dateFrom, $dateTo, $params, $prefix . '_created')
        );
    }

    return $where;
}

function nvsDashboardWhereSql(array $where): string
{
    return $where ? 'WHERE ' . implode(' AND ', $where) : '';
}

function nvsDashboardRows(
    PDO $pdo,
    string $table,
    string $propertyId,
    string $dateFrom,
    string $dateTo,
    string $prefix,
    int $limit = 100
): array {
    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return [];
    }

    $params = [];
    $where = nvsDashboardWhere($pdo, $table, 'r', $propertyId, $dateFrom, $dateTo, $params, $prefix);
    $order = NvsApiSupport::orderColumn($pdo, $table);
    $stmt = $pdo->prepare(
        'SELECT r.* FROM ' . NvsApiSupport::q($table) . ' r '
        . nvsDashboardWhereSql($where)
        . ' ORDER BY r.' . NvsApiSupport::q($order) . ' DESC LIMIT ' . (int) $limit
    );
    $stmt->execute($params);

    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function nvsDashboardCount(
    PDO $pdo,
    string $table,
    string $propertyId,
    string $dateFrom,
    string $dateTo,
    string $prefix
): int {
    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return 0;
    }

    $params = [];
    $where = nvsDashboardWhere($pdo, $table, 'r', $propertyId, $dateFrom, $dateTo, $params, $prefix);
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM ' . NvsApiSupport::q($table) . ' r ' . nvsDashboardWhereSql($where)
    );
    $stmt->execute($params);

    return (int) $stmt->fetchColumn();
}

function nvsBrowserStats(PDO $pdo, string $table, string $propertyId, string $dateFrom, string $dateTo): array
{
    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return ['total' => 0, 'unique_visitors' => 0, 'page_views' => 0, 'initiate_checkouts' => 0];
    }

    $params = [];
    $where = nvsDashboardWhere($pdo, $table, 'b', $propertyId, $dateFrom, $dateTo, $params, 'browser');
    $pageView = "(LOWER(REPLACE(COALESCE(b.event_name, ''), '_', '')) = 'pageview' OR b.meta_event_name = 'PageView')";
    $checkout = "(LOWER(REPLACE(COALESCE(b.event_name, ''), '_', '')) = 'initiatecheckout' OR b.meta_event_name = 'InitiateCheckout')";
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) AS total,'
        . ' COUNT(DISTINCT CASE WHEN ' . $pageView . " AND b.nvs_uid IS NOT NULL AND b.nvs_uid <> '' THEN b.nvs_uid END) AS unique_visitors,"
        . ' SUM(CASE WHEN ' . $pageView . ' THEN 1 ELSE 0 END) AS page_views,'
        . ' SUM(CASE WHEN ' . $checkout . ' THEN 1 ELSE 0 END) AS initiate_checkouts'
        . ' FROM ' . NvsApiSupport::q($table) . ' b ' . nvsDashboardWhereSql($where)
    );
    $stmt->execute($params);
    $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

    return [
        'total' => (int) ($row['total'] ?? 0),
        'unique_visitors' => (int) ($row['unique_visitors'] ?? 0),
        'page_views' => (int) ($row['page_views'] ?? 0),
        'initiate_checkouts' => (int) ($row['initiate_checkouts'] ?? 0),
    ];
}

function nvsPurchaseStats(PDO $pdo, string $table, string $propertyId, string $dateFrom, string $dateTo): array
{
    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return ['total' => 0, 'purchases' => 0, 'revenue' => 0.0];
    }

    $params = [];
    $where = nvsDashboardWhere($pdo, $table, 'e', $propertyId, $dateFrom, $dateTo, $params, 'events');
    $purchase = "(LOWER(REPLACE(COALESCE(e.event_name, ''), '_', '')) = 'purchase' OR e.meta_event_name = 'Purchase')";
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) AS total,'
        . ' SUM(CASE WHEN ' . $purchase . ' THEN 1 ELSE 0 END) AS purchases,'
        . ' COALESCE(SUM(CASE WHEN ' . $purchase . ' THEN e.value ELSE 0 END), 0) AS revenue'
        . ' FROM ' . NvsApiSupport::q($table) . ' e ' . nvsDashboardWhereSql($where)
    );
    $stmt->execute($params);
    $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

    return [
        'total' => (int) ($row['total'] ?? 0),
        'purchases' => (int) ($row['purchases'] ?? 0),
        'revenue' => (float) ($row['revenue'] ?? 0),
    ];
}

function nvsMetaStats(PDO $pdo, string $table, string $propertyId, string $dateFrom, string $dateTo): array
{
    $empty = [
        'total' => 0,
        'sent' => 0,
        'ok' => 0,
        'errors' => 0,
        'page_views_total' => 0,
        'page_views_sent' => 0,
        'page_views_ok' => 0,
        'page_views_errors' => 0,
        'page_views_with_fbp' => 0,
        'page_views_with_fbc' => 0,
    ];

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return $empty;
    }

    $params = [];
    $where = nvsDashboardWhere($pdo, $table, 'm', $propertyId, $dateFrom, $dateTo, $params, 'meta');
    $pageView = "(m.event_name = 'PageView' OR m.meta_event_name = 'PageView' OR LOWER(REPLACE(COALESCE(m.event_name, ''), '_', '')) = 'pageview')";
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) AS total,'
        . ' SUM(CASE WHEN m.sent = 1 THEN 1 ELSE 0 END) AS sent_count,'
        . ' SUM(CASE WHEN m.ok = 1 THEN 1 ELSE 0 END) AS ok_count,'
        . ' SUM(CASE WHEN m.ok = 0 THEN 1 ELSE 0 END) AS error_count,'
        . ' SUM(CASE WHEN ' . $pageView . ' THEN 1 ELSE 0 END) AS page_views_total,'
        . ' SUM(CASE WHEN ' . $pageView . ' AND m.sent = 1 THEN 1 ELSE 0 END) AS page_views_sent,'
        . ' SUM(CASE WHEN ' . $pageView . ' AND m.ok = 1 THEN 1 ELSE 0 END) AS page_views_ok,'
        . ' SUM(CASE WHEN ' . $pageView . ' AND m.ok = 0 THEN 1 ELSE 0 END) AS page_views_errors,'
        . ' SUM(CASE WHEN ' . $pageView . " AND m.payload_json LIKE '%\"fbp\"%' THEN 1 ELSE 0 END) AS page_views_with_fbp,"
        . ' SUM(CASE WHEN ' . $pageView . " AND m.payload_json LIKE '%\"fbc\"%' THEN 1 ELSE 0 END) AS page_views_with_fbc"
        . ' FROM ' . NvsApiSupport::q($table) . ' m ' . nvsDashboardWhereSql($where)
    );
    $stmt->execute($params);
    $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

    return [
        'total' => (int) ($row['total'] ?? 0),
        'sent' => (int) ($row['sent_count'] ?? 0),
        'ok' => (int) ($row['ok_count'] ?? 0),
        'errors' => (int) ($row['error_count'] ?? 0),
        'page_views_total' => (int) ($row['page_views_total'] ?? 0),
        'page_views_sent' => (int) ($row['page_views_sent'] ?? 0),
        'page_views_ok' => (int) ($row['page_views_ok'] ?? 0),
        'page_views_errors' => (int) ($row['page_views_errors'] ?? 0),
        'page_views_with_fbp' => (int) ($row['page_views_with_fbp'] ?? 0),
        'page_views_with_fbc' => (int) ($row['page_views_with_fbc'] ?? 0),
    ];
}

function nvsIgnoredBotCount(PDO $pdo, string $propertyId, string $dateFrom, string $dateTo): int
{
    $table = Database::table('ignored_events');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return 0;
    }

    $params = [];
    $where = nvsDashboardWhere($pdo, $table, 'i', $propertyId, $dateFrom, $dateTo, $params, 'ignored');
    $where[] = "i.reason = 'known_bot'";
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM ' . NvsApiSupport::q($table) . ' i ' . nvsDashboardWhereSql($where)
    );
    $stmt->execute($params);

    return (int) $stmt->fetchColumn();
}

function nvsDashboardProperties(PDO $pdo): array
{
    $table = Database::table('properties');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return [];
    }

    $stmt = $pdo->query(
        'SELECT id, property_id, name, domain, cookie_prefix, meta_pixel_id, meta_test_event_code,'
        . ' meta_api_version, debug_mode, browser_capi_enabled, browser_capi_events, is_active, notes, created_at, updated_at'
        . ' FROM ' . NvsApiSupport::q($table) . ' ORDER BY id ASC'
    );

    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

$propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);
$dateFrom = NvsApiSupport::cleanDate($_GET['date_from'] ?? '');
$dateTo = NvsApiSupport::cleanDate($_GET['date_to'] ?? '');
$limit = NvsApiSupport::positiveInt($_GET['limit'] ?? 100, 100, 1, 500);

try {
    $pdo = Database::getConnection();
    $eventsTable = Database::table('events');
    $browserTable = Database::table('browser_events');
    $sessionsTable = Database::table('sessions');
    $identitiesTable = Database::table('identities');
    $metaTable = Database::table('meta_deliveries');

    $browserStats = nvsBrowserStats($pdo, $browserTable, $propertyId, $dateFrom, $dateTo);
    $purchaseStats = nvsPurchaseStats($pdo, $eventsTable, $propertyId, $dateFrom, $dateTo);
    $metaStats = nvsMetaStats($pdo, $metaTable, $propertyId, $dateFrom, $dateTo);
    $events = nvsDashboardRows($pdo, $eventsTable, $propertyId, $dateFrom, $dateTo, 'events_rows', $limit);
    $browserEvents = nvsDashboardRows($pdo, $browserTable, $propertyId, $dateFrom, $dateTo, 'browser_rows', $limit);
    $sessions = nvsDashboardRows($pdo, $sessionsTable, $propertyId, $dateFrom, $dateTo, 'session_rows', $limit);
    $identities = nvsDashboardRows($pdo, $identitiesTable, $propertyId, $dateFrom, $dateTo, 'identity_rows', $limit);
    $summary = [
        'unique_visitors' => $browserStats['unique_visitors'],
        'page_views' => $browserStats['page_views'],
        'initiate_checkouts' => $browserStats['initiate_checkouts'],
        'purchases' => $purchaseStats['purchases'],
        'revenue' => $purchaseStats['revenue'],
        'ignored_bots' => nvsIgnoredBotCount($pdo, $propertyId, $dateFrom, $dateTo),
        'events_total' => $purchaseStats['total'],
        'browser_events_total' => $browserStats['total'],
        'sessions_total' => nvsDashboardCount($pdo, $sessionsTable, $propertyId, $dateFrom, $dateTo, 'sessions_count'),
        'identities_total' => $browserStats['unique_visitors'],
        'purchases_total' => $purchaseStats['purchases'],
        'revenue_total' => $purchaseStats['revenue'],
        'meta' => $metaStats,
    ];

    NvsApiSupport::json([
        'ok' => true,
        'collection' => 'dashboard',
        'auth' => ['mode' => $auth['mode'], 'role' => $auth['role']],
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'timezone' => NvsApiSupport::VIEWER_TIMEZONE,
        ],
        'summary' => $summary,
        'pagination' => ['page' => 1, 'limit' => $limit],
        'items' => [],
        'properties' => nvsDashboardProperties($pdo),
        'latest' => [
            'events' => $events,
            'browser_events' => $browserEvents,
            'sessions' => $sessions,
            'identities' => $identities,
        ],
        'events' => $events,
        'browser_events' => $browserEvents,
        'sessions' => $sessions,
        'identities' => $identities,
    ]);
} catch (Throwable $e) {
    Logger::write('dashboard-data-error', [
        'error' => $e->getMessage(),
        'property_id' => $propertyId,
    ]);

    NvsApiSupport::json([
        'ok' => false,
        'collection' => 'dashboard',
        'error' => 'dashboard_data_failed',
        'message' => 'Nao foi possivel carregar os dados do dashboard.',
    ], 500);
}
