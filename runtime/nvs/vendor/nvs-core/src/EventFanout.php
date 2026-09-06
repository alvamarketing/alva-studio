<?php

require_once __DIR__ . '/EventDestinationRegistry.php';
require_once __DIR__ . '/EventRepository.php';
require_once __DIR__ . '/Logger.php';

/**
 * Distribui um evento canonico para os destinos configurados.
 *
 * Um unico lugar para a logica de leque, usado tanto pelo webhook de compra
 * quanto pela ingestao de eventos do navegador. Antes essa logica existia so no
 * dispatch; duplica-la no ingest faria as duas entradas divergirem em
 * deduplicacao e tratamento de falha com o tempo.
 *
 * Regras:
 *
 * - Deduplicacao e por destino. O mesmo evento pode ja ter sido aceito pela Meta
 *   e ainda nao ter chegado ao TikTok.
 * - Falha ou excecao em um destino nao interrompe os demais. Cada tentativa e
 *   gravada com o proprio resultado.
 * - Destino sem credencial e omitido, nao tratado como erro.
 */
class EventFanout
{
    /**
     * @param array $canonicalEvent evento canonico
     * @param string[] $skip chaves de destino a ignorar, para quando o chamador
     *                       ja tratou aquele destino por caminho proprio
     * @param array $logContext campos extras para o log
     *
     * @return array<string, array{ok: bool, sent: bool, mode: ?string, reason: ?string, http_code: ?int, delivery_db_id: ?int, result: array}>
     */
    public static function deliver(array $canonicalEvent, array $skip = [], array $logContext = []): array
    {
        $propertyId = (string) (
            $canonicalEvent['property_id']
            ?? ($canonicalEvent['context']['property_id'] ?? 'default')
        );

        $eventId = $canonicalEvent['event_id'] ?? null;
        $results = [];

        foreach (EventDestinationRegistry::configuredFor($propertyId) as $destination) {
            $key = $destination::key();

            if (in_array($key, $skip, true)) {
                continue;
            }

            $result = self::deliverTo($destination, $canonicalEvent, $eventId, $propertyId, $logContext);
            $deliveryDbId = EventRepository::saveDelivery($canonicalEvent, $result, $key);

            $results[$key] = [
                'ok' => $result['ok'] ?? false,
                'sent' => $result['sent'] ?? false,
                'mode' => $result['mode'] ?? null,
                'reason' => $result['reason'] ?? null,
                'http_code' => $result['http_code'] ?? null,
                'delivery_db_id' => $deliveryDbId,
                'result' => $result,
            ];
        }

        return $results;
    }

    /**
     * Entrega para um destino, sem gravar.
     *
     * Publico de proposito: e a junta que permite testar o isolamento de excecao
     * com um destino de mentira, ja que o registro de destinos e uma lista fixa.
     *
     * @param class-string<EventDestination> $destination
     */
    public static function deliverTo(
        string $destination,
        array $canonicalEvent,
        ?string $eventId,
        string $propertyId,
        array $logContext
    ): array {
        $key = $destination::key();

        $previous = $eventId
            ? EventRepository::findSuccessfulDeliveryByEventId($eventId, $propertyId, $key)
            : null;

        if ($previous) {
            Logger::write('delivery-deduped', array_merge($logContext, [
                'destination' => $key,
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'reason' => 'already_sent_successfully',
                'previous_delivery' => $previous,
            ]));

            return [
                'ok' => true,
                'sent' => false,
                'mode' => 'deduped',
                'reason' => 'already_sent_successfully',
                'http_code' => null,
                'curl_error' => null,
                'payload' => self::safePayload($destination, $canonicalEvent),
                'response' => [
                    'deduped' => true,
                    'destination' => $key,
                    'message' => 'Event already had a successful delivery. Skipped resend.',
                    'event_id' => $eventId,
                    'previous_delivery' => [
                        'id' => $previous['id'] ?? null,
                        'created_at' => $previous['created_at'] ?? null,
                        'http_code' => $previous['http_code'] ?? null,
                        'mode' => $previous['mode'] ?? null,
                    ],
                ],
            ];
        }

        try {
            $result = $destination::send($canonicalEvent);
        } catch (Throwable $e) {
            Logger::write('delivery-exception', array_merge($logContext, [
                'destination' => $key,
                'property_id' => $propertyId,
                'event_id' => $eventId,
                'error' => $e->getMessage(),
            ]));

            return [
                'ok' => false,
                'sent' => false,
                'mode' => 'exception',
                'reason' => 'destination_threw',
                'http_code' => null,
                'curl_error' => $e->getMessage(),
                'payload' => self::safePayload($destination, $canonicalEvent),
                'response' => null,
            ];
        }

        if (empty($result['payload'])) {
            $result['payload'] = self::safePayload($destination, $canonicalEvent);
        }

        return $result;
    }

    /**
     * A reconstrucao do payload e so para auditoria. Se ela falhar, isso nao pode
     * derrubar a gravacao da entrega.
     */
    private static function safePayload(string $destination, array $canonicalEvent): array
    {
        try {
            return $destination::buildPayload($canonicalEvent);
        } catch (Throwable $e) {
            return [];
        }
    }

    /**
     * Resumo para resposta HTTP, sem payload nem corpo de resposta.
     */
    public static function summarize(array $results): array
    {
        $summary = [];

        foreach ($results as $key => $entry) {
            $summary[$key] = [
                'ok' => $entry['ok'],
                'sent' => $entry['sent'],
                'mode' => $entry['mode'],
                'reason' => $entry['reason'],
                'http_code' => $entry['http_code'],
            ];
        }

        return $summary;
    }
}
