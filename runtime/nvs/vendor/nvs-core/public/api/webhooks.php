<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

try {
    $pdo = Database::getConnection();
    $table = Database::table('webhooks');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        NvsApiSupport::json([
            'ok' => true,
            'system' => 'nvs-track-core',
            'collection' => 'webhooks',
            'table_exists' => false,
            'items' => [],
            'pagination' => NvsApiSupport::pagination(),
            'summary' => [
                'total' => 0,
                'verified' => 0,
                'missing_but_allowed' => 0,
                'not_required' => 0,
            ],
        ]);
    }

    $propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);
    $dateFrom = NvsApiSupport::cleanDate($_GET['date_from'] ?? '');
    $dateTo = NvsApiSupport::cleanDate($_GET['date_to'] ?? '');
    $platform = NvsApiSupport::cleanText($_GET['platform'] ?? '', 80);
    $action = NvsApiSupport::cleanText($_GET['action'] ?? '', 120);
    $authStatus = NvsApiSupport::cleanText($_GET['auth_status'] ?? '', 80);
    $deliveryId = NvsApiSupport::cleanText($_GET['delivery_id'] ?? '', 190);
    $q = NvsApiSupport::cleanText($_GET['q'] ?? '', 190);
    $pagination = NvsApiSupport::pagination();

    $params = [];
    $where = [];

    if ($propertyId !== '') {
        $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, 'w', $propertyId, $params, ['payload_json', 'headers_json'], 'property'));
    }

    $where = array_merge($where, NvsApiSupport::dateWhere('w', 'created_at', $dateFrom, $dateTo, $params, 'created'));

    if ($platform !== '') {
        $where[] = 'w.platform = :platform';
        $params[':platform'] = $platform;
    }

    if ($action !== '') {
        $where[] = 'w.action = :action';
        $params[':action'] = $action;
    }

    if ($authStatus !== '') {
        $where[] = 'w.auth_status = :auth_status';
        $params[':auth_status'] = $authStatus;
    }

    if ($deliveryId !== '') {
        $where[] = 'w.delivery_id = :delivery_id';
        $params[':delivery_id'] = $deliveryId;
    }

    if ($q !== '') {
        $where[] = '(
            w.delivery_id LIKE :q
            OR w.source_event LIKE :q
            OR w.platform LIKE :q
            OR w.action LIKE :q
            OR w.payload_json LIKE :q
        )';
        $params[':q'] = '%' . $q . '%';
    }

    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $stmt = $pdo->prepare('
        SELECT w.*
        FROM ' . NvsApiSupport::q($table) . ' w
        ' . $whereSql . '
        ORDER BY w.created_at DESC, w.id DESC
        LIMIT ' . (int) $pagination['limit'] . ' OFFSET ' . (int) $pagination['offset'] . '
    ');
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $items = array_map(function (array $row): array {
        $row = NvsApiSupport::decodeFields($row, ['payload_json', 'headers_json']);
        $payload = $row['payload_json_decoded'] ?? [];
        $row['detected_property_id'] = $row['property_id']
            ?: NvsApiSupport::firstNestedValue($payload, ['property_id', 'nvs_property_id', 'remote_property_id']);
        $row['detected_transaction_id'] = NvsApiSupport::firstNestedValue($payload, ['transaction_id', 'order_id', 'checkout_session_id', 'id']);
        $row['detected_status'] = NvsApiSupport::firstNestedValue($payload, ['status', 'payment_status', 'order_status']);
        return $row;
    }, $rows);

    $summaryStmt = $pdo->prepare('
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN w.auth_status = "verified" THEN 1 ELSE 0 END) AS verified_count,
            SUM(CASE WHEN w.auth_status = "missing_but_allowed" THEN 1 ELSE 0 END) AS missing_but_allowed_count,
            SUM(CASE WHEN w.auth_status = "not_required" THEN 1 ELSE 0 END) AS not_required_count
        FROM ' . NvsApiSupport::q($table) . ' w
        ' . $whereSql . '
    ');
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'webhooks',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'platform' => $platform,
            'action' => $action,
            'auth_status' => $authStatus,
            'delivery_id' => $deliveryId,
            'q' => $q,
        ],
        'summary' => [
            'total' => (int) ($summary['total'] ?? 0),
            'verified' => (int) ($summary['verified_count'] ?? 0),
            'missing_but_allowed' => (int) ($summary['missing_but_allowed_count'] ?? 0),
            'not_required' => (int) ($summary['not_required_count'] ?? 0),
        ],
        'pagination' => $pagination,
        'items' => $items,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'webhooks',
        'error' => 'webhooks_failed',
        'message' => $e->getMessage(),
    ], 500);
}
