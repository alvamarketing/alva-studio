<?php

class Database
{
    private static ?PDO $connection = null;

    public static function getConnection(): PDO
    {
        if (self::$connection instanceof PDO) {
            return self::$connection;
        }

        $host = self::envFirst(['DB_HOST', 'MYSQL_HOST']);
        $port = self::envFirst(['DB_PORT', 'MYSQL_PORT'], '3306');
        $database = self::envFirst(['DB_DATABASE', 'DB_NAME', 'MYSQL_DATABASE']);
        $username = self::envFirst(['DB_USERNAME', 'DB_USER', 'MYSQL_USER']);
        $password = self::envFirst(['DB_PASSWORD', 'DB_PASS', 'MYSQL_PASSWORD'], '');
        $charset = self::envFirst(['DB_CHARSET', 'MYSQL_CHARSET'], 'utf8mb4');

        if ($host === '' || $database === '' || $username === '') {
            throw new RuntimeException('Database credentials are missing in .env');
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $host,
            $port !== '' ? $port : '3306',
            $database,
            $charset !== '' ? $charset : 'utf8mb4'
        );

        self::$connection = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        return self::$connection;
    }

    public static function table(string $name): string
    {
        $prefix = self::envFirst(['DB_PREFIX', 'TABLE_PREFIX'], 'nvs_');

        if ($prefix === '') {
            $prefix = 'nvs_';
        }

        return $prefix . self::sanitizeTableName($name);
    }

    public static function reset(): void
    {
        self::$connection = null;
    }

    private static function envFirst(array $keys, string $default = ''): string
    {
        foreach ($keys as $key) {
            $value = null;

            if (class_exists('Env')) {
                $value = Env::get($key);
            }

            if ($value === null || $value === false || $value === '') {
                if (array_key_exists($key, $_ENV)) {
                    $value = $_ENV[$key];
                } elseif (array_key_exists($key, $_SERVER)) {
                    $value = $_SERVER[$key];
                } else {
                    $envValue = getenv($key);
                    $value = $envValue !== false ? $envValue : null;
                }
            }

            $value = self::normalizeEnvValue($value);

            if ($value !== '') {
                return $value;
            }
        }

        return $default;
    }

    private static function normalizeEnvValue($value): string
    {
        if ($value === null || $value === false) {
            return '';
        }

        $value = trim((string) $value);

        if ($value === '') {
            return '';
        }

        $first = $value[0];
        $last = substr($value, -1);

        if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
            $value = substr($value, 1, -1);
        }

        return trim($value);
    }

    private static function sanitizeTableName(string $name): string
    {
        $name = trim($name);

        if ($name === '') {
            throw new InvalidArgumentException('Table name cannot be empty.');
        }

        if (!preg_match('/^[a-zA-Z0-9_]+$/', $name)) {
            throw new InvalidArgumentException('Invalid table name.');
        }

        return $name;
    }
}
