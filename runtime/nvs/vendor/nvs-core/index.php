<?php
$key = $_GET['key'] ?? '';

if ($key) {
    header('Location: /nvs-track/dashboard.php?key=' . urlencode($key));
    exit;
}

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <title>NVS Track</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: Arial, sans-serif; background:#0f172a; color:#e5e7eb; padding:40px;">
    <h1>NVS Track</h1>
    <p>Node online.</p>
    <p>Para acessar o dashboard técnico, use:</p>
    <code>/nvs-track/?key=SUA_CHAVE_REAL</code>
</body>
</html>