<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

function nvsFetchRows(PDO $pdo, string $table, string $alias, array $where, array $params, int $limit, array $jsonFields = []): array
{
    if (!NvsApiSupport::tableExists($pdo, $table)) {
        return [];
    }

    $orderColumn = NvsApiSupport::orderColumn($pdo, $table, ['created_at', 'last_seen_at', 'updated_at', 'id']);
    $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $stmt = $pdo->prepare('
        SELECT ' . $alias . '.*
        FROM ' . NvsApiSupport::q($table) . ' ' . $alias . '
        ' . $whereSql . '
        ORDER BY ' . $alias . '.' . NvsApiSupport::q($orderColumn) . ' ASC, ' . $alias . '.id ASC
        LIMIT ' . (int) $limit . '
    ');
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    return array_map(function (array $row) use ($jsonFields): array {
        return NvsApiSupport::decodeFields($row, $jsonFields);
    }, $rows);
}

function nvsTimestampFromRow(array $row): int
{
    foreach (['created_at', 'last_seen_at', 'first_seen_at', 'started_at', 'updated_at'] as $field) {
        if (!empty($row[$field])) {
            $time = strtotime((string) $row[$field]);
            if ($time) {
                return $time;
            }
        }
    }

    if (!empty($row['event_time']) && is_numeric($row['event_time'])) {
        $eventTime = (int) $row['event_time'];
        if ($eventTime > 1000000000000) {
            $eventTime = (int) floor($eventTime / 1000);
        }
        return $eventTime;
    }

    return 0;
}

function nvsTimelineItem(string $type, array $row, array $extra = []): array
{
    return array_merge([
        'type' => $type,
        'timestamp' => nvsTimestampFromRow($row),
        'datetime' => $row['created_at'] ?? $row['last_seen_at'] ?? $row['first_seen_at'] ?? null,
        'event_id' => $row['event_id'] ?? null,
        'event_name' => $row['event_name'] ?? null,
        'meta_event_name' => $row['meta_event_name'] ?? null,
        'nvs_uid' => $row['nvs_uid'] ?? null,
        'nvs_sid' => $row['nvs_sid'] ?? null,
        'transaction_id' => $row['transaction_id'] ?? null,
        'page_url' => $row['page_url'] ?? $row['url'] ?? $row['last_page_url'] ?? $row['landing_url'] ?? null,
        'referrer' => $row['referrer'] ?? null,
        'value' => isset($row['value']) ? (float) $row['value'] : null,
        'currency' => $row['currency'] ?? null,
        'raw' => $row,
    ], $extra);
}

try {
    $pdo = Database::getConnection();

    $propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);
    $dateFrom = NvsApiSupport::cleanDate($_GET['date_from'] ?? '');
    $dateTo = NvsApiSupport::cleanDate($_GET['date_to'] ?? '');
    $nvsUid = NvsApiSupport::cleanText($_GET['nvs_uid'] ?? '', 190);
    $nvsSid = NvsApiSupport::cleanText($_GET['nvs_sid'] ?? '', 190);
    $transactionId = NvsApiSupport::cleanText($_GET['transaction_id'] ?? '', 190);
    $eventId = NvsApiSupport::cleanText($_GET['event_id'] ?? '', 190);
    $email = NvsApiSupport::cleanText($_GET['email'] ?? '', 190);
    $phone = NvsApiSupport::cleanText($_GET['phone'] ?? '', 80);
    $limit = NvsApiSupport::positiveInt($_GET['limit'] ?? 200, 200, 10, 500);

    $identitiesTable = Database::table('identities');
    $sessionsTable = Database::table('sessions');
    $browserTable = Database::table('browser_events');
    $eventsTable = Database::table('events');
    $metaTable = Database::table('meta_deliveries');
    $webhooksTable = Database::table('webhooks');

    $uids = array_values(array_filter([$nvsUid]));
    $sids = array_values(array_filter([$nvsSid]));
    $transactionIds = array_values(array_filter([$transactionId]));
    $eventIds = array_values(array_filter([$eventId]));

    // Descoberta inicial por e-mail/telefone.
    if (($email !== '' || $phone !== '') && NvsApiSupport::tableExists($pdo, $identitiesTable)) {
        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $identitiesTable, 'i', $propertyId, $params, ['first_utm_json', 'last_utm_json'], 'id_prop'));
        }
        if ($email !== '') {
            $where[] = 'i.email LIKE :email';
            $params[':email'] = '%' . $email . '%';
        }
        if ($phone !== '') {
            $where[] = 'i.phone LIKE :phone';
            $params[':phone'] = '%' . $phone . '%';
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $stmt = $pdo->prepare('SELECT i.nvs_uid FROM ' . NvsApiSupport::q($identitiesTable) . ' i ' . $whereSql . ' ORDER BY i.last_seen_at DESC LIMIT 25');
        $stmt->execute($params);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!empty($row['nvs_uid'])) {
                $uids[] = $row['nvs_uid'];
            }
        }
    }

    // Descoberta inicial por transação/event_id.
    if (($transactionId !== '' || $eventId !== '') && NvsApiSupport::tableExists($pdo, $eventsTable)) {
        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $eventsTable, 'e', $propertyId, $params, ['event_json', 'raw_payload_json'], 'event_prop'));
        }
        if ($transactionId !== '') {
            $where[] = '(e.transaction_id = :transaction_id OR e.event_json LIKE :transaction_like OR e.raw_payload_json LIKE :transaction_like)';
            $params[':transaction_id'] = $transactionId;
            $params[':transaction_like'] = '%' . $transactionId . '%';
        }
        if ($eventId !== '') {
            $where[] = 'e.event_id = :event_id';
            $params[':event_id'] = $eventId;
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $stmt = $pdo->prepare('SELECT e.nvs_uid, e.nvs_sid, e.transaction_id, e.event_id FROM ' . NvsApiSupport::q($eventsTable) . ' e ' . $whereSql . ' ORDER BY e.created_at DESC LIMIT 25');
        $stmt->execute($params);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!empty($row['nvs_uid'])) {
                $uids[] = $row['nvs_uid'];
            }
            if (!empty($row['nvs_sid'])) {
                $sids[] = $row['nvs_sid'];
            }
            if (!empty($row['transaction_id'])) {
                $transactionIds[] = $row['transaction_id'];
            }
            if (!empty($row['event_id'])) {
                $eventIds[] = $row['event_id'];
            }
        }
    }

    $uids = array_values(array_unique(array_filter($uids)));
    $sids = array_values(array_unique(array_filter($sids)));
    $transactionIds = array_values(array_unique(array_filter($transactionIds)));
    $eventIds = array_values(array_unique(array_filter($eventIds)));

    $timeline = [];
    $identityItems = [];
    $sessionItems = [];
    $browserItems = [];
    $eventItems = [];
    $metaItems = [];
    $webhookItems = [];

    // Identities
    if (NvsApiSupport::tableExists($pdo, $identitiesTable)) {
        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $identitiesTable, 'i', $propertyId, $params, ['first_utm_json', 'last_utm_json'], 'identity_prop'));
        }
        if ($uids) {
            $ph = [];
            foreach ($uids as $i => $uid) {
                $key = ':uid_' . $i;
                $params[$key] = $uid;
                $ph[] = $key;
            }
            $where[] = 'i.nvs_uid IN (' . implode(', ', $ph) . ')';
        }
        if ($email !== '') {
            $where[] = 'i.email LIKE :identity_email';
            $params[':identity_email'] = '%' . $email . '%';
        }
        if ($phone !== '') {
            $where[] = 'i.phone LIKE :identity_phone';
            $params[':identity_phone'] = '%' . $phone . '%';
        }
        if ($where) {
            $identityItems = nvsFetchRows($pdo, $identitiesTable, 'i', $where, $params, 50, ['first_utm_json', 'last_utm_json', 'provider_ids_json']);
            foreach ($identityItems as $row) {
                $timeline[] = nvsTimelineItem('identity_seen', $row);
            }
        }
    }

    // Sessions
    if (NvsApiSupport::tableExists($pdo, $sessionsTable)) {
        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $sessionsTable, 's', $propertyId, $params, ['utm_json', 'provider_ids_json'], 'session_prop'));
        }
        if ($uids) {
            $ph = [];
            foreach ($uids as $i => $uid) {
                $key = ':s_uid_' . $i;
                $params[$key] = $uid;
                $ph[] = $key;
            }
            $where[] = 's.nvs_uid IN (' . implode(', ', $ph) . ')';
        }
        if ($sids) {
            $ph = [];
            foreach ($sids as $i => $sid) {
                $key = ':sid_' . $i;
                $params[$key] = $sid;
                $ph[] = $key;
            }
            $where[] = 's.nvs_sid IN (' . implode(', ', $ph) . ')';
        }
        $where = array_merge($where, NvsApiSupport::dateWhere('s', NvsApiSupport::columnExists($pdo, $sessionsTable, 'last_seen_at') ? 'last_seen_at' : 'created_at', $dateFrom, $dateTo, $params, 'session_date'));
        if ($where) {
            $sessionItems = nvsFetchRows($pdo, $sessionsTable, 's', $where, $params, 100, ['utm_json', 'provider_ids_json']);
            foreach ($sessionItems as $row) {
                $timeline[] = nvsTimelineItem('session', $row);
                if (!empty($row['nvs_sid'])) {
                    $sids[] = $row['nvs_sid'];
                }
            }
        }
    }

    $uids = array_values(array_unique(array_filter($uids)));
    $sids = array_values(array_unique(array_filter($sids)));

    // Browser events
    if (NvsApiSupport::tableExists($pdo, $browserTable)) {
        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $browserTable, 'b', $propertyId, $params, ['params_json', 'context_json', 'raw_payload_json'], 'browser_prop'));
        }
        if ($uids) {
            $ph = [];
            foreach ($uids as $i => $uid) {
                $key = ':b_uid_' . $i;
                $params[$key] = $uid;
                $ph[] = $key;
            }
            $where[] = 'b.nvs_uid IN (' . implode(', ', $ph) . ')';
        }
        if ($sids) {
            $ph = [];
            foreach ($sids as $i => $sid) {
                $key = ':b_sid_' . $i;
                $params[$key] = $sid;
                $ph[] = $key;
            }
            $where[] = 'b.nvs_sid IN (' . implode(', ', $ph) . ')';
        }
        if ($eventId !== '') {
            $where[] = 'b.event_id = :browser_event_id';
            $params[':browser_event_id'] = $eventId;
        }
        $where = array_merge($where, NvsApiSupport::dateWhere('b', 'created_at', $dateFrom, $dateTo, $params, 'browser_date'));
        if (!$uids && !$sids && $propertyId !== '' && $eventId === '' && $transactionId === '' && $email === '' && $phone === '') {
            // Fallback: últimos eventos do projeto.
        }
        if ($where) {
            $browserItems = nvsFetchRows($pdo, $browserTable, 'b', $where, $params, $limit, ['params_json', 'user_json', 'context_json', 'raw_payload_json']);
            foreach ($browserItems as $row) {
                $timeline[] = nvsTimelineItem('browser_event', $row);
                if (!empty($row['event_id'])) {
                    $eventIds[] = $row['event_id'];
                }
            }
        }
    }

    // Server/events purchases
    if (NvsApiSupport::tableExists($pdo, $eventsTable)) {
        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $eventsTable, 'e', $propertyId, $params, ['event_json', 'raw_payload_json'], 'event_prop_2'));
        }
        $identityParts = [];
        if ($uids) {
            $ph = [];
            foreach ($uids as $i => $uid) {
                $key = ':e_uid_' . $i;
                $params[$key] = $uid;
                $ph[] = $key;
            }
            $identityParts[] = 'e.nvs_uid IN (' . implode(', ', $ph) . ')';
        }
        if ($sids) {
            $ph = [];
            foreach ($sids as $i => $sid) {
                $key = ':e_sid_' . $i;
                $params[$key] = $sid;
                $ph[] = $key;
            }
            $identityParts[] = 'e.nvs_sid IN (' . implode(', ', $ph) . ')';
        }
        if ($transactionIds) {
            $ph = [];
            foreach ($transactionIds as $i => $tx) {
                $key = ':e_tx_' . $i;
                $params[$key] = $tx;
                $ph[] = $key;
            }
            $identityParts[] = 'e.transaction_id IN (' . implode(', ', $ph) . ')';
        }
        if ($eventIds) {
            $ph = [];
            foreach ($eventIds as $i => $eid) {
                $key = ':e_eid_' . $i;
                $params[$key] = $eid;
                $ph[] = $key;
            }
            $identityParts[] = 'e.event_id IN (' . implode(', ', $ph) . ')';
        }
        if ($identityParts) {
            $where[] = '(' . implode(' OR ', $identityParts) . ')';
        }
        $where = array_merge($where, NvsApiSupport::dateWhere('e', 'created_at', $dateFrom, $dateTo, $params, 'events_date'));
        if ($where) {
            $eventItems = nvsFetchRows($pdo, $eventsTable, 'e', $where, $params, $limit, ['event_json', 'raw_payload_json']);
            foreach ($eventItems as $row) {
                $timeline[] = nvsTimelineItem('server_event', $row);
                if (!empty($row['event_id'])) {
                    $eventIds[] = $row['event_id'];
                }
                if (!empty($row['transaction_id'])) {
                    $transactionIds[] = $row['transaction_id'];
                }
            }
        }
    }

    $eventIds = array_values(array_unique(array_filter($eventIds)));
    $transactionIds = array_values(array_unique(array_filter($transactionIds)));

    // Meta deliveries tied to event IDs
    if ($eventIds && NvsApiSupport::tableExists($pdo, $metaTable)) {
        $params = [];
        $ph = [];
        foreach ($eventIds as $i => $eid) {
            $key = ':m_eid_' . $i;
            $params[$key] = $eid;
            $ph[] = $key;
        }
        $where = ['m.event_id IN (' . implode(', ', $ph) . ')'];
        $metaItems = nvsFetchRows($pdo, $metaTable, 'm', $where, $params, $limit, ['payload_json', 'response_json']);
        foreach ($metaItems as $row) {
            $timeline[] = nvsTimelineItem('meta_delivery', $row, [
                'meta' => [
                    'sent' => (int) ($row['sent'] ?? 0) === 1,
                    'ok' => (int) ($row['ok'] ?? 0) === 1,
                    'http_code' => $row['http_code'] ?? null,
                    'mode' => $row['mode'] ?? null,
                ],
            ]);
        }
    }

    // Webhooks related by transaction or event id, or recent project webhooks if a transaction exists in payload.
    if (NvsApiSupport::tableExists($pdo, $webhooksTable)) {
        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $webhooksTable, 'w', $propertyId, $params, ['payload_json'], 'webhook_prop'));
        }
        $likeParts = [];
        foreach (array_merge($transactionIds, $eventIds, $uids, $sids) as $i => $needle) {
            $needle = trim((string) $needle);
            if ($needle === '') {
                continue;
            }
            $key = ':wh_like_' . $i;
            $params[$key] = '%' . $needle . '%';
            $likeParts[] = 'w.payload_json LIKE ' . $key;
        }
        if ($likeParts) {
            $where[] = '(' . implode(' OR ', $likeParts) . ')';
        }
        $where = array_merge($where, NvsApiSupport::dateWhere('w', 'created_at', $dateFrom, $dateTo, $params, 'webhook_date'));
        if ($where) {
            $webhookItems = nvsFetchRows($pdo, $webhooksTable, 'w', $where, $params, 100, ['payload_json', 'headers_json']);
            foreach ($webhookItems as $row) {
                $timeline[] = nvsTimelineItem('webhook', $row, [
                    'platform' => $row['platform'] ?? null,
                    'action' => $row['action'] ?? null,
                    'auth_status' => $row['auth_status'] ?? null,
                ]);
            }
        }
    }

    usort($timeline, function (array $a, array $b): int {
        return ($a['timestamp'] <=> $b['timestamp']);
    });

    $timeline = array_slice($timeline, 0, $limit);

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'collection' => 'journey',
        'auth' => $auth,
        'filters' => [
            'property_id' => $propertyId,
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'nvs_uid' => $nvsUid,
            'nvs_sid' => $nvsSid,
            'transaction_id' => $transactionId,
            'event_id' => $eventId,
            'email' => $email,
            'phone' => $phone,
        ],
        'resolved' => [
            'nvs_uids' => $uids,
            'nvs_sids' => $sids,
            'transaction_ids' => $transactionIds,
            'event_ids' => $eventIds,
        ],
        'summary' => [
            'identities' => count($identityItems),
            'sessions' => count($sessionItems),
            'browser_events' => count($browserItems),
            'events' => count($eventItems),
            'meta_deliveries' => count($metaItems),
            'webhooks' => count($webhookItems),
            'timeline_items' => count($timeline),
        ],
        'items' => [
            'identities' => $identityItems,
            'sessions' => $sessionItems,
            'browser_events' => $browserItems,
            'events' => $eventItems,
            'meta_deliveries' => $metaItems,
            'webhooks' => $webhookItems,
        ],
        'timeline' => $timeline,
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'collection' => 'journey',
        'error' => 'journey_failed',
        'message' => $e->getMessage(),
    ], 500);
}
