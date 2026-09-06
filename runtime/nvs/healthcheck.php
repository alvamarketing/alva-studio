<?php
$body = @file_get_contents('http://127.0.0.1/health/ready');
$payload = json_decode((string) $body, true);
exit(is_array($payload) && ($payload['status'] ?? null) === 'ready' ? 0 : 1);
