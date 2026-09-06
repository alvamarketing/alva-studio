<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

try {
    $pdo = Database::getConnection();
    $table = Database::table('browser_events');
    $metaTable = Database::table('meta_deliveries');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        NvsApiSupport::json([
            'ok' => true,
            'system' => 'nvs-track-core',
            'collection' => 'browser_events',
            'table_exists' => false,
            'items' => [],
            'pagination' => NvsApiSupport::pagination(),
            'summary' => ['total' => 0],
        ]);
    }

    $propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);
    $dateFrom = NvsApiSupport::cleanDate($_GET['date_from'] ?? '');
    $dateTo = NvsApiSupport::cleanDate($_GET['date_to'] ?? '');
    $eventName = NvsApiSupport::cleanText($_GET['event_name'] ?? '', 120);
    $nvsUid = NvsApiSupport::cleanText($_GET['nvs_uid'] ?? '', 190);
    $nvsSid = NvsApiSupport::cleanText($_GET['nvs_sid'] ?? '', 190);
    $urlContains = NvsApiSupport::cleanText($_GET['url'] ?? ($_GET['url_contains'] ?? ''), 190);
    $q = NvsApiSupport::cleanText($_GET['q'] ?? '', 190);
    $pagination = NvsApiSupport::pagination();

    $params = [];
    $where = [];
    $paramIndex = 0;
    $addParam = function ($value) use (&$params, &$paramIndex): string {
        $key = ':filter_' . $paramIndex++;
        $params[$key] = $value;
        return $key;
    };

    if ($propertyId !== '') {
        $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, 'b', $propertyId, $params, ['params_json', 'context_json', 'raw_payload_json'], 'property'));
    }

    $where = array_merge($where, NvsApiSupport::dateWhere('b', 'created_at', $dateFrom, $dateTo, $params, 'created'));

    if ($eventName !== '') {
        $parts = [];
        foreach (NvsApiSupport::eventNameVariants($eventName) as $variant) {
            $parts[] = 'b.event_name = ' . $addParam($variant);
            $parts[] = 'b.meta_event_name = ' . $addParam($variant);
        }
        $where[] = '(' . implode(' OR ', $parts) . ')';
    }

    if ($nvsUid !== '') {
        $where[] = 'b.nvs_uid = :nvs_uid';
        $params[':nvs_uid'] = $nvsUid;
    }

    if ($nvsSid !== '') {
        $where[] = 'b.nvs_sid = :nvs_sid';
        $params[':nvs_sid'] = $nvsSid;
    }

    if ($urlContains !== '') {
        $needle = '%' . $urlContains . '%';
        $where[] = '('
            . 'b.page_url LIKE ' . $addParam($needle)
            . ' OR b.url LIKE ' . $addParam($needle)
            . ' OR b.referrer LIKE ' . $addParam($needle)
            . ')';
    }

    if ($q !== '') {
        $needle = '%' . $q . '%';
        $columns = ['event_id', 'nvs_uid', 'nvs_sid', 'page_url', 'url', 'referrer', 'params_json', 'context_json', 'raw_payload_json'];
        $parts = [];
        foreach ($columns as $column) {
            $parts[] = 'b.' . NvsApiSupport::q($column) . ' LIKE ' . $addParam($needle);
        }
        $where[] = '(' . implode(' OR ', $parts) . ')';
    }

    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $stmt = $pdo->prepare('
        SELECT b.*
        FROM ' . NvsApiSupport::q($table) . ' b
        ' . $whereSql . '
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT ' . (int) $pagination['limit'] . ' OFFSET ' . (int) $pagination['offset'] . '
    ');
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $eventIds = array_values(array_filter(array_map(function (array $row) {
        return $row['event_id'] ?? null;
    }, $rows)));

    $metaByEventId = [];
    if ($eventIds && NvsApiSupport::tableExists($pdo, $metaTable)) {
        $metaParams = [];
        $placeholders = [];
        foreach ($eventIds as $i => $eventIdValue) {
            $key = ':event_' . $i;
            $metaParams[$key] = $eventIdValue;
            $placeholders[] = $key;
        }
        $metaStmt = $pdo->prepare('
            SELECT *
            FROM ' . NvsApiSupport::q($metaTable) . '
            WHERE event_id IN (' . implode(', ', $placeholders) . ')
            ORDER BY created_at DESC, id DESC
        ');
        $metaStmt->execute($metaParams);
        foreach ($metaStmt->fetchAll(PDO::FETCH_ASSOC) as $metaRow) {
            $eid = (string) ($metaRow['event_id'] ?? '');
            if ($eid !== '' && !isset($metaByEventId[$eid])) {
                $metaRow['sent'] = (int) ($metaRow['sent'] ?? 0) === 1;
                $metaRow['ok'] = (int) ($metaRow['ok'] ?? 0) === 1;
                $metaByEventId[$eid] = NvsApiSupport::decodeFields($metaRow, ['payload_json', 'response_json']);
            }
        }
    }

    $items = array_map(function (array $row) use ($metaByEventId): array {
        $row = NvsApiSupport::decodeFields($row, ['params_json', 'user_json', 'context_json', 'raw_payload_json']);
        $row['meta_delivery'] = $metaByEventId[$row['event_id'] ?? ''] ?? null;
        return $row;
    }, $rows);

    $summaryStmt = $pdo->prepare('
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN b.event_name = "page_view" OR b.meta_event_name = "PageView" THEN 1 ELSE 0 END) AS page_views,
            SUM(CASE WHEN b.event_name = "initiate_checkout" OR b.meta_event_name = "InitiateCheckout" THEN 1 ELSE 0 END) AS initiate_checkouts,
            SUM(CASE WHEN b.event_name = "lead" OR b.meta_event_name = "Lead" THEN 1 ELSE 0 END) AS leads
        FROM ' . NvsApiSupport::q($table) . ' b
        ' . $whereSql . '
    ');
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'browser_events',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'event_name' => $eventName,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'url_contains' => $urlContains,
            'q' => $q,
        ],
        'summary' => [
            'total' => (int) ($summary['total'] ?? 0),
            'page_views' => (int) ($summary['page_views'] ?? 0),
            'initiate_checkouts' => (int) ($summary['initiate_checkouts'] ?? 0),
            'leads' => (int) ($summary['leads'] ?? 0),
        ],
        'pagination' => $pagination,
        'items' => $items,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'browser_events',
        'error' => 'browser_events_failed',
        'message' => $e->getMessage(),
    ], 500);
}
