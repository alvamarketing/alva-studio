<?php

class NvspayTranslator {

    public static function translatePurchaseApproved(array $rawPayload): ?array {
        $body = self::extractBody($rawPayload);

        if (!is_array($body)) {
            return null;
        }

        $event = $body['event'] ?? null;
        $order = $body['order'] ?? [];
        $customer = $body['customer'] ?? [];
        $items = $body['items'] ?? [];
        $tracking = self::extractTracking($body);

        $status = $order['status'] ?? null;

        if ($event !== 'approved' && $status !== 'approved') {
            return null;
        }

        $orderId = $order['id'] ?? null;

        if (!$orderId) {
            return null;
        }

        $propertyId = self::extractPropertyId($tracking, $order, $body);
        $cookiePrefix = self::extractCookiePrefix($tracking, $propertyId);

        $nvsUid = self::firstNonEmpty([
            $tracking['nvsUid'] ?? null,
            $tracking['nvs_uid'] ?? null,
            $tracking['nvsUID'] ?? null,
            $order['nvs_uid'] ?? null,
        ]);

        $nvsSid = self::firstNonEmpty([
            $tracking['nvsSid'] ?? null,
            $tracking['nvs_sid'] ?? null,
            $tracking['nvsSID'] ?? null,
            $order['nvs_sid'] ?? null,
        ]);

        $nvsEventId = self::firstNonEmpty([
            $tracking['nvsEventId'] ?? null,
            $tracking['nvs_event_id'] ?? null,
        ]) ?? ('nvs_purchase_' . $orderId);

        $fullName = trim((string) ($customer['fullName'] ?? ''));
        [$firstName, $lastName] = self::splitName($fullName);

        $value = self::toFloat($order['amountTotal'] ?? 0);
        $currency = $order['currency'] ?? 'BRL';

        $checkoutUrl = self::firstNonEmpty([
            $tracking['checkoutUrl'] ?? null,
            $tracking['checkout_url'] ?? null,
            $order['checkoutUrl'] ?? null,
            $order['checkout_url'] ?? null,
        ]);

        $landingUrl = self::firstNonEmpty([
            $tracking['landingUrl'] ?? null,
            $tracking['landing_url'] ?? null,
            $order['landingUrl'] ?? null,
            $order['landing_url'] ?? null,
        ]);

        return [
            'property_id' => $propertyId,
            'event_id' => $nvsEventId,
            'event_name' => 'purchase',
            'meta_event_name' => 'Purchase',
            'event_time' => self::parseTimestamp($body['occurredAt'] ?? null) ?? time(),
            'source' => 'webhook',
            'source_platform' => 'nvspay',

            'context' => [
                'property_id' => $propertyId,
                'cookie_prefix' => $cookiePrefix,
                'nvs_uid' => $nvsUid,
                'nvs_sid' => $nvsSid,
                'page_url' => $checkoutUrl ?? $landingUrl ?? 'webhook://nvspay/purchase_approved',
                'landing_url' => $landingUrl,
                'checkout_url' => $checkoutUrl,
                'referrer' => $tracking['referrer'] ?? null,
                'ip_address' => $tracking['clientIpAddress'] ?? $tracking['client_ip_address'] ?? null,
                'user_agent' => $tracking['clientUserAgent'] ?? $tracking['client_user_agent'] ?? null,
                'utm' => self::normalizeUtm($tracking['utm'] ?? $order['utm'] ?? []),
                'provider_ids' => self::normalizeProviderIds($tracking['providerIds'] ?? $tracking['provider_ids'] ?? []),
                'checkout_session_id' => $tracking['checkoutSessionId'] ?? $tracking['checkout_session_id'] ?? $order['checkoutSessionId'] ?? null,
                'captured_at' => $tracking['capturedAt'] ?? $tracking['captured_at'] ?? null,
            ],

            'user' => [
                'customer_id' => $customer['id'] ?? null,
                'email' => self::nullIfEmpty($customer['email'] ?? null),
                'phone' => self::normalizePhone($customer['phone'] ?? null),
                'full_name' => $fullName ?: null,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'country' => self::nullIfEmpty($customer['countryCode'] ?? $order['countryCode'] ?? null),
                'locale' => self::nullIfEmpty($customer['locale'] ?? $order['locale'] ?? null),
            ],

            'params' => [
                'transaction_id' => $orderId,
                'display_number' => $order['displayNumber'] ?? null,
                'sequence_number' => $order['sequenceNumber'] ?? null,
                'value' => $value,
                'currency' => $currency,
                'status' => $status,
                'payment_type' => $order['paymentMethod'] ?? null,
                'item_count' => $order['itemCount'] ?? count($items),
                'amount_main' => self::toFloat($order['amountMain'] ?? $value),
                'amount_bump' => self::toFloat($order['amountBump'] ?? 0),
                'amount_total' => $value,
                'has_order_bumps' => (bool) ($order['hasOrderBumps'] ?? false),
                'order_bump_count' => (int) ($order['orderBumpCount'] ?? 0),
                'offer' => $body['offer'] ?? null,
                'items' => self::normalizeItems($items),
            ],

            '_source_raw' => $rawPayload,
        ];
    }

