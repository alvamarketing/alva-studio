<?php
require_once __DIR__ . '/CoreMetaAdapter.php';
require_once __DIR__ . '/CoreTikTokAdapter.php';
require_once __DIR__ . '/GoogleEnhancedConversionsAdapter.php';
require_once __DIR__ . '/LinkedInCapiAdapter.php';
require_once __DIR__ . '/TaboolaS2SAdapter.php';

final class AlvaDestinationRegistry
{
    private const ADAPTERS = [
        'meta' => CoreMetaAdapter::class,
        'tiktok' => CoreTikTokAdapter::class,
        'google' => GoogleEnhancedConversionsAdapter::class,
        'linkedin' => LinkedInCapiAdapter::class,
        'taboola' => TaboolaS2SAdapter::class,
    ];
    public static function get(string $destination): string
    {
        if (!isset(self::ADAPTERS[$destination])) throw new InvalidArgumentException('invalid_destination');
        return self::ADAPTERS[$destination];
    }
}
