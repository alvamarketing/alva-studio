<?php

/**
 * Contrato de um destino de evento.
 *
 * Simetrico ao CheckoutTranslatorRegistry: la, varias plataformas de checkout
 * convergem para um evento canonico; aqui, esse mesmo evento divergem para
 * varias plataformas de anuncio. O evento canonico e a fronteira entre os dois
 * lados, e nenhum dos lados conhece o outro.
 *
 * O retorno de send() e o formato que EventRepository::saveDelivery espera:
 *
 *   ok         resposta tecnica aceita pela plataforma
 *   sent       houve tentativa de envio
 *   mode       rotulo do caminho tomado, para auditoria
 *   reason     motivo quando nao houve envio
 *   http_code  codigo HTTP, quando houve requisicao
 *   curl_error erro de transporte, quando houve
 *   payload    corpo enviado, para auditoria
 *   response   resposta recebida
 *
 * ok=1 significa que a plataforma aceitou o evento. Nao significa que ela vai
 * atribuir a venda a uma campanha.
 */
interface EventDestination
{
    /** Chave curta e estavel, gravada na coluna destination. */
    public static function key(): string;

    /** Nome legivel, para log e interface. */
    public static function label(): string;

    /** O projeto tem credencial e pixel configurados para este destino. */
    public static function isConfigured(string $propertyId): bool;

    /** Corpo que seria enviado, sem enviar. Usado na auditoria de duplicatas. */
    public static function buildPayload(array $event): array;

    /** @return array{ok: bool, sent: bool, mode: ?string, reason: ?string, http_code: ?int, curl_error: ?string, payload: array, response: mixed} */
    public static function send(array $event): array;
}