    private static function extractBody(array $payload): array {
        if (isset($payload['body']) && is_array($payload['body'])) {
            return $payload['body'];
        }

        if (isset($payload[0]['body']) && is_array($payload[0]['body'])) {
            return $payload[0]['body'];
        }

        return $payload;
    }

    private static function extractTracking(array $body): array {
        if (isset($body['tracking']) && is_array($body['tracking'])) {
            return $body['tracking'];
        }

        if (isset($body['order']['tracking']) && is_array($body['order']['tracking'])) {
            return $body['order']['tracking'];
        }

        return [];
    }

    private static function extractPropertyId(array $tracking, array $order, array $body): string {
        $direct = self::firstNonEmpty([
            $tracking['nvsPropertyId'] ?? null,
            $tracking['nvs_property_id'] ?? null,
            $tracking['propertyId'] ?? null,
            $tracking['property_id'] ?? null,
            $order['nvs_property_id'] ?? null,
            $order['property_id'] ?? null,
            $body['nvs_property_id'] ?? null,
            $body['property_id'] ?? null,
        ]);

        if ($direct) {
            return self::cleanKey($direct, 'default');
        }

        $urls = [
            $tracking['checkoutUrl'] ?? null,
            $tracking['checkout_url'] ?? null,
            $tracking['landingUrl'] ?? null,
            $tracking['landing_url'] ?? null,
            $order['checkoutUrl'] ?? null,
            $order['checkout_url'] ?? null,
        ];

        foreach ($urls as $url) {
            $propertyFromUrl = self::propertyFromUrl($url);

            if ($propertyFromUrl) {
                return $propertyFromUrl;
            }
        }

        $nvsUid = self::firstNonEmpty([
            $tracking['nvsUid'] ?? null,
            $tracking['nvs_uid'] ?? null,
        ]);

        if ($nvsUid && preg_match('/^nvs_([a-z0-9_]+?)_[a-f0-9]{8,}$/i', $nvsUid, $matches)) {
            $candidate = strtolower($matches[1]);

            if ($candidate && $candidate !== 'uid') {
                return self::cleanKey($candidate, 'default');
            }
        }

        return 'default';
    }

    private static function extractCookiePrefix(array $tracking, string $propertyId): string {
        $prefix = self::firstNonEmpty([
            $tracking['cookiePrefix'] ?? null,
            $tracking['cookie_prefix'] ?? null,
            $tracking['nvsCookiePrefix'] ?? null,
            $tracking['nvs_cookie_prefix'] ?? null,
        ]);

        if ($prefix) {
            return self::cleanKey($prefix, $propertyId === 'default' ? 'nvs' : 'nvs_' . $propertyId);
        }

        return $propertyId === 'default' ? 'nvs' : 'nvs_' . $propertyId;
    }

    private static function propertyFromUrl($url): ?string {
        if (!$url || !is_string($url)) {
            return null;
        }

        $query = parse_url($url, PHP_URL_QUERY);

        if (!$query) {
            return null;
        }

        parse_str($query, $params);

        $propertyId = self::firstNonEmpty([
            $params['nvs_property_id'] ?? null,
            $params['property_id'] ?? null,
            $params['nvsPropertyId'] ?? null,
        ]);

        return $propertyId ? self::cleanKey($propertyId, 'default') : null;
    }

