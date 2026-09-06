<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/health/live') {
    require __DIR__ . '/health/live/index.php';
    return;
}
if ($path === '/health/ready') {
    require __DIR__ . '/health/ready/index.php';
    return;
}
require __DIR__ . '/index.php';
