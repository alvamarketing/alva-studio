<?php

/**
 * Limitador de requisições por chave, com janela deslizante em arquivo.
 *
 * O webhook do Core é anônimo até a checagem de segredo e grava o payload no
 * MySQL e em disco. Sem limite, um laço de requisições enche o disco e a tabela
 * de webhooks do servidor. Em hospedagem compartilhada isso derruba o site
 * inteiro, não apenas o rastreamento.
 *
 * Implementação em arquivo por decisão consciente: o Core precisa funcionar em
 * hospedagem simples, sem Redis e sem alterar o schema do MySQL. Cada chave
 * ocupa um arquivo pequeno, limitado ao número máximo de registros da janela.
 *
 * Quando o limite é atingido, o registro NÃO é gravado. Isso impede que uma
 * enxurrada de requisições bloqueadas continue crescendo o arquivo.
 */
class RateLimiter
{
    /**
     * @return array{allowed: bool, count: int, retry_after: int}
     */
    public static function check(
        string $directory,
        string $key,
        int $limit,
        int $windowSeconds,
        ?int $now = null
    ): array {
        $now = $now ?? time();

        if ($limit <= 0 || $windowSeconds <= 0) {
            return ['allowed' => true, 'count' => 0, 'retry_after' => 0];
        }

        if (!is_dir($directory) && !@mkdir($directory, 0755, true) && !is_dir($directory)) {
            // Sem onde persistir a contagem, não bloqueia o tráfego legítimo.
            return ['allowed' => true, 'count' => 0, 'retry_after' => 0];
        }

        $file = rtrim($directory, '/') . '/' . sha1($key) . '.json';
        $handle = @fopen($file, 'c+');

        if ($handle === false) {
            return ['allowed' => true, 'count' => 0, 'retry_after' => 0];
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                return ['allowed' => true, 'count' => 0, 'retry_after' => 0];
            }

            $raw = stream_get_contents($handle);
            $timestamps = self::parseTimestamps($raw);

            $cutoff = $now - $windowSeconds;
            $timestamps = array_values(array_filter(
                $timestamps,
                static fn (int $timestamp): bool => $timestamp > $cutoff
            ));

            if (count($timestamps) >= $limit) {
                $oldest = $timestamps[0];
                $retryAfter = max(1, ($oldest + $windowSeconds) - $now);

                self::persist($handle, $timestamps);

                return [
                    'allowed' => false,
                    'count' => count($timestamps),
                    'retry_after' => $retryAfter,
                ];
            }

            $timestamps[] = $now;
            self::persist($handle, $timestamps);

            return [
                'allowed' => true,
                'count' => count($timestamps),
                'retry_after' => 0,
            ];
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /**
     * Remove arquivos de chaves inativas. Chamado de forma probabilística para
     * não pagar o custo de varredura em toda requisição.
     */
    public static function collectGarbage(string $directory, int $windowSeconds, ?int $now = null): int
    {
        $now = $now ?? time();

        if (!is_dir($directory)) {
            return 0;
        }

        $files = glob(rtrim($directory, '/') . '/*.json');

        if (!$files) {
            return 0;
        }

        $cutoff = $now - ($windowSeconds * 2);
        $removed = 0;

        foreach ($files as $file) {
            $modified = @filemtime($file);

            if ($modified !== false && $modified < $cutoff && @unlink($file)) {
                $removed++;
            }
        }

        return $removed;
    }

    /**
     * @return int[]
     */
    private static function parseTimestamps(string $raw): array
    {
        if (trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        if (!is_array($decoded)) {
            return [];
        }

        $timestamps = [];

        foreach ($decoded as $value) {
            if (is_int($value) || (is_string($value) && ctype_digit($value))) {
                $timestamps[] = (int) $value;
            }
        }

        sort($timestamps);

        return $timestamps;
    }

    private static function persist($handle, array $timestamps): void
    {
        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode(array_values($timestamps)));
        fflush($handle);
    }
}
