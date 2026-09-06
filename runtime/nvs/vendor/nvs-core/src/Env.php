<?php

class Env
{
    private static array $values = [];
    private static array $loadedFiles = [];

    public static function load(string $path): void
    {
        if ($path === '' || !is_file($path)) {
            return;
        }

        $realPath = realpath($path) ?: $path;

        if (isset(self::$loadedFiles[$realPath])) {
            return;
        }

        self::$loadedFiles[$realPath] = true;

        $lines = file($path, FILE_IGNORE_NEW_LINES);

        if ($lines === false) {
            return;
        }

        foreach ($lines as $line) {
            $line = trim((string) $line);

            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            if (str_starts_with($line, 'export ')) {
                $line = trim(substr($line, 7));
            }

            $position = strpos($line, '=');

            if ($position === false) {
                continue;
            }

            $key = trim(substr($line, 0, $position));
            $value = trim(substr($line, $position + 1));

            if ($key === '') {
                continue;
            }

            $value = self::parseValue($value);

            self::$values[$key] = $value;
            $_ENV[$key] = $value;
            $_SERVER[$key] = $value;

            if (function_exists('putenv')) {
                @putenv($key . '=' . $value);
            }
        }
    }

    public static function get(string $key, $default = null)
    {
        if (array_key_exists($key, self::$values)) {
            return self::$values[$key];
        }

        if (array_key_exists($key, $_ENV)) {
            return $_ENV[$key];
        }

        if (array_key_exists($key, $_SERVER)) {
            return $_SERVER[$key];
        }

        $value = getenv($key);

        if ($value !== false) {
            return $value;
        }

        return $default;
    }

    public static function has(string $key): bool
    {
        $value = self::get($key);

        return $value !== null && $value !== '';
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::get($key);

        if ($value === null || $value === '') {
            return $default;
        }

        if (is_bool($value)) {
            return $value;
        }

        $value = strtolower(trim((string) $value));

        return in_array($value, ['1', 'true', 'yes', 'on', 'sim'], true);
    }

    public static function int(string $key, int $default = 0): int
    {
        $value = self::get($key);

        if ($value === null || $value === '') {
            return $default;
        }

        return (int) $value;
    }

    private static function parseValue(string $value): string
    {
        $value = trim($value);

        if ($value === '') {
            return '';
        }

        $first = $value[0];
        $last = substr($value, -1);

        if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
            $value = substr($value, 1, -1);

            if ($first === '"') {
                $value = str_replace(
                    ['\\n', '\\r', '\\"', '\\\\'],
                    ["\n", "\r", '"', '\\'],
                    $value
                );
            }

            return $value;
        }

        $value = self::stripInlineComment($value);

        return trim($value);
    }

    private static function stripInlineComment(string $value): string
    {
        $length = strlen($value);
        $escaped = false;
        $inSingle = false;
        $inDouble = false;

        for ($i = 0; $i < $length; $i++) {
            $char = $value[$i];

            if ($escaped) {
                $escaped = false;
                continue;
            }

            if ($char === '\\') {
                $escaped = true;
                continue;
            }

            if ($char === "'" && !$inDouble) {
                $inSingle = !$inSingle;
                continue;
            }

            if ($char === '"' && !$inSingle) {
                $inDouble = !$inDouble;
                continue;
            }

            if ($char === '#' && !$inSingle && !$inDouble) {
                $previous = $i > 0 ? $value[$i - 1] : '';

                if ($previous === '' || ctype_space($previous)) {
                    return substr($value, 0, $i);
                }
            }
        }

        return $value;
    }
}
