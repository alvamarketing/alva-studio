<?php

declare(strict_types=1);

function fail(string $message): never { fwrite(STDERR, "FAIL: {$message}\n"); exit(1); }
function same($want, $got, string $message): void { if ($want !== $got) fail($message); }
function yes(bool $condition, string $message): void { if (!$condition) fail($message); }
function request(string $path, array $body, ?string $nonce = null, ?string $signature = null): array
{
    $json = json_encode($body, JSON_THROW_ON_ERROR); $timestamp = time(); $nonce ??= bin2hex(random_bytes(16)); $signature ??= hash_hmac('sha256', $timestamp . "\n" . $nonce . "\n" . $json, (string) getenv('NVS_INTERNAL_HMAC_SECRET'));
    $headers = "Content-Type: application/json\r\nX-NVS-Timestamp: {$timestamp}\r\nX-NVS-Nonce: {$nonce}\r\nX-NVS-Signature: {$signature}\r\n";
    $context = stream_context_create(['http' => ['method' => 'POST', 'header' => $headers, 'content' => $json, 'ignore_errors' => true]]); $raw = file_get_contents('http://127.0.0.1' . $path, false, $context); preg_match('/\s(\d{3})\s/', $http_response_header[0] ?? '', $match);
    return [(int) ($match[1] ?? 0), json_decode((string) $raw, true), $nonce, $signature];
}
function publicRequest(array $body): int
{
    $context = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => json_encode($body, JSON_THROW_ON_ERROR), 'ignore_errors' => true]]);
    file_get_contents('http://127.0.0.1/ingest.php', false, $context); preg_match('/\s(\d{3})\s/', $http_response_header[0] ?? '', $match); return (int) ($match[1] ?? 0);
}
function hasHeader(array $captured, string $header): bool
{
    foreach ($captured['headers'] ?? [] as $line) if (strcasecmp($line, $header) === 0) return true;
    return false;
}
function noClearPii(array $captured): void
{
    $serialized = json_encode($captured, JSON_THROW_ON_ERROR);
    foreach (['Person@Example.test', '+55', '203.0.113.9', 'forbidden-agent'] as $forbidden) if (str_contains($serialized, $forbidden)) fail('destination request retained clear PII, IP or user agent');
}

[$status] = request('/health/ready', []); same(200, $status, 'ready must require all checksummed migrations');
$destinations = [
    'meta' => ['pixel_id' => 'pixel-1', 'access_token' => 'test-meta'],
    'tiktok' => ['pixel_code' => 'pixel-code-1', 'access_token' => 'test-tiktok'],
    'google' => ['operating_account_id' => '123', 'conversion_action_id' => '9', 'oauth_access_token' => 'test-google'],
    'linkedin' => ['conversion_urn' => 'urn:lla:llaPartnerConversion:42', 'access_token' => 'test-linkedin', 'linkedin_version' => '202608'],
    'taboola' => [],
];
[$status, $body, $nonce, $signature] = request('/internal/v1/properties', ['property_id' => 'alpha', 'name' => 'Alpha', 'destinations' => $destinations]); same(201, $status, 'property must create atomically');
if (str_contains(json_encode($body), 'test-google')) fail('property response leaked secret');
[$status] = request('/internal/v1/properties', ['property_id' => 'alpha'], $nonce, $signature); same(401, $status, 'replay must have uniform rejection');
[$status] = request('/internal/v1/properties', ['property_id' => 'bravo', 'name' => 'Bravo']); same(201, $status, 'second property must be isolated');
foreach (['lead', 'initiate_checkout', 'purchase'] as $forged) same(400, publicRequest(['property_id' => 'alpha', 'tracking_event_id' => 'public-' . $forged, 'event_name' => $forged]), 'public ingest must reject forged commercial conversion');
same(202, publicRequest(['property_id' => 'alpha', 'tracking_event_id' => 'public-safe', 'event_name' => 'page_view']), 'public ingest must remain explicit and non-commercial');
$script = (string) file_get_contents('http://127.0.0.1/lib/nvs.js'); foreach (['page_url', 'referrer', 'provider_ids', 'nvs_uid', 'nvs_sid', 'useragent', 'ip_address'] as $forbidden) if (str_contains(strtolower($script), $forbidden)) fail('public wrapper retained forbidden browser data');

