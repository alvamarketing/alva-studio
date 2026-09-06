<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

try {
    $pdo = Database::getConnection();
    $table = Database::table('identities');

    if (!NvsApiSupport::tableExists($pdo, $table)) {
        NvsApiSupport::json([
            'ok' => true,
            'system' => 'nvs-track-core',
            'collection' => 'identities',
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
    $email = NvsApiSupport::cleanText($_GET['email'] ?? '', 190);
    $phone = NvsApiSupport::cleanText($_GET['phone'] ?? '', 80);
    $q = NvsApiSupport::cleanText($_GET['q'] ?? '', 190);
    $pagination = NvsApiSupport::pagination();

    $params = [];
    $where = [];

    if ($propertyId !== '') {
        $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, 'i', $propertyId, $params, ['first_utm_json', 'last_utm_json', 'provider_ids_json'], 'property'));
    }

    $dateColumn = NvsApiSupport::columnExists($pdo, $table, 'last_seen_at') ? 'last_seen_at' : 'created_at';
    $where = array_merge($where, NvsApiSupport::dateWhere('i', $dateColumn, $dateFrom, $dateTo, $params, 'date'));

    if ($nvsUid !== '') {
        $where[] = 'i.nvs_uid = :nvs_uid';
        $params[':nvs_uid'] = $nvsUid;
    }

    if ($email !== '') {
        $where[] = 'i.email LIKE :email';
        $params[':email'] = '%' . $email . '%';
    }

    if ($phone !== '') {
        $where[] = 'i.phone LIKE :phone';
        $params[':phone'] = '%' . $phone . '%';
    }

    if ($q !== '') {
        $where[] = '(
            i.nvs_uid LIKE :q
            OR i.email LIKE :q
            OR i.phone LIKE :q
            OR i.full_name LIKE :q
            OR i.first_landing_url LIKE :q
            OR i.last_landing_url LIKE :q
        )';
        $params[':q'] = '%' . $q . '%';
    }

    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $orderColumn = NvsApiSupport::orderColumn($pdo, $table, ['last_seen_at', 'updated_at', 'created_at', 'id']);

    $stmt = $pdo->prepare('
        SELECT i.*
        FROM ' . NvsApiSupport::q($table) . ' i
        ' . $whereSql . '
        ORDER BY i.' . NvsApiSupport::q($orderColumn) . ' DESC, i.id DESC
        LIMIT ' . (int) $pagination['limit'] . ' OFFSET ' . (int) $pagination['offset'] . '
    ');
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $items = array_map(function (array $row): array {
        $row = NvsApiSupport::decodeFields($row, ['first_utm_json', 'last_utm_json', 'provider_ids_json']);
        $row['email_masked'] = !empty($row['email']) ? preg_replace('/(^.).*(@.*$)/', '$1***$2', (string) $row['email']) : null;
        $row['phone_masked'] = !empty($row['phone']) ? preg_replace('/^(.*?)(\d{4})$/', '********$2', (string) $row['phone']) : null;
        return $row;
    }, $rows);

    $summaryStmt = $pdo->prepare('
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN email IS NOT NULL AND email <> "" THEN 1 ELSE 0 END) AS with_email,
            SUM(CASE WHEN phone IS NOT NULL AND phone <> "" THEN 1 ELSE 0 END) AS with_phone
        FROM ' . NvsApiSupport::q($table) . ' i
        ' . $whereSql . '
    ');
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'identities',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'nvs_uid' => $nvsUid,
            'email' => $email,
            'phone' => $phone,
            'q' => $q,
        ],
        'summary' => [
            'total' => (int) ($summary['total'] ?? 0),
            'with_email' => (int) ($summary['with_email'] ?? 0),
            'with_phone' => (int) ($summary['with_phone'] ?? 0),
        ],
        'pagination' => $pagination,
        'items' => $items,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'identities',
        'error' => 'identities_failed',
        'message' => $e->getMessage(),
    ], 500);
}
