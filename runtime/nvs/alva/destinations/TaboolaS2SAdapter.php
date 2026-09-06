<?php
require_once __DIR__ . '/Contract.php';

final class TaboolaS2SAdapter extends AlvaHttpDestination
{
    public static function key(): string { return 'taboola'; }
    public static function payload(array $event, array $credentials): array { return []; }

    public static function request(array $event, array $credentials): array
    {
        $clickId = (string) ($event['click_ids']['taboola_click_id'] ?? '');
        if (!preg_match('/^[A-Za-z0-9._~-]{1,200}$/', $clickId)) throw new RuntimeException('destination_identifier_required');
        return self::get(
            'https://trc.taboola.com/actions-handler/log/3/s2s-action?click-id=' . rawurlencode($clickId) . '&name=' . rawurlencode($event['event_name'])
        );
    }
}
