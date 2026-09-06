<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

try {
    $pdo = Database::getConnection();
    $table = Database::table('sessions');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        NvsApiSupport::json([
            'ok' => true,
            'system' => 'nvs-track-core',
            'collection' => 'sessions',
            'table_exists' => false,
            'items' => [],
            'pagination' => NvsApiSupport::pagination(),
            'summary' => ['total' => 0],
        ]);
    }

    $propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);
    $dateFrom = NvsApiSupport::cleanDate($_GET['date_from'] ?? '');
    $dateTo = NvsApiSupport::cleanDate($_GET['date_to'] ?? '');
    $nvsUid = NvsApiSupport::cleanText($_GET['nvs_uid'] ?? '', 190);
    $nvsSid = NvsApiSupport::cleanText($_GET['nvs_sid'] ?? '', 190);
    $utmSource = NvsApiSupport::cleanText($_GET['utm_source'] ?? '', 190);
    $utmCampaign = NvsApiSupport::cleanText($_GET['utm_campaign'] ?? '', 190);
    $q = NvsApiSupport::cleanText($_GET['q'] ?? '', 190);
    $pagination = NvsApiSupport::pagination();

    $params = [];
    $where = [];

    if ($propertyId !== '') {
        $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, 's', $propertyId, $params, ['utm_json', 'provider_ids_json'], 'property'));
    }

    $dateColumn = NvsApiSupport::columnExists($pdo, $table, 'last_seen_at') ? 'last_seen_at' : 'created_at';
    $where = array_merge($where, NvsApiSupport::dateWhere('s', $dateColumn, $dateFrom, $dateTo, $params, 'date'));

    if ($nvsUid !== '') {
        $where[] = 's.nvs_uid = :nvs_uid';
        $params[':nvs_uid'] = $nvsUid;
    }

    if ($nvsSid !== '') {
        $where[] = 's.nvs_sid = :nvs_sid';
        $params[':nvs_sid'] = $nvsSid;
    }

    if ($utmSource !== '') {
        $where[] = '(s.utm_source = :utm_source OR s.utm_json LIKE :utm_source_like)';
        $params[':utm_source'] = $utmSource;
        $params[':utm_source_like'] = '%' . $utmSource . '%';
    }

    if ($utmCampaign !== '') {
        $where[] = '(s.utm_campaign = :utm_campaign OR s.utm_json LIKE :utm_campaign_like)';
        $params[':utm_campaign'] = $utmCampaign;
        $params[':utm_campaign_like'] = '%' . $utmCampaign . '%';
    }

    if ($q !== '') {
        $where[] = '(
            s.nvs_sid LIKE :q
            OR s.nvs_uid LIKE :q
            OR s.landing_url LIKE :q
            OR s.last_page_url LIKE :q
            OR s.referrer LIKE :q
            OR s.utm_json LIKE :q
        )';
        $params[':q'] = '%' . $q . '%';
    }

    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $orderColumn = NvsApiSupport::orderColumn($pdo, $table, ['last_seen_at', 'updated_at', 'created_at', 'id']);

    $stmt = $pdo->prepare('
        SELECT s.*
        FROM ' . NvsApiSupport::q($table) . ' s
        ' . $whereSql . '
        ORDER BY s.' . NvsApiSupport::q($orderColumn) . ' DESC, s.id DESC
        LIMIT ' . (int) $pagination['limit'] . ' OFFSET ' . (int) $pagination['offset'] . '
    ');
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $items = array_map(function (array $row): array {
        return NvsApiSupport::decodeFields($row, ['utm_json', 'provider_ids_json']);
    }, $rows);

    $summaryStmt = $pdo->prepare('
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(pageview_count), 0) AS pageviews,
            COALESCE(SUM(event_count), 0) AS events
        FROM ' . NvsApiSupport::q($table) . ' s
        ' . $whereSql . '
    ');
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'sessions',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'utm_source' => $utmSource,
            'utm_campaign' => $utmCampaign,
            'q' => $q,
        ],
        'summary' => [
            'total' => (int) ($summary['total'] ?? 0),
            'pageviews' => (int) ($summary['pageviews'] ?? 0),
            'events' => (int) ($summary['events'] ?? 0),
        ],
        'pagination' => $pagination,
        'items' => $items,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'sessions',
        'error' => 'sessions_failed',
        'message' => $e->getMessage(),
    ], 500);
}
