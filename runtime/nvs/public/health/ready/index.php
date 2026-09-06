<?php
require_once '/app/alva/bootstrap.php';
if (!AlvaMigrator::ready()) {
    AlvaNvs::response(503, ['status' => 'not_ready', 'service' => 'nvs', 'capabilities' => []]);
}
AlvaNvs::response(200, ['status' => 'ready', 'service' => 'nvs', 'core_version' => '0.3.10', 'contract_version' => 1, 'capabilities' => ['core', 'internal_api', 'outbox']]);
