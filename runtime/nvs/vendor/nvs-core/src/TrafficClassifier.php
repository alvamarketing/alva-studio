<?php

class TrafficClassifier
{
    public static function knownBotName(?string $userAgent): ?string
    {
        $userAgent = strtolower(trim((string) $userAgent));

        if ($userAgent === '') {
            return null;
        }

        $knownBots = [
            'facebookexternalhit' => 'Facebook link preview',
            'meta-externalagent' => 'Meta external agent',
            'meta-externalfetcher' => 'Meta external fetcher',
            'facebot' => 'Facebook crawler',
            'googlebot' => 'Googlebot',
            'bingbot' => 'Bingbot',
            'bingpreview' => 'Bing preview',
            'duckduckbot' => 'DuckDuckBot',
            'yandexbot' => 'YandexBot',
            'baiduspider' => 'Baiduspider',
            'petalbot' => 'PetalBot',
            'semrushbot' => 'SemrushBot',
            'ahrefsbot' => 'AhrefsBot',
            'mj12bot' => 'MJ12bot',
            'dotbot' => 'DotBot',
            'bytespider' => 'Bytespider',
        ];

        foreach ($knownBots as $needle => $label) {
            if (strpos($userAgent, $needle) !== false) {
                return $label;
            }
        }

        return null;
    }
}
