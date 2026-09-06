<?php
header('Content-Type: application/json; charset=utf-8');
try {
    $host = getenv('NVS_MARIADB_HOST');
    $database = getenv('NVS_MARIADB_DATABASE');
    $user = getenv('NVS_MARIADB_USER');
    $password = getenv('NVS_MARIADB_PASSWORD');
    if (!$host || !$database || !$user || $password === false) throw new RuntimeException('database configuration missing');
    $pdo = new PDO("mysql:host={$host};dbname={$database};charset=utf8mb4", $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_TIMEOUT => 2,
    ]);
    $pdo->query('SELECT 1');
    echo json_encode(['status' => 'ready', 'service' => 'nvs', 'capabilities' => []]);
} catch (Throwable $error) {
    http_response_code(503);
    echo json_encode(['status' => 'not_ready', 'service' => 'nvs', 'capabilities' => []]);
}