[$status] = request('/internal/v1/events', [
    'property_id' => 'alpha', 'tracking_event_id' => 'evt-alpha-1', 'event_name' => 'lead',
    'user' => ['email' => 'Person@Example.test ', 'phone' => '+55 (11) 99999-9999'],
    'params' => ['value' => 19.9, 'currency' => 'brl', 'transaction_id' => 'tx-alpha-1', 'gclid' => 'GCLID.alpha-1', 'linkedin_tracking_uuid' => 'li-track_1', 'taboola_click_id' => 'USER.CLICK_ID_EXAMPLE', 'wbraid' => 'https://forbidden.example/', 'email' => 'forbidden@example.test'],
    'context' => ['ip_address' => '203.0.113.9', 'user_agent' => 'forbidden-agent'],
]); same(202, $status, 'allowlisted commercial event must queue');
[$status] = request('/internal/v1/events', ['property_id' => 'alpha', 'tracking_event_id' => 'evt-alpha-1', 'event_name' => 'lead']); same(202, $status, 'duplicate event may retry safely');
[$status] = request('/internal/v1/events', ['property_id' => 'bravo', 'tracking_event_id' => 'evt-alpha-1', 'event_name' => 'lead']); same(202, $status, 'same event id in another property is independent');
[$status] = request('/internal/v1/events', ['property_id' => 'alpha', 'tracking_event_id' => 'evt-bad', 'event_name' => 'page_view']); same(422, $status, 'public browsing events are not accepted as commercial events');