    private static function normalizeUtm(array $utm): array {
        return [
            'utm_source' => self::nullIfEmpty($utm['utm_source'] ?? $utm['source'] ?? null),
            'utm_medium' => self::nullIfEmpty($utm['utm_medium'] ?? $utm['medium'] ?? null),
            'utm_campaign' => self::nullIfEmpty($utm['utm_campaign'] ?? $utm['campaign'] ?? null),
            'utm_content' => self::nullIfEmpty($utm['utm_content'] ?? $utm['content'] ?? null),
            'utm_term' => self::nullIfEmpty($utm['utm_term'] ?? $utm['term'] ?? null),
            'utm_id' => self::nullIfEmpty($utm['utm_id'] ?? $utm['id'] ?? null),
        ];
    }

    private static function normalizeProviderIds(array $providerIds): array {
        return [
            'fbp' => self::nullIfEmpty($providerIds['fbp'] ?? $providerIds['_fbp'] ?? null),
            'fbc' => self::nullIfEmpty($providerIds['fbc'] ?? $providerIds['_fbc'] ?? null),
            'fbclid' => self::nullIfEmpty($providerIds['fbclid'] ?? null),
            'gclid' => self::nullIfEmpty($providerIds['gclid'] ?? null),
            'ttclid' => self::nullIfEmpty($providerIds['ttclid'] ?? null),
            'supreme_stuid' => self::nullIfEmpty($providerIds['supremeStuid'] ?? $providerIds['stuid'] ?? $providerIds['supreme_stuid'] ?? null),
        ];
    }

    private static function normalizeItems(array $items): array {
        $normalized = [];

        foreach ($items as $item) {
            $product = $item['product'] ?? [];
            $offer = $item['offer'] ?? [];

            $normalized[] = [
                'item_id' => (string) ($product['id'] ?? $item['productId'] ?? $offer['id'] ?? $item['offerId'] ?? ''),
                'item_name' => (string) ($product['name'] ?? $offer['name'] ?? ''),
                'item_slug' => $product['slug'] ?? $offer['slug'] ?? null,
                'offer_id' => $item['offerId'] ?? $offer['id'] ?? null,
                'offer_name' => $offer['name'] ?? null,
                'item_type' => $item['itemType'] ?? null,
                'price' => self::toFloat($item['amount'] ?? $offer['price'] ?? 0),
                'quantity' => (int) ($item['quantity'] ?? 1),
                'currency' => $item['currency'] ?? 'BRL',
            ];
        }

        return $normalized;
    }

    private static function splitName(string $fullName): array {
        $fullName = trim($fullName);

        if ($fullName === '') {
            return [null, null];
        }

        $parts = preg_split('/\s+/', $fullName) ?: [];

        $firstName = $parts[0] ?? null;
        $lastName = count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : null;

        return [$firstName, $lastName];
    }

    private static function normalizePhone(?string $phone): ?string {
        if (!$phone) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $phone);

        return $digits !== '' ? $digits : null;
    }

    private static function parseTimestamp($value): ?int {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_numeric($value)) {
            $number = (float) $value;
            return $number > 9999999999 ? (int) floor($number / 1000) : (int) $number;
        }

        if (is_string($value)) {
            $timestamp = strtotime($value);
            return $timestamp !== false ? $timestamp : null;
        }

        return null;
    }

    private static function toFloat($value): float {
        if ($value === null || $value === '') {
            return 0.0;
        }

        if (is_numeric($value)) {
            return (float) $value;
        }

        if (is_string($value)) {
            $clean = str_replace(['R$', ' ', '.'], '', $value);
            $clean = str_replace(',', '.', $clean);

            return is_numeric($clean) ? (float) $clean : 0.0;
        }

        return 0.0;
    }

    private static function firstNonEmpty(array $values): ?string {
        foreach ($values as $value) {
            if ($value === null) {
                continue;
            }

            $value = trim((string) $value);

            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private static function cleanKey($value, string $fallback): string {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('/[^a-z0-9_]/', '_', $value);
        $value = preg_replace('/_+/', '_', $value);
        $value = trim($value, '_');

        return $value !== '' ? $value : $fallback;
    }

    private static function nullIfEmpty($value): ?string {
        if ($value === null) {
            return null;
        }

        if (is_string($value)) {
            $value = trim($value);
        }

        if ($value === '') {
            return null;
        }

        return (string) $value;
    }
}