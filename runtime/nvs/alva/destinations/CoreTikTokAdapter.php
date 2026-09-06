<?php
require_once __DIR__ . '/Contract.php';

final class CoreTikTokAdapter extends AlvaHttpDestination
{
    public static function key(): string { return 'tiktok'; }
    public static function payload(array $event, array $credentials): array
    {
        return ['event_source' => 'web', 'event_source_id' => $credentials['pixel_code'] ?? null, 'data' => [[
            'event' => $event['event_name'], 'event_time' => $event['event_time'], 'event_id' => $event['tracking_event_id'],
            'user' => array_filter(['email' => $event['user']['email_sha256'] ?? null, 'phone' => $event['user']['phone_sha256'] ?? null, 'ttclid' => $event['click_ids']['ttclid'] ?? null]),
            'properties' => $event['params'],
        ]]];
    }
    public static function request(array $event, array $credentials): array
    {
        if (empty($credentials['pixel_code']) || empty($credentials['access_token'])) throw new RuntimeException('destination_not_configured');
        return self::post('https://business-api.tiktok.com/open_api/v1.3/event/track/', ['Access-Token: ' . $credentials['access_token']], self::payload($event, $credentials));
    }
}