$pdo = new PDO('mysql:host=' . getenv('NVS_MARIADB_HOST') . ';dbname=' . getenv('NVS_MARIADB_DATABASE') . ';charset=utf8mb4', (string) getenv('NVS_MARIADB_USER'), (string) getenv('NVS_MARIADB_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$secret = (string) $pdo->query("SELECT secret_ciphertext FROM nvs_property_secrets WHERE property_id='alpha' LIMIT 1")->fetchColumn(); if ($secret === '' || str_contains($secret, 'test-google')) fail('secret must use AES-GCM ciphertext');
$payload = (string) $pdo->query("SELECT payload_json FROM nvs_outbox WHERE property_id='alpha' AND tracking_event_id='evt-alpha-1' LIMIT 1")->fetchColumn(); foreach (['Person@Example.test', '203.0.113.9', 'forbidden-agent', '+55', 'https://forbidden.example'] as $forbidden) if (str_contains($payload, $forbidden)) fail('outbox retained forbidden input');
$event = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
same('GCLID.alpha-1', $event['click_ids']['gclid'] ?? null, 'sanitizer must preserve valid gclid');
yes(!isset($event['click_ids']['wbraid']), 'sanitizer must reject URL-shaped click identifiers');
same(5, (int) $pdo->query("SELECT COUNT(*) FROM nvs_outbox WHERE property_id='alpha' AND tracking_event_id='evt-alpha-1'")->fetchColumn(), 'outbox deduplication must include property event and destination');

require_once '/app/alva/bootstrap.php'; require_once '/app/alva/destinations/Registry.php';
putenv('NVS_OUTBOX_TEST_TRANSPORT=capture');
$captured = [];
foreach (AlvaNvs::DESTINATIONS as $destination) {
    $captured[$destination] = AlvaDestinationRegistry::get($destination)::request($event, $destinations[$destination]);
    noClearPii($captured[$destination]);
}
same('POST', $captured['google']['method'] ?? null, 'Google must POST Data Manager ingestion');
same('https://datamanager.googleapis.com/v1/events:ingest', $captured['google']['url'] ?? null, 'Google must use Data Manager v1 ingestion');
yes(hasHeader($captured['google'], 'Authorization: Bearer test-google'), 'Google must use OAuth authorization');
yes(hasHeader($captured['google'], 'Content-Type: application/json'), 'Google must declare JSON payload');
same('GOOGLE_ADS', $captured['google']['payload']['destinations'][0]['operatingAccount']['accountType'] ?? null, 'Google destination account type must be explicit');
same('9', $captured['google']['payload']['destinations'][0]['productDestinationId'] ?? null, 'Google destination must use conversion action ID');
same('GCLID.alpha-1', $captured['google']['payload']['events'][0]['adIdentifiers']['gclid'] ?? null, 'Google payload must retain gclid');
same('tx-alpha-1', $captured['google']['payload']['events'][0]['transactionId'] ?? null, 'Google payload must use transaction identity');
same('WEB', $captured['google']['payload']['events'][0]['eventSource'] ?? null, 'Google payload must declare WEB source');
same('HEX', $captured['google']['payload']['encoding'] ?? null, 'Google hashed identifiers must declare HEX encoding');
same($event['user']['email_sha256'], $captured['google']['payload']['events'][0]['userData']['userIdentifiers'][0]['emailAddress'] ?? null, 'Google must send only hashed email');

same('POST', $captured['linkedin']['method'] ?? null, 'LinkedIn must POST conversion events');
same('https://api.linkedin.com/rest/conversionEvents', $captured['linkedin']['url'] ?? null, 'LinkedIn must use official CAPI endpoint');
yes(hasHeader($captured['linkedin'], 'Linkedin-Version: 202608') && hasHeader($captured['linkedin'], 'X-Restli-Protocol-Version: 2.0.0'), 'LinkedIn must send version and Restli headers');
yes(hasHeader($captured['linkedin'], 'Content-Type: application/json'), 'LinkedIn must declare JSON payload');
same('urn:lla:llaPartnerConversion:42', $captured['linkedin']['payload']['conversion'] ?? null, 'LinkedIn must use conversion URN');
same($event['event_time'] * 1000, $captured['linkedin']['payload']['conversionHappenedAt'] ?? null, 'LinkedIn timestamp must be milliseconds');
same('SHA256_EMAIL', $captured['linkedin']['payload']['user']['userIds'][0]['idType'] ?? null, 'LinkedIn email must use typed SHA-256 ID');
same('LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', $captured['linkedin']['payload']['user']['userIds'][1]['idType'] ?? null, 'LinkedIn tracking ID must be typed');

same('GET', $captured['taboola']['method'] ?? null, 'Taboola S2S must use GET');
same('https://trc.taboola.com/actions-handler/log/3/s2s-action?click-id=USER.CLICK_ID_EXAMPLE&name=lead', $captured['taboola']['url'] ?? null, 'Taboola must use the fixed postback URL and click ID');
yes(array_key_exists('payload', $captured['taboola']) && $captured['taboola']['payload'] === null, 'Taboola must not send user payload');
same([], $captured['taboola']['headers'] ?? null, 'Taboola must not attach arbitrary credentials or headers');

same('POST', $captured['meta']['method'] ?? null, 'Meta must POST CAPI event');
same('https://graph.facebook.com/v20.0/pixel-1/events', $captured['meta']['url'] ?? null, 'Meta must use the pixel endpoint');
yes(hasHeader($captured['meta'], 'Authorization: Bearer test-meta'), 'Meta must authenticate its CAPI request');
yes(hasHeader($captured['meta'], 'Content-Type: application/json'), 'Meta must declare JSON payload');
same('lead', $captured['meta']['payload']['data'][0]['event_name'] ?? null, 'Meta must preserve commercial event name');
same($event['user']['email_sha256'], $captured['meta']['payload']['data'][0]['user_data']['em'] ?? null, 'Meta must send only hashed email');
same('POST', $captured['tiktok']['method'] ?? null, 'TikTok must POST Events API event');
same('https://business-api.tiktok.com/open_api/v1.3/event/track/', $captured['tiktok']['url'] ?? null, 'TikTok must use the Events API endpoint');
yes(hasHeader($captured['tiktok'], 'Access-Token: test-tiktok'), 'TikTok must authenticate its Events API request');
yes(hasHeader($captured['tiktok'], 'Content-Type: application/json'), 'TikTok must declare JSON payload');
same('lead', $captured['tiktok']['payload']['data'][0]['event'] ?? null, 'TikTok must preserve commercial event name');
same($event['user']['phone_sha256'], $captured['tiktok']['payload']['data'][0]['user']['phone'] ?? null, 'TikTok must send only hashed phone');

shell_exec('php /app/alva/bin/dispatch-outbox.php');
same(0, (int) $pdo->query("SELECT SUM(attempts) FROM nvs_outbox WHERE property_id='alpha' AND tracking_event_id='evt-alpha-1'")->fetchColumn(), 'disabled delivery must not churn attempts');

for ($i = 0; $i < 8; $i++) shell_exec('NVS_OUTBOX_DELIVERY_ENABLED=true NVS_OUTBOX_TEST_TRANSPORT=capture php /app/alva/bin/dispatch-outbox.php');
same(5, (int) $pdo->query("SELECT COUNT(*) FROM nvs_outbox WHERE property_id='alpha' AND tracking_event_id='evt-alpha-1' AND state='delivered'")->fetchColumn(), 'captured and asserted contracts may be marked delivered');

[$status] = request('/internal/v1/events', ['property_id' => 'alpha', 'tracking_event_id' => 'evt-alpha-fail', 'event_name' => 'purchase']); same(202, $status, 'retry fixture must enqueue');
$pdo->exec("UPDATE nvs_outbox SET state='delivered' WHERE tracking_event_id <> 'evt-alpha-fail'");
for ($i = 0; $i < 3; $i++) shell_exec('NVS_OUTBOX_DELIVERY_ENABLED=true NVS_OUTBOX_TEST_TRANSPORT=failure php /app/alva/bin/dispatch-outbox.php');
same('retry', (string) $pdo->query("SELECT state FROM nvs_outbox WHERE property_id='alpha' AND tracking_event_id='evt-alpha-fail' AND destination='google'")->fetchColumn(), 'local transport failure must schedule retry');

echo "PASS: NVS hardened integration\n";
