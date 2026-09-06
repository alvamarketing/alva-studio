<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

try {
    $pdo = Database::getConnection();
    $metaTable = Database::table('meta_deliveries');
    $eventsTable = Database::table('events');

    if (!NvsApiSupport::tableExists($pdo, $metaTable)) {
        NvsApiSupport::json([
            'ok' => true,
            'system' => 'nvs-track-core',
            'collection' => 'meta_deliveries',
            'table_exists' => false,
            'items' => [],
            'pagination' => NvsApiSupport::pagination(),
            'summary' => [
                'total' => 0,
                'sent' => 0,
                'ok' => 0,
                'errors' => 0,
            ],
        ]);
    }

    $metaColumns = array_flip(NvsApiSupport::getColumns($pdo, $metaTable));
    $eventsTableExists = NvsApiSupport::tableExists($pdo, $eventsTable);
    $eventColumns = $eventsTableExists ? array_flip(NvsApiSupport::getColumns($pdo, $eventsTable)) : [];

    $hasMetaColumn = function (string $column) use ($metaColumns): bool {
        return isset($metaColumns[$column]);
    };

    $hasEventColumn = function (string $column) use ($eventColumns): bool {
        return isset($eventColumns[$column]);
    };

    $propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);
    $dateFrom = NvsApiSupport::cleanDate($_GET['date_from'] ?? '');
    $dateTo = NvsApiSupport::cleanDate($_GET['date_to'] ?? '');
    $eventName = NvsApiSupport::cleanText($_GET['event_name'] ?? '', 120);
    $mode = NvsApiSupport::cleanText($_GET['mode'] ?? '', 80);
    $eventId = NvsApiSupport::cleanText($_GET['event_id'] ?? '', 190);
    $q = NvsApiSupport::cleanText($_GET['q'] ?? '', 190);
    $okFilter = isset($_GET['ok']) ? trim((string) $_GET['ok']) : '';
    $sentFilter = isset($_GET['sent']) ? trim((string) $_GET['sent']) : '';
    $httpCode = isset($_GET['http_code']) ? (int) $_GET['http_code'] : null;
    $pagination = NvsApiSupport::pagination();

    $canJoinEvents = $eventsTableExists && $hasMetaColumn('event_id') && $hasEventColumn('event_id');
    $eventsJoin = $canJoinEvents
        ? ' LEFT JOIN ' . NvsApiSupport::q($eventsTable) . ' e ON e.event_id = m.event_id '
        : '';

    $params = [];
    $where = [];
    $paramIndex = 0;

    $addParam = function ($value) use (&$params, &$paramIndex): string {
        $key = ':p' . $paramIndex++;
        $params[$key] = $value;
        return $key;
    };

    if ($propertyId !== '') {
        $propertyParts = [];
        $variants = NvsApiSupport::propertyVariants($propertyId);

        foreach ($variants as $variant) {
            if ($hasMetaColumn('property_id')) {
                $propertyParts[] = 'm.property_id = ' . $addParam($variant);
            }

            if ($canJoinEvents && $hasEventColumn('property_id')) {
                $propertyParts[] = 'e.property_id = ' . $addParam($variant);
            }

            if ($hasMetaColumn('payload_json')) {
                $propertyParts[] = 'm.payload_json LIKE ' . $addParam('%' . $variant . '%');
            }

            if ($hasMetaColumn('response_json')) {
                $propertyParts[] = 'm.response_json LIKE ' . $addParam('%' . $variant . '%');
            }
        }

        if ($propertyParts) {
            $where[] = '(' . implode(' OR ', $propertyParts) . ')';
        }
    }

    if ($hasMetaColumn('created_at')) {
        $where = array_merge($where, NvsApiSupport::dateWhere('m', 'created_at', $dateFrom, $dateTo, $params, 'created'));
    }

    if ($eventName !== '') {
        $eventParts = [];
        if ($hasMetaColumn('event_name')) {
            $eventParts[] = 'm.event_name = ' . $addParam($eventName);
        }
        if ($hasMetaColumn('meta_event_name')) {
            $eventParts[] = 'm.meta_event_name = ' . $addParam($eventName);
        }
        if ($eventParts) {
            $where[] = '(' . implode(' OR ', $eventParts) . ')';
        }
    }

    if ($mode !== '' && $hasMetaColumn('mode')) {
        $where[] = 'm.mode = ' . $addParam($mode);
    }

    if ($eventId !== '' && $hasMetaColumn('event_id')) {
        $where[] = 'm.event_id = ' . $addParam($eventId);
    }

    if ($okFilter !== '' && in_array($okFilter, ['0', '1'], true) && $hasMetaColumn('ok')) {
        $where[] = 'm.ok = ' . $addParam((int) $okFilter);
    }

    if ($sentFilter !== '' && in_array($sentFilter, ['0', '1'], true) && $hasMetaColumn('sent')) {
        $where[] = 'm.sent = ' . $addParam((int) $sentFilter);
    }

    if ($httpCode !== null && $httpCode > 0 && $hasMetaColumn('http_code')) {
        $where[] = 'm.http_code = ' . $addParam($httpCode);
    }

    if ($q !== '') {
        $qParts = [];
        foreach (['event_id', 'event_name', 'meta_event_name', 'curl_error', 'response_json', 'payload_json'] as $column) {
            if ($hasMetaColumn($column)) {
                $qParts[] = 'm.' . NvsApiSupport::q($column) . ' LIKE ' . $addParam('%' . $q . '%');
            }
        }
        if ($qParts) {
            $where[] = '(' . implode(' OR ', $qParts) . ')';
        }
    }

    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $fromSql = NvsApiSupport::q($metaTable) . ' m ' . $eventsJoin;

    $selectExtras = [];
    if ($canJoinEvents) {
        if ($hasEventColumn('property_id')) {
            $selectExtras[] = 'e.property_id AS event_property_id';
        }
        if ($hasEventColumn('transaction_id')) {
            $selectExtras[] = 'e.transaction_id AS transaction_id';
        }
        if ($hasEventColumn('value')) {
            $selectExtras[] = 'e.value AS event_value';
        }
        if ($hasEventColumn('currency')) {
            $selectExtras[] = 'e.currency AS event_currency';
        }
        if ($hasEventColumn('nvs_uid')) {
            $selectExtras[] = 'e.nvs_uid AS event_nvs_uid';
        }
        if ($hasEventColumn('nvs_sid')) {
            $selectExtras[] = 'e.nvs_sid AS event_nvs_sid';
        }
    }

    $orderBy = $hasMetaColumn('created_at')
        ? 'm.created_at DESC' . ($hasMetaColumn('id') ? ', m.id DESC' : '')
        : ($hasMetaColumn('id') ? 'm.id DESC' : '1 DESC');

    $sql = '
        SELECT
            m.*' . ($selectExtras ? ', ' . implode(', ', $selectExtras) : '') . '
        FROM ' . $fromSql . '
        ' . $whereSql . '
        ORDER BY ' . $orderBy . '
        LIMIT ' . (int) $pagination['limit'] . ' OFFSET ' . (int) $pagination['offset'] . '
    ';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $items = array_map(function (array $row): array {
        $row['resolved_property_id'] = $row['property_id'] ?? ($row['event_property_id'] ?? null);
        $row['sent'] = (int) ($row['sent'] ?? 0) === 1;
        $row['ok'] = (int) ($row['ok'] ?? 0) === 1;
        return NvsApiSupport::decodeFields($row, ['payload_json', 'response_json']);
    }, $rows);

    $summarySelect = [
        'COUNT(*) AS total',
        $hasMetaColumn('sent') ? 'SUM(CASE WHEN m.sent = 1 THEN 1 ELSE 0 END) AS sent_count' : '0 AS sent_count',
        $hasMetaColumn('ok') ? 'SUM(CASE WHEN m.ok = 1 THEN 1 ELSE 0 END) AS ok_count' : '0 AS ok_count',
        $hasMetaColumn('ok') ? 'SUM(CASE WHEN m.ok = 0 THEN 1 ELSE 0 END) AS error_count' : '0 AS error_count',
    ];

    $summaryStmt = $pdo->prepare('
        SELECT ' . implode(', ', $summarySelect) . '
        FROM ' . $fromSql . '
        ' . $whereSql . '
    ');
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'meta_deliveries',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'event_name' => $eventName,
            'mode' => $mode,
            'event_id' => $eventId,
            'q' => $q,
        ],
        'summary' => [
            'total' => (int) ($summary['total'] ?? 0),
            'sent' => (int) ($summary['sent_count'] ?? 0),
            'ok' => (int) ($summary['ok_count'] ?? 0),
            'errors' => (int) ($summary['error_count'] ?? 0),
        ],
        'pagination' => $pagination,
        'items' => $items,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'meta_deliveries',
        'error' => 'meta_deliveries_failed',
        'message' => $e->getMessage(),
    ], 500);
}
