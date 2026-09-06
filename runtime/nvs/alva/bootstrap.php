<?php

declare(strict_types=1);

final class AlvaNvs
{
    public const DESTINATIONS = ['meta', 'tiktok', 'google', 'linkedin', 'taboola'];
    public const COMMERCIAL_EVENTS = ['lead', 'initiate_checkout', 'purchase', 'vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click'];

    public static function pdo(): PDO
    {
        static $pdo;
        if ($pdo instanceof PDO) return $pdo;
        $host = self::env('NVS_MARIADB_HOST'); $db = self::env('NVS_MARIADB_DATABASE'); $user = self::env('NVS_MARIADB_USER'); $pass = self::env('NVS_MARIADB_PASSWORD');
        if ($host === '' || $db === '' || $user === '' || $pass === '') throw new RuntimeException('database_unavailable');
        $pdo = new PDO("mysql:host={$host};dbname={$db};charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
        return $pdo;
    }
    public static function env(string $key): string { $value = getenv($key); return $value === false ? '' : trim((string) $value); }
    public static function propertyId($value): string { $value = strtolower(trim((string) $value)); if (!preg_match('/^[a-z0-9][a-z0-9_]{0,99}$/', $value)) throw new InvalidArgumentException('invalid_property_id'); return $value; }
    public static function key(): string { $value = self::env('NVS_PROPERTY_SECRETS_KEY'); if (!preg_match('/^[a-f0-9]{64}$/i', $value)) throw new RuntimeException('secret_key_unavailable'); return hex2bin($value); }
    public static function encrypt(array $value, string $aad): string
    {
        $nonce = random_bytes(12); $tag = ''; $cipher = openssl_encrypt(json_encode($value, JSON_THROW_ON_ERROR), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $nonce, $tag, $aad);
        if ($cipher === false) throw new RuntimeException('encryption_failed');
        return 'v1:' . base64_encode($nonce . $tag . $cipher);
    }
    public static function decrypt(string $value, string $aad): array
    {
        if (!str_starts_with($value, 'v1:')) throw new RuntimeException('invalid_ciphertext');
        $raw = base64_decode(substr($value, 3), true); if ($raw === false || strlen($raw) < 29) throw new RuntimeException('invalid_ciphertext');
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16), $aad);
        if ($plain === false) throw new RuntimeException('invalid_ciphertext');
        $decoded = json_decode($plain, true, 512, JSON_THROW_ON_ERROR); if (!is_array($decoded)) throw new RuntimeException('invalid_ciphertext'); return $decoded;
    }
    public static function response(int $status, array $body): never { http_response_code($status); header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store'); echo json_encode($body, JSON_UNESCAPED_SLASHES); exit; }
}

final class AlvaMigrator
{
    private static function migrations(): array { return require __DIR__ . '/migrations/migrations.php'; }
    public static function migrate(): void
    {
        $pdo = AlvaNvs::pdo();
        $pdo->exec('CREATE TABLE IF NOT EXISTS nvs_schema_migrations (version VARCHAR(100) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        foreach (self::migrations() as $version => $migration) {
            $checksum = hash('sha256', json_encode($migration['statements'], JSON_THROW_ON_ERROR));
            $read = $pdo->prepare('SELECT checksum FROM nvs_schema_migrations WHERE version = ?'); $read->execute([$version]); $stored = $read->fetchColumn();
            if ($stored !== false) { if (!hash_equals((string) $stored, $checksum)) throw new RuntimeException('migration_checksum_mismatch'); continue; }
            foreach ($migration['statements'] as $statement) $pdo->exec($statement);
            $pdo->prepare('INSERT INTO nvs_schema_migrations (version, checksum) VALUES (?, ?)')->execute([$version, $checksum]);
        }
    }
    public static function ready(): bool
    {
        try {
            $pdo = AlvaNvs::pdo(); $required = ['nvs_properties', 'nvs_events', 'nvs_outbox', 'nvs_property_secrets', 'nvs_internal_nonces'];
            foreach ($required as $table) { $check = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table)); if (!$check || !$check->fetchColumn()) return false; }
            foreach (self::migrations() as $version => $migration) { $expected = hash('sha256', json_encode($migration['statements'], JSON_THROW_ON_ERROR)); $read = $pdo->prepare('SELECT checksum FROM nvs_schema_migrations WHERE version = ?'); $read->execute([$version]); if (!hash_equals($expected, (string) $read->fetchColumn())) return false; }
            return true;
        } catch (Throwable) { return false; }
    }
}

