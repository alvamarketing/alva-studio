<?php
require_once __DIR__ . '/../../src/NvsApiSupport.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
$auth = NvsApiSupport::requireAuth();

function nvsMetricsHumanBytes($bytes): ?string
{
    if ($bytes === null || $bytes === false) {
        return null;
    }

    $bytes = (float) $bytes;
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $index = 0;

    while ($bytes >= 1024 && $index < count($units) - 1) {
        $bytes /= 1024;
        $index++;
    }

    return round($bytes, $index === 0 ? 0 : 2) . ' ' . $units[$index];
}

function nvsMetricsSafeDiskValue(string $function, string $path): ?int
{
    if (!function_exists($function)) {
        return null;
    }

    try {
        $value = @$function($path);
        if ($value === false || $value === null) {
            return null;
        }
        return (int) $value;
    } catch (Throwable $e) {
        return null;
    }
}

function nvsMetricsDirectorySize(string $path, int $maxFiles = 10000, float $maxSeconds = 3.0): array
{
    $result = [
        'available' => false,
        'bytes' => null,
        'human' => null,
        'files_scanned' => 0,
        'directories_scanned' => 0,
        'truncated' => false,
        'errors' => 0,
    ];

    if ($path === '' || !is_dir($path) || !is_readable($path)) {
        return $result;
    }

    $result['available'] = true;
    $result['bytes'] = 0;
    $startedAt = microtime(true);
    $stack = [$path];

    while ($stack) {
        if ($result['files_scanned'] >= $maxFiles || (microtime(true) - $startedAt) >= $maxSeconds) {
            $result['truncated'] = true;
            break;
        }

        $dir = array_pop($stack);
        $result['directories_scanned']++;

        try {
            $iterator = new DirectoryIterator($dir);
        } catch (Throwable $e) {
            $result['errors']++;
            continue;
        }

        foreach ($iterator as $item) {
            if ($item->isDot()) {
                continue;
            }

            if ($result['files_scanned'] >= $maxFiles || (microtime(true) - $startedAt) >= $maxSeconds) {
                $result['truncated'] = true;
                break 2;
            }

            try {
                if ($item->isLink()) {
                    continue;
                }

                if ($item->isDir()) {
                    $stack[] = $item->getPathname();
                    continue;
                }

                if ($item->isFile()) {
                    $result['bytes'] += (int) $item->getSize();
                    $result['files_scanned']++;
                }
            } catch (Throwable $e) {
                $result['errors']++;
            }
        }
    }

    $result['human'] = nvsMetricsHumanBytes($result['bytes']);
    return $result;
}

function nvsMetricsTableSize(PDO $pdo, string $table): array
{
    $fallback = [
        'estimated_rows' => null,
        'data_length_bytes' => null,
        'index_length_bytes' => null,
        'total_bytes' => null,
        'total_human' => null,
    ];

    try {
        $stmt = $pdo->query('SHOW TABLE STATUS LIKE ' . $pdo->quote($table));
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;

        if (!$row) {
            return $fallback;
        }

        $dataLength = isset($row['Data_length']) ? (int) $row['Data_length'] : null;
        $indexLength = isset($row['Index_length']) ? (int) $row['Index_length'] : null;
        $total = ($dataLength ?? 0) + ($indexLength ?? 0);

        return [
            'estimated_rows' => isset($row['Rows']) ? (int) $row['Rows'] : null,
            'data_length_bytes' => $dataLength,
            'index_length_bytes' => $indexLength,
            'total_bytes' => $total,
            'total_human' => nvsMetricsHumanBytes($total),
        ];
    } catch (Throwable $e) {
        return $fallback;
    }
}

function nvsMetricsCountRows(PDO $pdo, string $table): int
{
    try {
        if (!NvsApiSupport::tableExists($pdo, $table)) {
            return 0;
        }

        $stmt = $pdo->query('SELECT COUNT(*) FROM ' . NvsApiSupport::q($table));
        return (int) $stmt->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}

function nvsMetricsFirstExistingColumn(PDO $pdo, string $table, array $columns): ?string
{
    foreach ($columns as $column) {
        if (NvsApiSupport::columnExists($pdo, $table, $column)) {
            return $column;
        }
    }

    return null;
}

function nvsMetricsMaxDate(PDO $pdo, string $table, array $columns, string $propertyId = ''): ?string
{
    try {
        if (!NvsApiSupport::tableExists($pdo, $table)) {
            return null;
        }

        $column = nvsMetricsFirstExistingColumn($pdo, $table, $columns);
        if (!$column) {
            return null;
        }

        $params = [];
        $where = [];
        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, '', $propertyId, $params, ['payload_json', 'raw_payload_json', 'headers_json', 'context_json', 'data_json'], 'property_max_' . md5($table)));
        }

        $sql = 'SELECT MAX(' . NvsApiSupport::q($column) . ') FROM ' . NvsApiSupport::q($table) . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $value = $stmt->fetchColumn();

        return $value ? (string) $value : null;
    } catch (Throwable $e) {
        return null;
    }
}

