<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

try {
    $pdo = Database::getConnection();
    $table = Database::table('events');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        NvsApiSupport::json([
            'ok' => true,
            'system' => 'nvs-track-core',
            'collection' => 'purchases',
            'table_exists' => false,
            'items' => [],
            'pagination' => NvsApiSupport::pagination(),
            'summary' => [
                'total' => 0,
                'revenue' => 0,
                'average_order_value' => 0,
            ],
        ]);
    }

    $propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);
    $dateFrom = NvsApiSupport::cleanDate($_GET['date_from'] ?? '');
    $dateTo = NvsApiSupport::cleanDate($_GET['date_to'] ?? '');
    $transactionId = NvsApiSupport::cleanText($_GET['transaction_id'] ?? '', 190);
    $nvsUid = NvsApiSupport::cleanText($_GET['nvs_uid'] ?? '', 190);
    $nvsSid = NvsApiSupport::cleanText($_GET['nvs_sid'] ?? '', 190);
    $status = NvsApiSupport::cleanText($_GET['status'] ?? '', 80);
    $q = NvsApiSupport::cleanText($_GET['q'] ?? '', 190);
    $pagination = NvsApiSupport::pagination();

    $params = [];
    $where = [
        '(e.event_name = "purchase" OR e.meta_event_name = "Purchase")',
    ];

    if ($propertyId !== '') {
        $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, 'e', $propertyId, $params, ['event_json', 'raw_payload_json'], 'property'));
    }

    $where = array_merge($where, NvsApiSupport::dateWhere('e', 'created_at', $dateFrom, $dateTo, $params, 'created'));

    if ($transactionId !== '') {
        $where[] = '(e.transaction_id = :transaction_id OR e.event_json LIKE :transaction_like OR e.raw_payload_json LIKE :transaction_like)';
        $params[':transaction_id'] = $transactionId;
        $params[':transaction_like'] = '%' . $transactionId . '%';
    }

    if ($nvsUid !== '') {
        $where[] = 'e.nvs_uid = :nvs_uid';
        $params[':nvs_uid'] = $nvsUid;
    }

    if ($nvsSid !== '') {
        $where[] = 'e.nvs_sid = :nvs_sid';
        $params[':nvs_sid'] = $nvsSid;
    }

    if ($status !== '') {
        $where[] = '(e.status = :status OR e.event_json LIKE :status_like)';
        $params[':status'] = $status;
        $params[':status_like'] = '%' . $status . '%';
    }

    if ($q !== '') {
        $where[] = '(
            e.event_id LIKE :q
            OR e.transaction_id LIKE :q
            OR e.nvs_uid LIKE :q
            OR e.nvs_sid LIKE :q
            OR e.event_json LIKE :q
            OR e.raw_payload_json LIKE :q
        )';
        $params[':q'] = '%' . $q . '%';
    }

    $whereSql = 'WHERE ' . implode(' AND ', $where);

    $stmt = $pdo->prepare('
        SELECT e.*
        FROM ' . NvsApiSupport::q($table) . ' e
        ' . $whereSql . '
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ' . (int) $pagination['limit'] . ' OFFSET ' . (int) $pagination['offset'] . '
    ');
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $items = array_map(function (array $row): array {
        $row = NvsApiSupport::decodeFields($row, ['event_json', 'raw_payload_json']);
        $event = $row['event_json_decoded'] ?? [];
        $raw = $row['raw_payload_json_decoded'] ?? [];
        $params = is_array($event['params'] ?? null) ? $event['params'] : [];
        $user = is_array($event['user'] ?? null) ? $event['user'] : [];
        $context = is_array($event['context'] ?? null) ? $event['context'] : [];

        $row['purchase'] = [
            'transaction_id' => $row['transaction_id'] ?: ($params['transaction_id'] ?? NvsApiSupport::firstNestedValue($raw, ['transaction_id', 'order_id', 'id'])),
            'value' => isset($row['value']) ? (float) $row['value'] : (isset($params['value']) ? (float) $params['value'] : null),
            'currency' => $row['currency'] ?: ($params['currency'] ?? null),
            'status' => $row['status'] ?: ($params['status'] ?? NvsApiSupport::firstNestedValue($raw, ['status', 'payment_status', 'order_status'])),
            'items' => $params['items'] ?? NvsApiSupport::firstNestedValue($raw, ['items', 'products']),
            'email' => $user['email'] ?? NvsApiSupport::firstNestedValue($raw, ['email', 'customer_email']),
            'phone' => $user['phone'] ?? NvsApiSupport::firstNestedValue($raw, ['phone', 'customer_phone']),
            'nvs_uid' => $row['nvs_uid'] ?: ($context['nvs_uid'] ?? null),
            'nvs_sid' => $row['nvs_sid'] ?: ($context['nvs_sid'] ?? null),
        ];

        return $row;
    }, $rows);

    $summaryStmt = $pdo->prepare('
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(e.value), 0) AS revenue
        FROM ' . NvsApiSupport::q($table) . ' e
        ' . $whereSql . '
    ');
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];
    $total = (int) ($summary['total'] ?? 0);
    $revenue = (float) ($summary['revenue'] ?? 0);

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'purchases',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'transaction_id' => $transactionId,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'status' => $status,
            'q' => $q,
        ],
        'summary' => [
            'total' => $total,
            'revenue' => $revenue,
            'average_order_value' => $total > 0 ? round($revenue / $total, 2) : 0,
        ],
        'pagination' => $pagination,
        'items' => $items,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'purchases',
        'error' => 'purchases_failed',
        'message' => $e->getMessage(),
    ], 500);
}