final class AlvaAuthenticator
{
    public static function verify(string $raw): bool
    {
        $secret = AlvaNvs::env('NVS_INTERNAL_HMAC_SECRET'); $timestamp = $_SERVER['HTTP_X_NVS_TIMESTAMP'] ?? ''; $nonce = $_SERVER['HTTP_X_NVS_NONCE'] ?? ''; $signature = $_SERVER['HTTP_X_NVS_SIGNATURE'] ?? '';
        if (!preg_match('/^[a-f0-9]{64,128}$/i', $secret) || !ctype_digit((string) $timestamp) || !preg_match('/^[a-f0-9]{32,128}$/i', (string) $nonce) || !preg_match('/^[a-f0-9]{64}$/i', (string) $signature)) return false;
        if (abs(time() - (int) $timestamp) > 300 || strlen($raw) > 16384) return false;
        if (!hash_equals(hash_hmac('sha256', $timestamp . "\n" . $nonce . "\n" . $raw, $secret), $signature)) return false;
        try { $pdo = AlvaNvs::pdo(); $pdo->prepare('DELETE FROM nvs_internal_nonces WHERE expires_at < UTC_TIMESTAMP()')->execute(); $pdo->prepare('INSERT INTO nvs_internal_nonces (nonce_hash, expires_at) VALUES (?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))')->execute([hash('sha256', $nonce)]); return true; } catch (PDOException) { return false; }
    }
}

final class AlvaSanitizer
{
    public static function hashEmail($email): ?string { $email = strtolower(trim((string) $email)); return filter_var($email, FILTER_VALIDATE_EMAIL) ? hash('sha256', $email) : null; }
    public static function hashPhone($phone): ?string { $phone = preg_replace('/\D+/', '', (string) $phone); return strlen($phone) >= 8 && strlen($phone) <= 15 ? hash('sha256', $phone) : null; }
    private static function suppliedHash($value): ?string { $value = strtolower(trim((string) $value)); return preg_match('/^[a-f0-9]{64}$/', $value) ? $value : null; }
    private static function clickIds(array $params): array
    {
        $safe = [];
        foreach (['gclid', 'gbraid', 'wbraid', 'linkedin_tracking_uuid', 'taboola_click_id'] as $key) {
            $value = trim((string) ($params[$key] ?? ''));
            if ($value !== '' && preg_match('/^[A-Za-z0-9._~-]{1,200}$/', $value)) $safe[$key] = $value;
        }
        return $safe;
    }
    public static function event(array $body, string $propertyId): array
    {
        $id = trim((string) ($body['tracking_event_id'] ?? '')); $name = strtolower(trim((string) ($body['event_name'] ?? '')));
        if (!preg_match('/^[A-Za-z0-9_.:-]{1,190}$/', $id)) throw new InvalidArgumentException('invalid_tracking_event_id');
        if (!in_array($name, AlvaNvs::COMMERCIAL_EVENTS, true)) throw new InvalidArgumentException('event_not_allowed');
        $user = is_array($body['user'] ?? null) ? $body['user'] : []; $params = is_array($body['params'] ?? null) ? $body['params'] : [];
        $safeParams = [];
        if (isset($params['value']) && is_numeric($params['value']) && is_finite((float) $params['value'])) $safeParams['value'] = (float) $params['value'];
        if (isset($params['currency']) && preg_match('/^[A-Za-z]{3}$/', (string) $params['currency'])) $safeParams['currency'] = strtoupper((string) $params['currency']);
        foreach (['transaction_id', 'content_id'] as $key) if (isset($params[$key]) && is_string($params[$key]) && preg_match('/^[A-Za-z0-9_.:-]{1,190}$/', $params[$key])) $safeParams[$key] = $params[$key];
        return ['property_id' => $propertyId, 'tracking_event_id' => $id, 'event_name' => $name, 'event_time' => isset($body['event_time']) ? (int) $body['event_time'] : time(), 'user' => array_filter(['email_sha256' => self::suppliedHash($user['email_sha256'] ?? null) ?? self::hashEmail($user['email'] ?? null), 'phone_sha256' => self::suppliedHash($user['phone_sha256'] ?? null) ?? self::hashPhone($user['phone'] ?? null)]), 'click_ids' => self::clickIds($params), 'params' => $safeParams];
    }
    public static function publicEvent(array $body, string $propertyId): array
    {
        $id = trim((string) ($body['tracking_event_id'] ?? '')); $name = strtolower(trim((string) ($body['event_name'] ?? '')));
        if (!preg_match('/^[A-Za-z0-9_.:-]{1,190}$/', $id) || !in_array($name, ['page_view', 'vsl_progress'], true)) throw new InvalidArgumentException('invalid_public_event');
        $params = is_array($body['params'] ?? null) ? $body['params'] : []; $safe = [];
        if ($name === 'vsl_progress' && isset($params['progress']) && is_numeric($params['progress'])) $safe['progress'] = max(0, min(100, (float) $params['progress']));
        return ['property_id' => $propertyId, 'tracking_event_id' => $id, 'event_name' => $name, 'event_time' => time(), 'user' => [], 'params' => $safe];
    }
}

