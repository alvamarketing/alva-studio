<?php

/**
 * Autenticação do webhook de checkout.
 *
 * Comportamento anterior: quando existia segredo configurado e o request chegava
 * sem segredo, o Core aceitava e processava, registrando "missing_but_allowed".
 * Como a URL do webhook é exibida na interface e carrega o property_id em query
 * string, ela não é um segredo criptográfico: qualquer um que a conhecesse podia
 * forjar uma compra aprovada, gravá-la no banco e disparar um Purchase para a
 * Conversions API, corrompendo a otimização da campanha.
 *
 * Agora o segredo é obrigatório. Um Core sem NVS_WEBHOOK_SECRET configurado
 * recusa todos os webhooks: isso é misconfiguração, não modo de compatibilidade.
 *
 * O segredo é aceito por header ou por query string. O header é a forma correta;
 * a query existe porque nem toda plataforma de checkout permite header
 * customizado na URL de webhook. Quem usar a query deve saber que o valor
 * aparece nos logs de acesso do servidor.
 */
class WebhookAuthenticator
{
    public const STATUS_VERIFIED = 'verified';
    public const STATUS_MISSING = 'missing';
    public const STATUS_INVALID = 'invalid';
    public const STATUS_NOT_CONFIGURED = 'not_configured';

    /** Headers aceitos, na forma normalizada pelo PHP em $_SERVER. */
    private const HEADER_KEYS = [
        'HTTP_X_NVS_WEBHOOK_SECRET',
        'HTTP_X_NVS_SECRET',
    ];

    /** Parâmetros de query aceitos como alternativa ao header. */
    private const QUERY_KEYS = [
        'secret',
        'nvs_secret',
        'webhook_secret',
    ];

    /**
     * @return array{ok: bool, status: string}
     */
    public static function authenticate(?string $expectedSecret, array $server, array $query): array
    {
        $expectedSecret = self::normalize($expectedSecret);

        if ($expectedSecret === null) {
            return ['ok' => false, 'status' => self::STATUS_NOT_CONFIGURED];
        }

        $candidates = self::collectCandidates($server, $query);

        if ($candidates === []) {
            return ['ok' => false, 'status' => self::STATUS_MISSING];
        }

        foreach ($candidates as $candidate) {
            if (hash_equals($expectedSecret, $candidate)) {
                return ['ok' => true, 'status' => self::STATUS_VERIFIED];
            }
        }

        return ['ok' => false, 'status' => self::STATUS_INVALID];
    }

    /**
     * @return string[]
     */
    private static function collectCandidates(array $server, array $query): array
    {
        $candidates = [];

        foreach (self::HEADER_KEYS as $key) {
            $value = self::normalize($server[$key] ?? null);

            if ($value !== null) {
                $candidates[] = $value;
            }
        }

        foreach (self::QUERY_KEYS as $key) {
            $value = self::normalize($query[$key] ?? null);

            if ($value !== null) {
                $candidates[] = $value;
            }
        }

        return $candidates;
    }

    private static function normalize($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value !== '' ? $value : null;
    }
}
