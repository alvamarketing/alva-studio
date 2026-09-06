<?php

declare(strict_types=1);

interface AlvaDestinationContract
{
    public static function key(): string;
    public static function payload(array $event, array $credentials): array;
    public static function request(array $event, array $credentials): array;
}
abstract class AlvaHttpDestination implements AlvaDestinationContract
{
    protected static function post(string $url, array $headers, array $payload): array
    {
        return self::send('POST', $url, $headers, $payload);
    }

    protected static function get(string $url, array $headers = []): array
    {
        return self::send('GET', $url, $headers, null);
    }

    private static function send(string $method, string $url, array $headers, ?array $payload): array
    {
        $allHeaders = $payload === null ? $headers : array_merge(['Content-Type: application/json'], $headers);
        $transport = AlvaNvs::env('NVS_OUTBOX_TEST_TRANSPORT');
        if ($transport === 'capture') return ['status' => 202, 'method' => $method, 'url' => $url, 'headers' => $allHeaders, 'payload' => $payload];
        if ($transport === 'failure') throw new RuntimeException('transport_error');
        if (!function_exists('curl_init')) throw new RuntimeException('curl_unavailable');

        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_HTTPHEADER => $allHeaders,
        ]);
        if ($payload !== null) curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($payload, JSON_THROW_ON_ERROR));
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        if ($body === false || $status < 200 || $status >= 300) throw new RuntimeException($error !== '' ? 'transport_error' : 'destination_rejected');
        return ['status' => $status];
    }
}