final class AlvaOutbox
{
    public static function enqueue(array $event, string $source): void
    {
        $pdo = AlvaNvs::pdo(); $pdo->beginTransaction();
        try {
            $eventJson = json_encode($event, JSON_THROW_ON_ERROR); $pdo->prepare('INSERT INTO nvs_events (property_id, event_id, event_name, source, event_time, event_json) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE event_json = VALUES(event_json), updated_at = CURRENT_TIMESTAMP')->execute([$event['property_id'], $event['tracking_event_id'], $event['event_name'], $source, $event['event_time'], $eventJson]);
            $outbox = $pdo->prepare('INSERT INTO nvs_outbox (property_id, tracking_event_id, destination, payload_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id'); foreach (AlvaNvs::DESTINATIONS as $destination) $outbox->execute([$event['property_id'], $event['tracking_event_id'], $destination, $eventJson]);
            $pdo->commit();
        } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    }
    public static function recordPublic(array $event): void
    {
        AlvaNvs::pdo()->prepare('INSERT INTO nvs_events (property_id, event_id, event_name, source, event_time, event_json) VALUES (?, ?, ?, "public", ?, ?) ON DUPLICATE KEY UPDATE event_json = VALUES(event_json), updated_at = CURRENT_TIMESTAMP')->execute([$event['property_id'], $event['tracking_event_id'], $event['event_name'], $event['event_time'], json_encode($event, JSON_THROW_ON_ERROR)]);
    }
    public static function processOne(): bool
    {
        if (AlvaNvs::env('NVS_OUTBOX_DELIVERY_ENABLED') !== 'true') return false;
        $pdo = AlvaNvs::pdo(); $pdo->beginTransaction();
        try {
            $row = $pdo->query("SELECT * FROM nvs_outbox WHERE state IN ('queued', 'retry') AND available_at <= UTC_TIMESTAMP() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED")->fetch(); if (!$row) { $pdo->commit(); return false; }
            $get = $pdo->prepare('SELECT secret_ciphertext FROM nvs_property_secrets WHERE property_id = ? AND destination = ?'); $get->execute([$row['property_id'], $row['destination']]); $cipher = $get->fetchColumn();
            if (!is_string($cipher) || $cipher === '') { $pdo->prepare("UPDATE nvs_outbox SET state = 'retry', attempts = attempts + 1, available_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 MINUTE), last_error = 'not_configured' WHERE id = ?")->execute([$row['id']]); $pdo->commit(); return true; }
            require_once __DIR__ . '/destinations/Registry.php'; $adapter = AlvaDestinationRegistry::get((string) $row['destination']); $event = json_decode((string) $row['payload_json'], true, 512, JSON_THROW_ON_ERROR);
            try { $adapter::request($event, AlvaNvs::decrypt($cipher, $row['property_id'] . ':' . $row['destination'])); $pdo->prepare("UPDATE nvs_outbox SET state = 'delivered', attempts = attempts + 1, delivered_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ?")->execute([$row['id']]); }
            catch (RuntimeException) { $pdo->prepare("UPDATE nvs_outbox SET state = 'retry', attempts = attempts + 1, available_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 MINUTE), last_error = 'delivery_failed' WHERE id = ?")->execute([$row['id']]); }
            $pdo->commit(); return true;
        } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
    }
}

