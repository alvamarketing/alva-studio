<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

try {
    $pdo = Database::getConnection();
    $table = Database::table('events');
    $metaTable = Database::table('meta_deliveries');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        NvsApiSupport::json([
            'ok' => true,
            'system' => 'nvs-track-core',
            'collection' => 'events',
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
    $status = NvsApiSupport::cleanText($_GET['status'] ?? '', 80);
    $source = NvsApiSupport::cleanText($_GET['source'] ?? '', 80);
    $transactionId = NvsApiSupport::cleanText($_GET['transaction_id'] ?? '', 190);
    $nvsUid = NvsApiSupport::cleanText($_GET['nvs_uid'] ?? '', 190);
    $nvsSid = NvsApiSupport::cleanText($_GET['nvs_sid'] ?? '', 190);
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
        $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, 'e', $propertyId, $params, ['event_json', 'raw_payload_json'], 'property'));
    }

    $where = array_merge($where, NvsApiSupport::dateWhere('e', 'created_at', $dateFrom, $dateTo, $params, 'created'));

    if ($eventName !== '') {
        $parts = [];
        foreach (NvsApiSupport::eventNameVariants($eventName) as $variant) {
            $parts[] = 'e.event_name = ' . $addParam($variant);
            $parts[] = 'e.meta_event_name = ' . $addParam($variant);
        }
        $where[] = '(' . implode(' OR ', $parts) . ')';
    }

    if ($status !== '') {
        $where[] = 'e.status = :status';
        $params[':status'] = $status;
    }

    if ($source !== '') {
        $where[] = '('
            . 'e.source = ' . $addParam($source)
            . ' OR e.source_platform = ' . $addParam($source)
            . ')';
    }

    if ($transactionId !== '') {
        $needle = '%' . $transactionId . '%';
        $where[] = '('
            . 'e.transaction_id = ' . $addParam($transactionId)
            . ' OR e.event_json LIKE ' . $addParam($needle)
            . ' OR e.raw_payload_json LIKE ' . $addParam($needle)
            . ')';
    }

    if ($nvsUid !== '') {
        $where[] = 'e.nvs_uid = :nvs_uid';
        $params[':nvs_uid'] = $nvsUid;
    }

    if ($nvsSid !== '') {
        $where[] = 'e.nvs_sid = :nvs_sid';
        $params[':nvs_sid'] = $nvsSid;
    }

    if ($q !== '') {
        $needle = '%' . $q . '%';
        $columns = ['event_id', 'transaction_id', 'nvs_uid', 'nvs_sid', 'event_name', 'meta_event_name', 'event_json', 'raw_payload_json'];
        $parts = [];
        foreach ($columns as $column) {
            $parts[] = 'e.' . NvsApiSupport::q($column) . ' LIKE ' . $addParam($needle);
        }
        $where[] = '(' . implode(' OR ', $parts) . ')';
    }

    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $stmt = $pdo->prepare('
        SELECT e.*
        FROM ' . NvsApiSupport::q($table) . ' e
        ' . $whereSql . '
        ORDER BY e.created_at DESC, e.id DESC
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
        $row = NvsApiSupport::decodeFields($row, ['event_json', 'raw_payload_json']);
        $row['meta_delivery'] = $metaByEventId[$row['event_id'] ?? ''] ?? null;
        return $row;
    }, $rows);

    $summaryStmt = $pdo->prepare('
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN e.event_name = "purchase" OR e.meta_event_name = "Purchase" THEN 1 ELSE 0 END) AS purchases,
            COALESCE(SUM(CASE WHEN e.event_name = "purchase" OR e.meta_event_name = "Purchase" THEN e.value ELSE 0 END), 0) AS revenue
        FROM ' . NvsApiSupport::q($table) . ' e
        ' . $whereSql . '
    ');
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'events',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'event_name' => $eventName,
            'status' => $status,
            'source' => $source,
            'transaction_id' => $transactionId,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'q' => $q,
        ],
        'summary' => [
            'total' => (int) ($summary['total'] ?? 0),
            'purchases' => (int) ($summary['purchases'] ?? 0),
            'revenue' => (float) ($summary['revenue'] ?? 0),
        ],
        'pagination' => $pagination,
        'items' => $items,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'events',
        'error' => 'events_failed',
        'message' => $e->getMessage(),
    ], 500);
}
