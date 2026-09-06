<?php

require_once __DIR__ . '/EventDestination.php';
require_once __DIR__ . '/MetaDestination.php';
require_once __DIR__ . '/TiktokClient.php';

/**
 * Mapa de destinos de evento.
 *
 * Espelha o CheckoutTranslatorRegistry no outro extremo do fluxo. Um destino
 * novo e uma linha aqui mais uma classe que implemente EventDestination; nem o
 * dispatch nem os tradutores mudam.
 *
 * Ordem importa: a Meta vem primeiro porque e o destino validado em producao e o
 * unico cujo diagnostico o dashboard le hoje.
 */
class EventDestinationRegistry
{
    private const DESTINATIONS = [
        MetaDestination::class,
        TiktokClient::class,
    ];

    /**
     * @return class-string<EventDestination>[]
     */
    public static function all(): array
    {
        return self::DESTINATIONS;
    }

    /**
     * @return string[]
     */
    public static function keys(): array
    {
        return array_map(
            static fn (string $destination): string => $destination::key(),
            self::DESTINATIONS
        );
    }

    /**
     * @return class-string<EventDestination>|null
     */
    public static function find(?string $key): ?string
    {
        $key = strtolower(trim((string) $key));

        foreach (self::DESTINATIONS as $destination) {
            if ($destination::key() === $key) {
                return $destination;
            }
        }

        return null;
    }

    /**
     * Destinos com credencial configurada para o projeto.
     *
     * @return class-string<EventDestination>[]
     */
    public static function configuredFor(string $propertyId): array
    {
        $enabled = [];

        foreach (self::DESTINATIONS as $destination) {
            if ($destination::isConfigured($propertyId)) {
                $enabled[] = $destination;
            }
        }

        return $enabled;
    }
}