final class AlvaInternalApi
{
    public static function handle(string $path): never
    {
        $raw = file_get_contents('php://input'); $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || $type !== 'application/json' || $raw === false || !AlvaAuthenticator::verify($raw)) AlvaNvs::response(401, ['error' => 'unauthorized']);
        try { $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR); if (!is_array($body)) throw new JsonException(); } catch (Throwable) { AlvaNvs::response(400, ['error' => 'invalid_request']); }
        try { if ($path === '/internal/v1/properties') self::property($body); if ($path === '/internal/v1/events') self::event($body); if ($path === '/internal/v1/status') self::status($body); } catch (InvalidArgumentException $e) { AlvaNvs::response(422, ['error' => $e->getMessage()]); } catch (Throwable) { AlvaNvs::response(503, ['error' => 'service_unavailable']); }
        AlvaNvs::response(404, ['error' => 'not_found']);
    }
    private static function property(array $body): never
    {
        $id = AlvaNvs::propertyId($body['property_id'] ?? null); $name = trim((string) ($body['name'] ?? $id)); if ($name === '') throw new InvalidArgumentException('invalid_name'); $destinations = (array) ($body['destinations'] ?? []);
        foreach ($destinations as $destination => $credentials) if (!in_array($destination, AlvaNvs::DESTINATIONS, true) || !is_array($credentials)) throw new InvalidArgumentException('invalid_destination');
        $pdo = AlvaNvs::pdo(); $pdo->beginTransaction();
        try { $pdo->prepare('INSERT INTO nvs_properties (property_id, name, cookie_prefix, is_active) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = CURRENT_TIMESTAMP')->execute([$id, $name, 'nvs_' . $id]); $write = $pdo->prepare('INSERT INTO nvs_property_secrets (property_id, destination, secret_ciphertext) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE secret_ciphertext = VALUES(secret_ciphertext), updated_at = CURRENT_TIMESTAMP'); foreach ($destinations as $destination => $credentials) $write->execute([$id, $destination, AlvaNvs::encrypt($credentials, $id . ':' . $destination)]); $pdo->commit(); }
        catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
        AlvaNvs::response(201, ['property' => ['property_id' => $id, 'name' => $name, 'destinations' => array_keys($destinations)]]);
    }
    private static function event(array $body): never { $id = AlvaNvs::propertyId($body['property_id'] ?? null); AlvaOutbox::enqueue(AlvaSanitizer::event($body, $id), 'internal'); AlvaNvs::response(202, ['property_id' => $id, 'tracking_event_id' => $body['tracking_event_id'], 'status' => 'queued']); }
    private static function status(array $body): never { $id = AlvaNvs::propertyId($body['property_id'] ?? null); $stmt = AlvaNvs::pdo()->prepare('SELECT state, COUNT(*) total FROM nvs_outbox WHERE property_id = ? GROUP BY state'); $stmt->execute([$id]); $counts = ['queued' => 0, 'retry' => 0, 'delivered' => 0]; foreach ($stmt->fetchAll() as $row) $counts[$row['state']] = (int) $row['total']; AlvaNvs::response(200, ['property_id' => $id, 'outbox' => $counts]); }
}

final class AlvaPublicIngest
{
    public static function handle(): never
    {
        $raw = file_get_contents('php://input'); $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !in_array($type, ['application/json', 'text/plain'], true) || $raw === false || strlen($raw) > 16384) AlvaNvs::response(400, ['error' => 'invalid_event']);
        try { $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR); if (!is_array($body)) throw new JsonException(); $id = AlvaNvs::propertyId($body['property_id'] ?? null); $active = AlvaNvs::pdo()->prepare('SELECT 1 FROM nvs_properties WHERE property_id = ? AND is_active = 1'); $active->execute([$id]); if (!$active->fetchColumn()) throw new InvalidArgumentException(); AlvaOutbox::recordPublic(AlvaSanitizer::publicEvent($body, $id)); AlvaNvs::response(202, ['status' => 'accepted']); }
        catch (Throwable) { AlvaNvs::response(400, ['error' => 'invalid_event']); }
    }
}
