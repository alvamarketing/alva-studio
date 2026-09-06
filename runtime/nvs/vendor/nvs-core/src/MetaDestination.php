<?php

require_once __DIR__ . '/EventDestination.php';
require_once __DIR__ . '/MetaClient.php';

/**
 * Adaptador do MetaClient para o contrato de destino.
 *
 * O MetaClient e anterior a esta interface e e o unico caminho de envio validado
 * em producao. Em vez de reescreve-lo, ele e envelopado: o comportamento de
 * envio a Meta permanece byte a byte o mesmo, e a simetria e obtida sem risco de
 * regressao no caminho que ja funciona.
 */
final class MetaDestination implements EventDestination
{
    public static function key(): string
    {
        return 'meta';
    }

    public static function label(): string
    {
        return 'Meta Conversions API';
    }

    public static function isConfigured(string $propertyId): bool
    {
        // MetaClient::sendEvent ja decide sozinho e devolve motivo quando falta
        // configuracao. Deixar passar preserva esse diagnostico, que o dashboard
        // usa para explicar por que um evento nao foi enviado.
        return true;
    }

    public static function buildPayload(array $event): array
    {
        return MetaClient::buildPayload($event, Env::get('META_TEST_EVENT_CODE'));
    }

    public static function send(array $event): array
    {
        $result = MetaClient::sendEvent($event);

        if (empty($result['payload'])) {
            $result['payload'] = self::buildPayload($event);
        }

        return $result;
    }
}
