<?php

class WebhookPropertyResolver
{
    public static function resolve(
        array $payload,
        ?array $canonicalEvent = null,
        ?string $queryProperty = null,
        ?string $defaultProperty = null
    ): string {
        $body = self::extractBody($payload);
        $tracking = self::extractTracking($payload);
        $eventContext = is_array($canonicalEvent['context'] ?? null) ? $canonicalEvent['context'] : [];
        $eventParams = is_array($canonicalEvent['params'] ?? null) ? $canonicalEvent['params'] : [];

        $value = self::firstNonEmpty([
            self::canonicalProperty($queryProperty),
            self::canonicalProperty($tracking['property_id'] ?? null),
            self::canonicalProperty($tracking['propertyId'] ?? null),
            self::canonicalProperty($tracking['nvs_property_id'] ?? null),
            self::canonicalProperty($tracking['nvsPropertyId'] ?? null),
            self::canonicalProperty($tracking['project_id'] ?? null),
            self::canonicalProperty($tracking['projectId'] ?? null),
            self::canonicalProperty($body['property_id'] ?? null),
            self::canonicalProperty($body['nvs_property_id'] ?? null),
            self::canonicalProperty($body['nvsPropertyId'] ?? null),
            self::canonicalProperty($body['project_id'] ?? null),
            self::canonicalProperty($body['projectId'] ?? null),
            self::canonicalProperty($body['order']['property_id'] ?? null),
            self::canonicalProperty($body['order']['nvs_property_id'] ?? null),
            self::canonicalProperty($body['order']['nvsPropertyId'] ?? null),
            self::canonicalProperty($payload['property_id'] ?? null),
            self::canonicalProperty($payload['nvs_property_id'] ?? null),
            self::canonicalProperty($payload['nvsPropertyId'] ?? null),
            self::canonicalProperty($payload['project_id'] ?? null),
            self::canonicalProperty($payload['projectId'] ?? null),
            self::canonicalProperty($canonicalEvent['property_id'] ?? null),
            self::canonicalProperty($canonicalEvent['nvs_property_id'] ?? null),
            self::canonicalProperty($eventContext['property_id'] ?? null),
            self::canonicalProperty($eventContext['nvs_property_id'] ?? null),
            self::canonicalProperty($eventParams['property_id'] ?? null),
            self::canonicalProperty($eventParams['nvs_property_id'] ?? null),
            $defaultProperty,
        ]);

        return self::cleanKey($value ?? 'default', 'default');
    }

    private static function canonicalProperty($value): ?string
    {
        $value = trim((string) ($value ?? ''));

        return $value !== '' && strtolower($value) !== 'default' ? $value : null;
    }

    private static function extractBody(array $payload): array
    {
        if (isset($payload['body']) && is_array($payload['body'])) {
            return $payload['body'];
        }

        if (isset($payload[0]['body']) && is_array($payload[0]['body'])) {
            return $payload[0]['body'];
        }

        return $payload;
    }

    private static function extractTracking(array $payload): array
    {
        $body = self::extractBody($payload);

        if (isset($body['tracking']) && is_array($body['tracking'])) {
            return $body['tracking'];
        }

        if (isset($body['order']['tracking']) && is_array($body['order']['tracking'])) {
            return $body['order']['tracking'];
        }

        if (isset($payload['tracking']) && is_array($payload['tracking'])) {
            return $payload['tracking'];
        }

        if (isset($payload['order']['tracking']) && is_array($payload['order']['tracking'])) {
            return $payload['order']['tracking'];
        }

        return [];
    }

    private static function firstNonEmpty(array $values): ?string
    {
        foreach ($values as $value) {
            if ($value === null || !is_scalar($value)) {
                continue;
            }

            $value = trim((string) $value);

            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private static function cleanKey($value, string $fallback): string
    {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('/[^a-z0-9_]/', '_', $value);
        $value = preg_replace('/_+/', '_', $value);
        $value = trim($value, '_');

        return $value !== '' ? $value : $fallback;
    }
}
