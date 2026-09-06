<?php

require_once __DIR__ . '/../../src/NvsApiSupport.php';
require_once __DIR__ . '/../../src/Logger.php';
require_once __DIR__ . '/../../src/WebhookRepairService.php';

NvsApiSupport::bootstrap(__DIR__ . '/../../.env');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    NvsApiSupport::json([
        'ok' => false,
        'error' => 'method_not_allowed',
        'message' => 'Use POST with JSON body.',
    ], 405);
}

$auth = NvsApiSupport::requireAuth();
$payload = json_decode((string) file_get_contents('php://input'), true);

if (!is_array($payload)) {
    NvsApiSupport::json([
        'ok' => false,
        'error' => 'invalid_json',
        'message' => json_last_error_msg(),
    ], 400);
}

$propertyId = EventRepository::normalizePropertyId($payload['property_id'] ?? null);
$repairs = is_array($payload['repairs'] ?? null) ? $payload['repairs'] : [];
$sendMeta = filter_var($payload['send_meta'] ?? false, FILTER_VALIDATE_BOOLEAN);

try {
    $summary = WebhookRepairService::reprocessOrphanPurchases($repairs, $propertyId, $sendMeta);

    Logger::write('webhook-reprocess', [
        'property_id' => $propertyId,
        'auth_mode' => $auth['mode'] ?? null,
        'requested' => $summary['requested'],
        'reprocessed' => $summary['reprocessed'],
        'already_target' => $summary['already_target'],
        'skipped' => $summary['skipped'],
        'send_meta' => $sendMeta,
        'meta_attempted' => $summary['meta_attempted'],
        'meta_accepted' => $summary['meta_accepted'],
        'meta_failed' => $summary['meta_failed'],
        'meta_already_successful' => $summary['meta_already_successful'],
        'meta_deliveries_created' => $summary['meta_deliveries_created'],
    ]);

    NvsApiSupport::json([
        'ok' => true,
        'collection' => 'webhook_reprocess',
        'property_id' => $propertyId,
        'send_meta' => $sendMeta,
        'summary' => $summary,
    ]);
} catch (InvalidArgumentException $e) {
    NvsApiSupport::json([
        'ok' => false,
        'error' => 'invalid_reprocess_request',
        'message' => $e->getMessage(),
    ], 422);
} catch (DomainException $e) {
    NvsApiSupport::json([
        'ok' => false,
        'error' => 'reprocess_not_allowed',
        'message' => $e->getMessage(),
    ], 409);
} catch (Throwable $e) {
    Logger::write('webhook-reprocess-error', [
        'property_id' => $propertyId,
        'error' => $e->getMessage(),
    ]);

    NvsApiSupport::json([
        'ok' => false,
        'error' => 'webhook_reprocess_failed',
        'message' => 'Could not reprocess the selected webhooks.',
    ], 500);
}
