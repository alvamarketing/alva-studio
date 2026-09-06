<?php

require_once __DIR__ . '/Env.php';
require_once __DIR__ . '/Database.php';

class NvsApiSupport
{
    public const CORE_VERSION = '0.3.10';
    public const CONTRACT_VERSION = '1';
    public const VIEWER_TIMEZONE = 'America/Sao_Paulo';
    public const STORAGE_TIMEZONE = 'UTC';

    public static function bootstrap(string $envPath): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');

        Env::load($envPath);
    }

    public static function json(array $data, int $statusCode = 200): void
    {
        $data = array_merge([
            'ok' => $statusCode >= 200 && $statusCode < 400,
            'system' => 'nvs-track-core',
            'contract_version' => self::CONTRACT_VERSION,
            'core_version' => self::CORE_VERSION,
            'timezone' => self::VIEWER_TIMEZONE,
        ], $data);

        http_response_code($statusCode);
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        exit;
    }

    public static function requireAuth(): array
    {
        $auth = self::authenticate();

        if (empty($auth['ok'])) {
            self::json([
                'ok' => false,
                'system' => 'nvs-track-core',
                'error' => 'forbidden',
                'message' => 'Use a valid dashboard key or Authorization Bearer token.',
            ], 403);
        }

        return $auth;
    }

    public static function authenticate(): array
    {
        $dashboardKey = (string) Env::get('DASHBOARD_KEY', '');
        $viewerToken = (string) Env::get('NVS_VIEWER_API_TOKEN', '');

        $providedKey = trim((string) ($_GET['key'] ?? ''));
        $providedBearer = self::getBearerToken();

        if ($dashboardKey !== '' && $providedKey !== '' && hash_equals($dashboardKey, $providedKey)) {
            return [
                'ok' => true,
                'mode' => 'dashboard_key',
                'role' => 'admin',
            ];
        }

        if ($viewerToken !== '' && $providedBearer !== '' && hash_equals($viewerToken, $providedBearer)) {
            return [
                'ok' => true,
                'mode' => 'viewer_token',
                'role' => 'viewer',
            ];
        }

        return [
            'ok' => false,
            'mode' => 'none',
            'role' => 'none',
        ];
    }

    public static function getBearerToken(): string
    {
        $header = self::getAuthorizationHeader();

        if ($header === '' || stripos($header, 'Bearer ') !== 0) {
            return '';
        }

        return trim(substr($header, 7));
    }

    public static function getAuthorizationHeader(): string
    {
        if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
            return trim((string) $_SERVER['HTTP_AUTHORIZATION']);
        }

        if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            return trim((string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
        }

        if (function_exists('apache_request_headers')) {
            $headers = apache_request_headers();

            foreach ($headers as $name => $value) {
                if (strtolower((string) $name) === 'authorization') {
                    return trim((string) $value);
                }
            }
        }

        return '';
    }

    public static function q(string $identifier): string
    {
        return '`' . str_replace('`', '``', $identifier) . '`';
    }

    public static function tableExists(PDO $pdo, string $table): bool
    {
        try {
            $stmt = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table));
            return (bool) ($stmt ? $stmt->fetchColumn() : false);
        } catch (Throwable $e) {
            return false;
        }
    }

    public static function columnExists(PDO $pdo, string $table, string $column): bool
    {
        try {
            if (!self::tableExists($pdo, $table)) {
                return false;
            }

            $stmt = $pdo->query('SHOW COLUMNS FROM ' . self::q($table) . ' LIKE ' . $pdo->quote($column));
            return (bool) ($stmt ? $stmt->fetchColumn() : false);
        } catch (Throwable $e) {
            return false;
        }
    }

    public static function getColumns(PDO $pdo, string $table): array
    {
        try {
            if (!self::tableExists($pdo, $table)) {
                return [];
            }

            $stmt = $pdo->query('SHOW COLUMNS FROM ' . self::q($table));
            $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];

            return array_map(function (array $row): string {
                return (string) ($row['Field'] ?? '');
            }, $rows);
        } catch (Throwable $e) {
            return [];
        }
    }

    public static function cleanDate($value): string
    {
        $value = trim((string) $value);

        if ($value === '') {
            return '';
        }

        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return '';
        }

        return $value;
    }

    public static function cleanText($value, int $max = 190): string
    {
        $value = trim((string) $value);

        if ($value === '') {
            return '';
        }

        if (function_exists('mb_substr')) {
            return mb_substr($value, 0, $max, 'UTF-8');
        }

        return substr($value, 0, $max);
    }

    public static function eventNameVariants(string $value): array
    {
        $value = trim($value);

        if ($value === '') {
            return [];
        }

        $compact = strtolower(str_replace(['_', '-', ' '], '', $value));
        $known = [
            'pageview' => ['page_view', 'pageview', 'PageView'],
            'viewcontent' => ['view_content', 'viewcontent', 'ViewContent'],
            'initiatecheckout' => ['initiate_checkout', 'initiatecheckout', 'InitiateCheckout'],
            'addtocart' => ['add_to_cart', 'addtocart', 'AddToCart'],
            'purchase' => ['purchase', 'Purchase'],
            'lead' => ['lead', 'Lead'],
        ];

        return array_values(array_unique($known[$compact] ?? [$value]));
    }

    public static function propertyVariants(string $propertyId): array
    {
        $propertyId = self::cleanText($propertyId, 120);

        if ($propertyId === '') {
            return [];
        }

        return array_values(array_unique(array_filter([
            $propertyId,
            str_replace('-', '_', $propertyId),
            str_replace('_', '-', $propertyId),
        ])));
    }

    public static function positiveInt($value, int $default, int $min = 1, int $max = 500): int
    {
        $int = (int) $value;

        if ($int < $min) {
            return $default;
        }

        if ($int > $max) {
            return $max;
        }

        return $int;
    }

    public static function pagination(): array
    {
        $limit = self::positiveInt($_GET['limit'] ?? 100, 100, 1, 500);
        $page = self::positiveInt($_GET['page'] ?? 1, 1, 1, 1000000);
        $offset = ($page - 1) * $limit;

        return [
            'page' => $page,
            'limit' => $limit,
            'offset' => $offset,
        ];
    }

    public static function dateWhere(string $alias, string $column, string $dateFrom, string $dateTo, array &$params, string $prefix = 'date'): array
    {
        $where = [];
        $qualified = $alias !== '' ? self::q($alias) . '.' . self::q($column) : self::q($column);
        $bounds = self::dateBounds($dateFrom, $dateTo);

        if ($bounds['from'] !== '') {
            $key = ':' . $prefix . '_from';
            $where[] = $qualified . ' >= ' . $key;
            $params[$key] = $bounds['from'];
        }

        if ($bounds['to_exclusive'] !== '') {
            $key = ':' . $prefix . '_to';
            $where[] = $qualified . ' < ' . $key;
            $params[$key] = $bounds['to_exclusive'];
        }

        return $where;
    }

    public static function dateBounds(string $dateFrom, string $dateTo): array
    {
        return [
            'from' => self::convertLocalDateBoundary($dateFrom, false),
            'to_exclusive' => self::convertLocalDateBoundary($dateTo, true),
        ];
    }

    private static function convertLocalDateBoundary(string $date, bool $nextDay): string
    {
        if ($date === '') {
            return '';
        }

        try {
            $viewerTimezone = new DateTimeZone(self::VIEWER_TIMEZONE);
            $storageTimezone = new DateTimeZone(self::STORAGE_TIMEZONE);
            $boundary = new DateTimeImmutable($date . ' 00:00:00', $viewerTimezone);

            if ($nextDay) {
                $boundary = $boundary->modify('+1 day');
            }

            return $boundary->setTimezone($storageTimezone)->format('Y-m-d H:i:s');
        } catch (Throwable $e) {
            return '';
        }
    }

    public static function propertyWhere(PDO $pdo, string $table, string $alias, string $propertyId, array &$params, array $jsonColumns = [], string $paramPrefix = 'property'): array
    {
        $variants = self::propertyVariants($propertyId);

        if (!$variants) {
            return [];
        }

        $parts = [];
        $placeholders = [];

        foreach ($variants as $i => $variant) {
            $key = ':' . $paramPrefix . '_' . $i;
            $params[$key] = $variant;
            $placeholders[] = $key;
        }

        if (self::columnExists($pdo, $table, 'property_id')) {
            $qualified = $alias !== '' ? self::q($alias) . '.`property_id`' : '`property_id`';
            $parts[] = $qualified . ' IN (' . implode(', ', $placeholders) . ')';
        }

        foreach ($jsonColumns as $index => $column) {
            if (!self::columnExists($pdo, $table, $column)) {
                continue;
            }

            foreach ($variants as $variantIndex => $variant) {
                $key = ':' . $paramPrefix . '_json_' . $index . '_' . $variantIndex;
                $qualified = $alias !== '' ? self::q($alias) . '.' . self::q($column) : self::q($column);
                $parts[] = $qualified . ' LIKE ' . $key;
                $params[$key] = '%' . $variant . '%';
            }
        }

        return $parts ? ['(' . implode(' OR ', $parts) . ')'] : [];
    }

    public static function likeWhere(string $qualifiedColumn, string $value, array &$params, string $param): array
    {
        $value = trim($value);

        if ($value === '') {
            return [];
        }

        $key = ':' . $param;
        $params[$key] = '%' . $value . '%';

        return [$qualifiedColumn . ' LIKE ' . $key];
    }

    public static function decodeJson($value)
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_array($value)) {
            return $value;
        }

        $decoded = json_decode((string) $value, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            return null;
        }

        return $decoded;
    }

    public static function decodeFields(array $row, array $fields): array
    {
        foreach ($fields as $field) {
            if (!array_key_exists($field, $row)) {
                continue;
            }

            $row[$field . '_decoded'] = self::maskSensitive(self::decodeJson($row[$field]));
        }

        return $row;
    }

    public static function maskSensitive($data)
    {
        if (!is_array($data)) {
            return $data;
        }

        $masked = [];

        foreach ($data as $key => $value) {
            $lowerKey = strtolower((string) $key);
            $isSensitive = (
                strpos($lowerKey, 'token') !== false
                || strpos($lowerKey, 'secret') !== false
                || strpos($lowerKey, 'password') !== false
                || strpos($lowerKey, 'authorization') !== false
                || strpos($lowerKey, 'access_token') !== false
            );

            if ($isSensitive && is_scalar($value)) {
                $masked[$key] = self::maskValue((string) $value);
                continue;
            }

            $masked[$key] = is_array($value) ? self::maskSensitive($value) : $value;
        }

        return $masked;
    }

    public static function maskValue(string $value): string
    {
        $value = trim($value);

        if ($value === '') {
            return '';
        }

        if (strlen($value) <= 8) {
            return '********';
        }

        return substr($value, 0, 4) . '********' . substr($value, -4);
    }

    public static function firstNestedValue($data, array $keys)
    {
        if (!is_array($data)) {
            return null;
        }

        foreach ($keys as $key) {
            if (array_key_exists($key, $data) && $data[$key] !== null && $data[$key] !== '') {
                return $data[$key];
            }
        }

        foreach ($data as $value) {
            if (is_array($value)) {
                $found = self::firstNestedValue($value, $keys);

                if ($found !== null && $found !== '') {
                    return $found;
                }
            }
        }

        return null;
    }

    public static function orderColumn(PDO $pdo, string $table, array $preferred = ['created_at', 'last_seen_at', 'updated_at', 'id']): string
    {
        foreach ($preferred as $column) {
            if (self::columnExists($pdo, $table, $column)) {
                return $column;
            }
        }

        return 'id';
    }

    public static function countWithSql(PDO $pdo, string $fromSql, array $where, array $params): int
    {
        try {
            $sql = 'SELECT COUNT(*) FROM ' . $fromSql . ' ' . ($where ? 'WHERE ' . implode(' AND ', $where) : '');
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            return (int) $stmt->fetchColumn();
        } catch (Throwable $e) {
            return 0;
        }
    }
}
