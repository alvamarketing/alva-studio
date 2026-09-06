<?php

require_once __DIR__ . '/Env.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Logger.php';

class Settings {
    private static array $cache = [];
    private static bool $loaded = false;

    public static function get(string $key, ?string $default = null): ?string {
        self::load();

        if (array_key_exists($key, self::$cache)) {
            return self::$cache[$key];
        }

        $envKey = self::settingKeyToEnvKey($key);

        return Env::get($envKey, $default);
    }

    public static function getBool(string $key, bool $default = false): bool {
        $value = self::get($key);

        if ($value === null) {
            return $default;
        }

        $value = strtolower(trim((string) $value));

        return in_array($value, ['1', 'true', 'yes', 'on'], true);
    }

    public static function set(
        string $key,
        ?string $value,
        string $type = 'string',
        bool $isSecret = false,
        ?string $description = null
    ): bool {
        try {
            $pdo = Database::getConnection();
            $table = Database::table('settings');

            $stmt = $pdo->prepare("
                INSERT INTO {$table} (
                    setting_key,
                    setting_value,
                    setting_type,
                    is_secret,
                    description
                ) VALUES (
                    :setting_key,
                    :setting_value,
                    :setting_type,
                    :is_secret,
                    :description
                )
                ON DUPLICATE KEY UPDATE
                    setting_value = VALUES(setting_value),
                    setting_type = VALUES(setting_type),
                    is_secret = VALUES(is_secret),
                    description = COALESCE(VALUES(description), description)
            ");

            $stmt->execute([
                ':setting_key' => $key,
                ':setting_value' => $value,
                ':setting_type' => $type,
                ':is_secret' => $isSecret ? 1 : 0,
                ':description' => $description,
            ]);

            self::$cache[$key] = $value;
            self::$loaded = true;

            return true;

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'Settings::set',
                'setting_key' => $key,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    public static function all(bool $includeSecrets = false): array {
        self::load();

        try {
            $pdo = Database::getConnection();
            $table = Database::table('settings');

            $stmt = $pdo->query("
                SELECT
                    setting_key,
                    setting_value,
                    setting_type,
                    is_secret,
                    description,
                    updated_at
                FROM {$table}
                ORDER BY setting_key ASC
            ");

            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($rows as &$row) {
                $row['is_secret'] = (bool) $row['is_secret'];

                if ($row['is_secret'] && !$includeSecrets) {
                    $row['setting_value'] = self::maskSecret($row['setting_value']);
                    $row['masked'] = true;
                } else {
                    $row['masked'] = false;
                }
            }

            return $rows;

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'Settings::all',
                'error' => $e->getMessage(),
            ]);

            return [];
        }
    }

    private static function load(): void {
        if (self::$loaded) {
            return;
        }

        self::$cache = [];

        try {
            $pdo = Database::getConnection();
            $table = Database::table('settings');

            $stmt = $pdo->query("
                SELECT setting_key, setting_value
                FROM {$table}
            ");

            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($rows as $row) {
                self::$cache[$row['setting_key']] = $row['setting_value'];
            }

        } catch (Throwable $e) {
            Logger::write('db-error', [
                'operation' => 'Settings::load',
                'error' => $e->getMessage(),
            ]);
        }

        self::$loaded = true;
    }

    private static function settingKeyToEnvKey(string $key): string {
        $map = [
            'meta_pixel_id' => 'META_PIXEL_ID',
            'meta_access_token' => 'META_ACCESS_TOKEN',
            'meta_test_event_code' => 'META_TEST_EVENT_CODE',
            'meta_api_version' => 'META_API_VERSION',
            'debug_mode' => 'DEBUG_MODE',
        ];

        return $map[$key] ?? strtoupper($key);
    }

    private static function maskSecret(?string $value): ?string {
        if ($value === null || $value === '') {
            return null;
        }

        $length = strlen($value);

        if ($length <= 8) {
            return str_repeat('*', $length);
        }

        return substr($value, 0, 4) . str_repeat('*', max(4, $length - 8)) . substr($value, -4);
    }
}