function nvsMetricsCountLast24h(PDO $pdo, string $table, array $columns, string $propertyId = '', array $extraWhere = []): int
{
    try {
        if (!NvsApiSupport::tableExists($pdo, $table)) {
            return 0;
        }

        $column = nvsMetricsFirstExistingColumn($pdo, $table, $columns);
        if (!$column) {
            return 0;
        }

        $params = [':since_24h' => date('Y-m-d H:i:s', time() - 86400)];
        $where = [NvsApiSupport::q($column) . ' >= :since_24h'];

        if ($propertyId !== '') {
            $where = array_merge($where, NvsApiSupport::propertyWhere($pdo, $table, '', $propertyId, $params, ['payload_json', 'raw_payload_json', 'headers_json', 'context_json', 'data_json'], 'property_24h_' . md5($table)));
        }

        foreach ($extraWhere as $extra) {
            if (is_string($extra) && trim($extra) !== '') {
                $where[] = '(' . $extra . ')';
            }
        }

        $sql = 'SELECT COUNT(*) FROM ' . NvsApiSupport::q($table) . ' WHERE ' . implode(' AND ', $where);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}

function nvsMetricsDatabaseTables(PDO $pdo): array
{
    $known = [
        'properties' => Database::table('properties'),
        'events' => Database::table('events'),
        'browser_events' => Database::table('browser_events'),
        'sessions' => Database::table('sessions'),
        'identities' => Database::table('identities'),
        'webhooks' => Database::table('webhooks'),
        'meta_deliveries' => Database::table('meta_deliveries'),
        'settings' => Database::table('settings'),
        'integrations' => Database::table('integrations'),
    ];

    $items = [];
    $totals = [
        'tables_count' => 0,
        'rows_count' => 0,
        'estimated_total_bytes' => 0,
    ];

    foreach ($known as $key => $table) {
        $exists = NvsApiSupport::tableExists($pdo, $table);
        $rows = $exists ? nvsMetricsCountRows($pdo, $table) : 0;
        $size = $exists ? nvsMetricsTableSize($pdo, $table) : nvsMetricsTableSize($pdo, '__missing__');

        if ($exists) {
            $totals['tables_count']++;
            $totals['rows_count'] += $rows;
            $totals['estimated_total_bytes'] += (int) ($size['total_bytes'] ?? 0);
        }

        $items[$key] = [
            'table' => $table,
            'exists' => $exists,
            'rows' => $rows,
            'estimated_rows' => $size['estimated_rows'],
            'data_length_bytes' => $size['data_length_bytes'],
            'index_length_bytes' => $size['index_length_bytes'],
            'total_bytes' => $size['total_bytes'],
            'total_human' => $size['total_human'],
        ];
    }

    $totals['estimated_total_human'] = nvsMetricsHumanBytes($totals['estimated_total_bytes']);

    return [
        'totals' => $totals,
        'items' => $items,
    ];
}

function nvsMetricsWarnings(array $disk, array $logs, array $database, array $activity): array
{
    $warnings = [];

    $usedPercent = $disk['used_percent'] ?? null;
    if ($usedPercent !== null && $usedPercent >= 90) {
        $warnings[] = [
            'level' => 'danger',
            'code' => 'disk_high_usage',
            'message' => 'Uso de disco acima de 90%.',
        ];
    } elseif ($usedPercent !== null && $usedPercent >= 80) {
        $warnings[] = [
            'level' => 'warning',
            'code' => 'disk_attention',
            'message' => 'Uso de disco acima de 80%.',
        ];
    }

    $logsBytes = $logs['bytes'] ?? null;
    if ($logsBytes !== null && $logsBytes >= 100 * 1024 * 1024) {
        $warnings[] = [
            'level' => 'warning',
            'code' => 'logs_large',
            'message' => 'Pasta de logs acima de 100 MB.',
        ];
    }

    if (empty($database['connected'])) {
        $warnings[] = [
            'level' => 'danger',
            'code' => 'database_disconnected',
            'message' => 'Banco de dados desconectado.',
        ];
    }

    if ((int) ($activity['browser_events_last_24h'] ?? 0) === 0 && (int) ($activity['events_last_24h'] ?? 0) === 0) {
        $warnings[] = [
            'level' => 'warning',
            'code' => 'no_recent_events',
            'message' => 'Nenhum evento recebido nas últimas 24 horas.',
        ];
    }

    if ((int) ($activity['meta_errors_last_24h'] ?? 0) > 0) {
        $warnings[] = [
            'level' => 'warning',
            'code' => 'meta_errors_recent',
            'message' => 'Existem erros Meta nas últimas 24 horas.',
        ];
    }

    return $warnings;
}

function nvsMetricsStatusFromWarnings(array $warnings): string
{
    foreach ($warnings as $warning) {
        if (($warning['level'] ?? '') === 'danger') {
            return 'danger';
        }
    }

    foreach ($warnings as $warning) {
        if (($warning['level'] ?? '') === 'warning') {
            return 'warning';
        }
    }

    return 'healthy';
}

try {
    $pdo = Database::getConnection();
    $propertyId = NvsApiSupport::cleanText($_GET['property_id'] ?? '', 120);

    $coreRoot = realpath(__DIR__ . '/../..') ?: dirname(__DIR__, 2);
    $logsPath = $coreRoot . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'logs';

    $diskTotal = nvsMetricsSafeDiskValue('disk_total_space', $coreRoot);
    $diskFree = nvsMetricsSafeDiskValue('disk_free_space', $coreRoot);
    $diskUsed = ($diskTotal !== null && $diskFree !== null) ? max(0, $diskTotal - $diskFree) : null;
    $diskUsedPercent = ($diskTotal !== null && $diskTotal > 0 && $diskUsed !== null) ? round(($diskUsed / $diskTotal) * 100, 2) : null;

    $coreDirSize = nvsMetricsDirectorySize($coreRoot, 15000, 4.0);
    $logsDirSize = nvsMetricsDirectorySize($logsPath, 10000, 3.0);

    $dbTables = nvsMetricsDatabaseTables($pdo);

    $eventsTable = Database::table('events');
    $browserEventsTable = Database::table('browser_events');
    $sessionsTable = Database::table('sessions');
    $identitiesTable = Database::table('identities');
    $webhooksTable = Database::table('webhooks');
    $metaDeliveriesTable = Database::table('meta_deliveries');

    $metaExtraWhere = [];
    if (NvsApiSupport::tableExists($pdo, $metaDeliveriesTable)) {
        $errorParts = [];
        if (NvsApiSupport::columnExists($pdo, $metaDeliveriesTable, 'ok')) {
            $errorParts[] = '`ok` = 0';
        }
        if (NvsApiSupport::columnExists($pdo, $metaDeliveriesTable, 'sent')) {
            $errorParts[] = '`sent` = 0';
        }
        if (NvsApiSupport::columnExists($pdo, $metaDeliveriesTable, 'http_code')) {
            $errorParts[] = '`http_code` >= 400';
        }
        if (NvsApiSupport::columnExists($pdo, $metaDeliveriesTable, 'curl_error')) {
            $errorParts[] = '(`curl_error` IS NOT NULL AND `curl_error` <> "")';
        }
        if ($errorParts) {
            $metaExtraWhere[] = '(' . implode(' OR ', $errorParts) . ')';
        }
    }

    $dateColumns = ['created_at', 'received_at', 'event_time', 'last_seen_at', 'updated_at'];

    $activity = [
        'property_id_filter' => $propertyId !== '' ? $propertyId : null,
        'last_browser_event_at' => nvsMetricsMaxDate($pdo, $browserEventsTable, $dateColumns, $propertyId),
        'last_event_at' => nvsMetricsMaxDate($pdo, $eventsTable, $dateColumns, $propertyId),
        'last_session_at' => nvsMetricsMaxDate($pdo, $sessionsTable, ['last_seen_at', 'updated_at', 'created_at'], $propertyId),
        'last_identity_at' => nvsMetricsMaxDate($pdo, $identitiesTable, ['last_seen_at', 'updated_at', 'created_at'], $propertyId),
        'last_webhook_at' => nvsMetricsMaxDate($pdo, $webhooksTable, $dateColumns, $propertyId),
        'last_meta_delivery_at' => nvsMetricsMaxDate($pdo, $metaDeliveriesTable, $dateColumns, $propertyId),
        'events_last_24h' => nvsMetricsCountLast24h($pdo, $eventsTable, $dateColumns, $propertyId),
        'browser_events_last_24h' => nvsMetricsCountLast24h($pdo, $browserEventsTable, $dateColumns, $propertyId),
        'sessions_last_24h' => nvsMetricsCountLast24h($pdo, $sessionsTable, ['created_at', 'last_seen_at', 'updated_at'], $propertyId),
        'identities_last_24h' => nvsMetricsCountLast24h($pdo, $identitiesTable, ['created_at', 'last_seen_at', 'updated_at'], $propertyId),
        'webhooks_last_24h' => nvsMetricsCountLast24h($pdo, $webhooksTable, $dateColumns, $propertyId),
        'meta_deliveries_last_24h' => nvsMetricsCountLast24h($pdo, $metaDeliveriesTable, $dateColumns, $propertyId),
        'meta_errors_last_24h' => nvsMetricsCountLast24h($pdo, $metaDeliveriesTable, $dateColumns, $propertyId, $metaExtraWhere),
    ];

    $disk = [
        'available' => $diskTotal !== null || $diskFree !== null,
        'total_bytes' => $diskTotal,
        'total_human' => nvsMetricsHumanBytes($diskTotal),
        'free_bytes' => $diskFree,
        'free_human' => nvsMetricsHumanBytes($diskFree),
        'used_bytes' => $diskUsed,
        'used_human' => nvsMetricsHumanBytes($diskUsed),
        'used_percent' => $diskUsedPercent,
        'core_dir_size_bytes' => $coreDirSize['bytes'],
        'core_dir_size_human' => $coreDirSize['human'],
        'core_dir_scan' => [
            'files_scanned' => $coreDirSize['files_scanned'],
            'directories_scanned' => $coreDirSize['directories_scanned'],
            'truncated' => $coreDirSize['truncated'],
            'errors' => $coreDirSize['errors'],
        ],
        'logs_dir_size_bytes' => $logsDirSize['bytes'],
        'logs_dir_size_human' => $logsDirSize['human'],
        'logs_dir_scan' => [
            'files_scanned' => $logsDirSize['files_scanned'],
            'directories_scanned' => $logsDirSize['directories_scanned'],
            'truncated' => $logsDirSize['truncated'],
            'errors' => $logsDirSize['errors'],
        ],
    ];

    $database = [
        'connected' => true,
        'tables_count' => $dbTables['totals']['tables_count'],
        'rows_count' => $dbTables['totals']['rows_count'],
        'estimated_total_bytes' => $dbTables['totals']['estimated_total_bytes'],
        'estimated_total_human' => $dbTables['totals']['estimated_total_human'],
        'tables' => $dbTables['items'],
    ];

    $php = [
        'version' => PHP_VERSION,
        'memory_limit' => ini_get('memory_limit'),
        'memory_usage_bytes' => memory_get_usage(true),
        'memory_usage_human' => nvsMetricsHumanBytes(memory_get_usage(true)),
        'memory_peak_usage_bytes' => memory_get_peak_usage(true),
        'memory_peak_usage_human' => nvsMetricsHumanBytes(memory_get_peak_usage(true)),
        'max_execution_time' => ini_get('max_execution_time'),
        'upload_max_filesize' => ini_get('upload_max_filesize'),
        'post_max_size' => ini_get('post_max_size'),
    ];

    $warnings = nvsMetricsWarnings($disk, $logsDirSize, $database, $activity);
    $status = nvsMetricsStatusFromWarnings($warnings);

    NvsApiSupport::json([
        'ok' => true,
        'system' => 'nvs-track-core',
        'version' => NvsApiSupport::CORE_VERSION,
        'collection' => 'server_metrics',
        'auth' => [
            'mode' => $auth['mode'],
            'role' => $auth['role'],
        ],
        'status' => $status,
        'generated_at' => date('c'),
        'filters' => [
            'property_id' => $propertyId !== '' ? $propertyId : null,
        ],
        'capabilities' => [
            'server_metrics' => true,
            'disk_metrics' => true,
            'php_metrics' => true,
            'database_metrics' => true,
            'activity_metrics' => true,
        ],
        'metrics' => [
            'disk' => $disk,
            'php' => $php,
            'database' => $database,
            'activity' => $activity,
        ],
        'warnings' => $warnings,
        'notes' => [
            'Este endpoint mede a instalação Core e o ambiente PHP disponível para ela.',
            'Em hospedagem compartilhada, CPU/RAM total real do servidor podem não estar disponíveis com precisão.',
            'Nenhum token, senha, .env ou caminho interno sensível é retornado.',
        ],
    ]);
} catch (Throwable $e) {
    NvsApiSupport::json([
        'ok' => false,
        'system' => 'nvs-track-core',
        'version' => NvsApiSupport::CORE_VERSION,
        'collection' => 'server_metrics',
        'error' => 'server_metrics_failed',
        'message' => $e->getMessage(),
        'capabilities' => [
            'server_metrics' => true,
        ],
        'database' => [
            'connected' => false,
        ],
    ], 500);
}
