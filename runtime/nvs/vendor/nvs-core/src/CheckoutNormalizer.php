<?php

/**
 * Normalizacoes compartilhadas pelos tradutores de checkout.
 *
 * Cada plataforma entrega o mesmo fato — uma compra aprovada — em formato
 * proprio. O tradutor de cada uma mapeia campos; a conversao de tipo mora aqui,
 * para que uma correcao de parsing valha para todas.
 *
 * NvspayTranslator mantem copia propria destes helpers por ser o unico tradutor
 * validado em producao. Migrar aquele arquivo para ca e seguro apenas com os
 * testes dele como rede, e nao foi feito junto desta mudanca.
 */
class CheckoutNormalizer
{
    /** Identificador de pessoa gerado pelo nvs.js: nvs_<projeto>_<hex>. */
    private const NVS_UID_PATTERN = '/^nvs_[a-z0-9_]+_[a-f0-9]{8,}$/i';

    /**
     * Percorre um caminho aninhado. `get($payload, 'data.purchase.price.value')`.
     */
    public static function get(array $payload, string $path)
    {
        $current = $payload;

        foreach (explode('.', $path) as $segment) {
            if (!is_array($current) || !array_key_exists($segment, $current)) {
                return null;
            }

            $current = $current[$segment];
        }

        return $current;
    }

    /**
     * Primeiro caminho que resolve para valor textual nao vazio.
     *
     * @param string[] $paths
     */
    public static function firstPath(array $payload, array $paths): ?string
    {
        foreach ($paths as $path) {
            $value = self::text(self::get($payload, $path));

            if ($value !== null) {
                return $value;
            }
        }

        return null;
    }

    public static function firstNonEmpty(array $values): ?string
    {
        foreach ($values as $value) {
            $text = self::text($value);

            if ($text !== null) {
                return $text;
            }
        }

        return null;
    }

    public static function text($value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }

    /**
     * Valor monetario ja em unidade decimal.
     */
    public static function decimalAmount($value): float
    {
        if (is_int($value) || is_float($value)) {
            return (float) $value;
        }

        $text = self::text($value);

        if ($text === null) {
            return 0.0;
        }

        if (is_numeric($text)) {
            return (float) $text;
        }

        // "R$ 1.234,56" -> 1234.56
        $clean = str_replace(['R$', ' ', "\xc2\xa0", '.'], '', $text);
        $clean = str_replace(',', '.', $clean);

        return is_numeric($clean) ? (float) $clean : 0.0;
    }

    /**
     * Valor monetario em centavos. Kiwify entrega 12048 para R$ 120,48;
     * Hotmart entrega 235.76 direto. Tratar os dois igual erra por 100x sem
     * gerar erro nenhum, por isso a conversao e explicita por plataforma.
     */
    public static function centsAmount($value): float
    {
        if (is_int($value)) {
            return $value / 100;
        }

        if (is_float($value)) {
            return $value / 100;
        }

        $text = self::text($value);

        if ($text === null || !is_numeric($text)) {
            return 0.0;
        }

        return ((float) $text) / 100;
    }

    /**
     * Aceita segundos, milissegundos e datas em texto.
     */
    public static function timestamp($value): ?int
    {
        if ($value === null || $value === '' || is_array($value)) {
            return null;
        }

        if (is_numeric($value)) {
            $number = (float) $value;

            return $number > 9999999999 ? (int) floor($number / 1000) : (int) $number;
        }

        if (is_string($value)) {
            $parsed = strtotime($value);

            return $parsed !== false ? $parsed : null;
        }

        return null;
    }

    /**
     * @return array{0: ?string, 1: ?string}
     */
    public static function splitName(?string $fullName): array
    {
        $fullName = trim((string) $fullName);

        if ($fullName === '') {
            return [null, null];
        }

        $parts = preg_split('/\s+/', $fullName) ?: [];

        return [
            $parts[0] ?? null,
            count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : null,
        ];
    }

    public static function phone(?string $phone): ?string
    {
        if ($phone === null) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $phone);

        return $digits !== '' ? $digits : null;
    }

    public static function cleanKey($value, string $fallback): string
    {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('/[^a-z0-9_]/', '_', $value);
        $value = preg_replace('/_+/', '_', $value);
        $value = trim($value, '_');

        return $value !== '' ? $value : $fallback;
    }

    public static function currency($value, string $fallback = 'BRL'): string
    {
        $text = self::text($value);

        if ($text === null) {
            return $fallback;
        }

        return strtoupper(substr($text, 0, 3));
    }

    public static function normalizeUtm(array $source): array
    {
        $pick = static function (array $keys) use ($source): ?string {
            foreach ($keys as $key) {
                $value = self::text($source[$key] ?? null);

                if ($value !== null) {
                    return $value;
                }
            }

            return null;
        };

        return [
            'utm_source'   => $pick(['utm_source', 'source']),
            'utm_medium'   => $pick(['utm_medium', 'medium']),
            'utm_campaign' => $pick(['utm_campaign', 'campaign']),
            'utm_content'  => $pick(['utm_content', 'content']),
            'utm_term'     => $pick(['utm_term', 'term']),
            'utm_id'       => $pick(['utm_id', 'id']),
        ];
    }

    /**
     * Estrutura vazia de identificadores de clique, para eventos que chegam sem
     * jornada. Mantem o formato estavel para o MetaClient.
     */
    public static function emptyProviderIds(): array
    {
        return [
            'fbp' => null,
            'fbc' => null,
            'fbclid' => null,
            'gclid' => null,
            'ttclid' => null,
        ];
    }

    public static function looksLikeNvsUid(?string $value): bool
    {
        return $value !== null && preg_match(self::NVS_UID_PATTERN, $value) === 1;
    }

    /**
     * Separa os campos de repasse do checkout em identidade reconhecida e
     * candidatos.
     *
     * Plataformas de checkout hospedado descartam parametros arbitrarios da URL
     * e devolvem apenas alguns campos de origem (sck, src, xcode, s1..s3). Esses
     * campos sao o unico canal para a identidade capturada no site chegar de
     * volta. Quando o valor e um nvs_uid reconhecivel, e usado direto; quando e
     * uma ficha curta, fica registrado como candidato para a resolucao contra a
     * tabela de fichas.
     *
     * @param array<string, mixed> $slots  rotulo => valor bruto
     * @return array{nvs_uid: ?string, candidates: array<string, string>}
     */
    public static function resolvePassthrough(array $slots): array
    {
        $nvsUid = null;
        $candidates = [];

        foreach ($slots as $label => $raw) {
            $value = self::text($raw);

            if ($value === null) {
                continue;
            }

            if ($nvsUid === null && self::looksLikeNvsUid($value)) {
                $nvsUid = $value;
                continue;
            }

            $candidates[$label] = $value;
        }

        return ['nvs_uid' => $nvsUid, 'candidates' => $candidates];
    }
}
