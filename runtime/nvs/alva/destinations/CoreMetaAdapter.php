<?php
require_once __DIR__ . '/Contract.php';

final class CoreMetaAdapter extends AlvaHttpDestination
{
    public static function key(): string { return 'meta'; }
    public static function payload(array $event, array $credentials): array
    {
        return ['data' => [[
            'event_name' => $event['event_name'], 'event_time' => $event['event_time'], 'event_id' => $event['tracking_event_id'],
            'action_source' => 'website', 'user_data' => array_filter(['em' => $event['user']['email_sha256'] ?? null, 'ph' => $event['user']['phone_sha256'] ?? null, 'fbc' => $event['click_ids']['fbc'] ?? null, 'fbp' => $event['click_ids']['fbp'] ?? null]),
            'custom_data' => $event['params'],
        ]]];
    }
    public static function request(array $event, array $credentials): array
    {
        $pixel = trim((string) ($credentials['pixel_id'] ?? ''));
        $token = trim((string) ($credentials['access_token'] ?? ''));
        if ($pixel === '' || $token === '') throw new RuntimeException('destination_not_configured');
        return self::post('https://graph.facebook.com/v20.0/' . rawurlencode($pixel) . '/events', ['Authorization: Bearer ' . $token], self::payload($event, $credentials));
    }
}
