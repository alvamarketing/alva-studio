<?php
require_once __DIR__ . '/Contract.php';

final class GoogleEnhancedConversionsAdapter extends AlvaHttpDestination
{
    public static function key(): string { return 'google'; }

    public static function payload(array $event, array $credentials): array
    {
        $adIdentifiers = array_filter([
            'gclid' => $event['click_ids']['gclid'] ?? null,
            'gbraid' => $event['click_ids']['gbraid'] ?? null,
            'wbraid' => $event['click_ids']['wbraid'] ?? null,
        ]);
        $userIdentifiers = array_values(array_filter([
            isset($event['user']['email_sha256']) ? ['emailAddress' => $event['user']['email_sha256']] : null,
            isset($event['user']['phone_sha256']) ? ['phoneNumber' => $event['user']['phone_sha256']] : null,
        ]));
        if ($adIdentifiers === [] && $userIdentifiers === []) throw new RuntimeException('destination_identifier_required');

        $conversion = [
            'transactionId' => $event['params']['transaction_id'] ?? $event['tracking_event_id'],
            'eventTimestamp' => gmdate('Y-m-d\TH:i:s\Z', (int) $event['event_time']),
            'eventSource' => 'WEB',
            'eventName' => $event['event_name'],
            'consent' => ['adUserData' => ($event['consent_state'] ?? 'pending') === 'granted' ? 'GRANTED' : 'DENIED', 'adPersonalization' => ($event['consent_state'] ?? 'pending') === 'granted' ? 'GRANTED' : 'DENIED', 'adStorage' => ($event['consent_state'] ?? 'pending') === 'granted' ? 'GRANTED' : 'DENIED', 'analyticsStorage' => ($event['consent_state'] ?? 'pending') === 'granted' ? 'GRANTED' : 'DENIED'],
        ];
        if ($adIdentifiers !== []) $conversion['adIdentifiers'] = $adIdentifiers;
        if ($userIdentifiers !== []) $conversion['userData'] = ['userIdentifiers' => $userIdentifiers];
        if (isset($event['params']['value'])) $conversion['conversionValue'] = (float) $event['params']['value'];
        if (isset($event['params']['currency'])) $conversion['currency'] = $event['params']['currency'];

        return [
            'destinations' => [[
                'operatingAccount' => ['accountType' => 'GOOGLE_ADS', 'accountId' => $credentials['operating_account_id']],
                'productDestinationId' => $credentials['conversion_action_id'],
            ]],
            'events' => [$conversion],
            'encoding' => 'HEX',
        ];
    }

    public static function request(array $event, array $credentials): array
    {
        foreach (['operating_account_id', 'conversion_action_id'] as $key) {
            if (!preg_match('/^[0-9]{1,20}$/', (string) ($credentials[$key] ?? ''))) throw new RuntimeException('destination_not_configured');
        }
        if (trim((string) ($credentials['oauth_access_token'] ?? '')) === '') throw new RuntimeException('destination_not_configured');
        return self::post(
            'https://datamanager.googleapis.com/v1/events:ingest',
            ['Authorization: Bearer ' . $credentials['oauth_access_token']],
            self::payload($event, $credentials)
        );
    }
}
