<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

if ($path === '/health/live') {
    require __DIR__ . '/health/live/index.php';
    return;
}
if ($path === '/health/ready') {
    require __DIR__ . '/health/ready/index.php';
    return;
}
if (in_array($path, ['/internal/v1/properties', '/internal/v1/events', '/internal/v1/status'], true)) {
    require_once '/app/alva/bootstrap.php';
    AlvaInternalApi::handle($path);
}

if ($path === '/ingest.php') {
    require_once '/app/alva/bootstrap.php';
    AlvaPublicIngest::handle();
}

if ($path === '/lib/nvs.js') {
    header('Content-Type: application/javascript; charset=utf-8');
    readfile(__DIR__ . '/lib/nvs.js');
    return;
}

http_response_code(404);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['error' => 'not_found']);
