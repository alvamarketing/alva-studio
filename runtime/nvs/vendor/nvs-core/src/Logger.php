<?php

class Logger {
    public static function write(string $channel, array $data): void {
        $baseDir = dirname(__DIR__) . '/storage/logs';

        if (!is_dir($baseDir)) {
            mkdir($baseDir, 0755, true);
        }

        $file = $baseDir . '/' . $channel . '-' . date('Y-m-d') . '.log';

        $entry = [
            'time' => date('c'),
            'data' => $data,
        ];

        file_put_contents(
            $file,
            json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL,
            FILE_APPEND
        );
    }
}