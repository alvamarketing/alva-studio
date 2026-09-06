<?php
http_response_code(404);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['error' => 'NVS Core ainda não foi incorporado neste runtime.']);
