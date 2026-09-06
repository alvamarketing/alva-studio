<?php
declare(strict_types=1);
require_once __DIR__ . '/../alva/bootstrap.php';
require_once __DIR__ . '/../alva/destinations/Registry.php';
function check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
putenv('NVS_OUTBOX_TEST_TRANSPORT=capture');
$credentials = ['meta' => ['pixel_id' => '1', 'access_token' => 'x'], 'google' => ['operating_account_id' => '1', 'conversion_action_id' => '2', 'oauth_access_token' => 'x'], 'tiktok' => ['pixel_code' => 'x', 'access_token' => 'x'], 'linkedin' => ['conversion_urn' => 'urn:lla:llaPartnerConversion:1', 'access_token' => 'x'], 'taboola' => []];
foreach (['pending', 'denied', 'granted'] as $state) {
  $event = AlvaSanitizer::event(['tracking_event_id' => 'evt-' . $state, 'event_name' => 'lead', 'consent_state' => $state, 'user' => ['email' => 'Pessoa@Example.test', 'phone' => '+55 11 99999-9999'], 'params' => ['fbc' => 'fbc', 'fbp' => 'fbp', 'gclid' => 'gclid', 'gbraid' => 'gbraid', 'wbraid' => 'wbraid', 'ttclid' => 'ttclid', 'li_fat_id' => 'li', 'tblci' => 'tb', 'unknown' => 'no']], 'property');
  check($event['consent_state'] === $state, 'state');
  if ($state === 'granted') check(isset($event['user']['email_sha256']), 'granted hash'); else check($event['user'] === [], 'no hash');
  foreach (AlvaNvs::DESTINATIONS as $destination) {
    $request = AlvaDestinationRegistry::get($destination)::request($event, $credentials[$destination]);
    $encoded = json_encode($request, JSON_THROW_ON_ERROR);
    check(!str_contains($encoded, 'Pessoa@Example'), 'clear pii'); check(!str_contains($encoded, 'unknown'), 'unknown field');
    if ($destination === 'google') check(($request['payload']['events'][0]['consent']['adUserData'] ?? null) === ($state === 'granted' ? 'GRANTED' : 'DENIED'), 'google consent');
  }
}
$canonical = AlvaSanitizer::event(['tracking_event_id' => 'evt-canonical', 'event_name' => 'lead', 'params' => ['linkedin_tracking_uuid' => 'li-canonical', 'taboola_click_id' => 'tb-canonical']], 'property');
check(($canonical['click_ids']['linkedin_tracking_uuid'] ?? null) === 'li-canonical', 'internal canonical LinkedIn click ID');
check(($canonical['click_ids']['taboola_click_id'] ?? null) === 'tb-canonical', 'internal canonical Taboola click ID');
$aliases = AlvaSanitizer::event(['tracking_event_id' => 'evt-aliases', 'event_name' => 'lead', 'params' => ['li_fat_id' => 'li-browser', 'tblci' => 'tb-browser']], 'property');
check(($aliases['click_ids']['linkedin_tracking_uuid'] ?? null) === 'li-browser', 'browser LinkedIn alias');
check(($aliases['click_ids']['taboola_click_id'] ?? null) === 'tb-browser', 'browser Taboola alias');
$rejected = AlvaSanitizer::event(['tracking_event_id' => 'evt-rejected', 'event_name' => 'lead', 'params' => ['unknown' => 'no', 'linkedin_tracking_uuid' => ['nested' => 'no'], 'taboola_click_id' => ['nested' => 'no']]], 'property');
check(!isset($rejected['click_ids']['linkedin_tracking_uuid']) && !isset($rejected['click_ids']['taboola_click_id']), 'unknown and nested click IDs rejected');
echo "PASS: consent policy\n";
