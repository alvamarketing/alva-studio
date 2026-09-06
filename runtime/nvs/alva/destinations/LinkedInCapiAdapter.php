<?php
require_once __DIR__ . '/Contract.php';

final class LinkedInCapiAdapter extends AlvaHttpDestination
{
    public static function key(): string { return 'linkedin'; }

    public static function payload(array $event, array $credentials): array
    {
        $userIds = array_values(array_filter([
            isset($event['user']['email_sha256']) ? ['idType' => 'SHA256_EMAIL', 'idValue' => $event['user']['email_sha256']] : null,
            isset($event['click_ids']['linkedin_tracking_uuid']) ? ['idType' => 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', 'idValue' => $event['click_ids']['linkedin_tracking_uuid']] : null,
        ]));
        if ($userIds === []) throw new RuntimeException('destination_identifier_required');

        $payload = [
            'conversion' => $credentials['conversion_urn'],
            'conversionHappenedAt' => (int) $event['event_time'] * 1000,
            'user' => ['userIds' => $userIds],
            'eventId' => $event['tracking_event_id'],
        ];
        if (isset($event['params']['value'], $event['params']['currency'])) {
            $payload['conversionValue'] = ['currencyCode' => $event['params']['currency'], 'amount' => (string) $event['params']['value']];
        }
        return $payload;
    }

    public static function request(array $event, array $credentials): array
    {
        if (!preg_match('/^urn:lla:llaPartnerConversion:[0-9]{1,20}$/', (string) ($credentials['conversion_urn'] ?? ''))
            || trim((string) ($credentials['access_token'] ?? '')) === '') throw new RuntimeException('destination_not_configured');
        $version = (string) ($credentials['linkedin_version'] ?? '202608');
        if (!preg_match('/^[0-9]{6}$/', $version)) throw new RuntimeException('destination_not_configured');
        return self::post('https://api.linkedin.com/rest/conversionEvents', [
            'Authorization: Bearer ' . $credentials['access_token'],
            'Linkedin-Version: ' . $version,
            'X-Restli-Protocol-Version: 2.0.0',
        ], self::payload($event, $credentials));
    }
}
