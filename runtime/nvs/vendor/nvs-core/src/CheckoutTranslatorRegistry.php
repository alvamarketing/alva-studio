<?php

require_once __DIR__ . '/NvspayTranslator.php';
require_once __DIR__ . '/HotmartTranslator.php';
require_once __DIR__ . '/KiwifyTranslator.php';

/**
 * Mapa de plataforma de checkout para tradutor.
 *
 * Substitui a condicao fixa que existia no dispatch e que so reconhecia NVSPay.
 * Adicionar uma plataforma passa a ser uma linha aqui mais um tradutor, sem
 * tocar no fluxo do webhook.
 *
 * O evento canonico e o contrato: banco, envio a Meta, jornada e dashboard
 * conhecem apenas esse formato, nunca o formato de origem.
 */
class CheckoutTranslatorRegistry
{
    /** Nomes de acao aceitos para compra aprovada, normalizados. */
    private const PURCHASE_ACTIONS = [
        'purchase_approved',
        'purchase_complete',
        'order_approved',
        'order_paid',
        'purchase',
        'sale',
    ];

    private const TRANSLATORS = [
        'nvspay'  => [NvspayTranslator::class, 'translatePurchaseApproved'],
        'hotmart' => [HotmartTranslator::class, 'translatePurchaseApproved'],
        'kiwify'  => [KiwifyTranslator::class, 'translatePurchaseApproved'],
    ];

    /**
     * @return string[]
     */
    public static function platforms(): array
    {
        return array_keys(self::TRANSLATORS);
    }

    public static function supports(?string $platform, ?string $action): bool
    {
        return isset(self::TRANSLATORS[self::normalize($platform)])
            && in_array(self::normalize($action), self::PURCHASE_ACTIONS, true);
    }

    /**
     * Devolve o evento canonico, ou null quando a plataforma nao e suportada, a
     * acao nao e de compra aprovada, ou o payload nao representa compra
     * aprovada valida.
     */
    public static function translate(?string $platform, ?string $action, array $payload): ?array
    {
        if (!self::supports($platform, $action)) {
            return null;
        }

        $translator = self::TRANSLATORS[self::normalize($platform)];
        $event = $translator($payload);

        if (!is_array($event) || $event === []) {
            return null;
        }

        return $event;
    }

    private static function normalize(?string $value): string
    {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('/[^a-z0-9_]/', '_', $value);
        $value = preg_replace('/_+/', '_', $value);

        return trim($value, '_');
    }
}
