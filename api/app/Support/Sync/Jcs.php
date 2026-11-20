<?php

namespace App\Support\Sync;

use InvalidArgumentException;
use stdClass;

/**
 * RFC 8785 JSON Canonicalization Scheme: the bytes a signed op's payload and
 * a signed device audit row's before/after are hashed over
 * (docs/design-identity-permissions.md, 3.5). Held to the shared vectors in
 * contract/jcs-cases.json.
 *
 * Input is a value as json_decode($json) returns it with objects kept as
 * stdClass, so {} and [] stay apart; an associative PHP array is read as an
 * object too. Object members are sorted by their names' UTF-16 code units,
 * strings are escaped as ECMAScript's JSON.stringify escapes them, and
 * numbers are written as ECMAScript's Number.prototype.toString writes them
 * (integers beyond 2^53 go through the same double as they would in a
 * browser).
 */
final class Jcs
{
    public static function canonicalize(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            $value === true => 'true',
            $value === false => 'false',
            is_int($value) => abs($value) <= 9007199254740992 ? (string) $value : self::number((float) $value),
            is_float($value) => self::number($value),
            is_string($value) => self::string($value),
            $value instanceof stdClass => self::object(get_object_vars($value)),
            is_array($value) && array_is_list($value) => '['.implode(',', array_map(self::canonicalize(...), $value)).']',
            is_array($value) => self::object($value),
            default => throw new InvalidArgumentException('JCS: unsupported value'),
        };
    }

    /** @param  array<int|string, mixed>  $members */
    private static function object(array $members): string
    {
        $names = array_map('strval', array_keys($members));
        usort($names, fn (string $a, string $b) => strcmp(self::utf16($a), self::utf16($b)));

        $parts = [];
        foreach ($names as $name) {
            $parts[] = self::string($name).':'.self::canonicalize($members[$name]);
        }

        return '{'.implode(',', $parts).'}';
    }

    private static function utf16(string $value): string
    {
        $converted = mb_convert_encoding($value, 'UTF-16BE', 'UTF-8');

        return is_string($converted) ? $converted : $value;
    }

    private static function string(string $value): string
    {
        if (! mb_check_encoding($value, 'UTF-8')) {
            throw new InvalidArgumentException('JCS: a string is not valid UTF-8');
        }

        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR);
    }

    /** ECMAScript Number::toString of a finite double. */
    private static function number(float $value): string
    {
        if (is_nan($value) || is_infinite($value)) {
            throw new InvalidArgumentException('JCS: a number must be finite');
        }
        if ($value == 0.0) {
            return '0';
        }

        $previous = ini_get('serialize_precision');
        ini_set('serialize_precision', '-1');
        try {
            $shortest = json_encode(abs($value), JSON_THROW_ON_ERROR);
        } finally {
            ini_set('serialize_precision', (string) $previous);
        }

        // The shortest round-trip digits and the decimal exponent n such
        // that the value is 0.d1d2...dk x 10^n.
        [$mantissa, $exponent] = array_pad(preg_split('/e/i', $shortest), 2, '0');
        [$whole, $fraction] = array_pad(explode('.', $mantissa), 2, '');
        $digits = ltrim($whole.$fraction, '0');
        $n = strlen($whole) + (int) $exponent - (strlen($whole.$fraction) - strlen(ltrim($whole.$fraction, '0')));
        $digits = rtrim($digits, '0');
        $k = strlen($digits);

        if ($k <= $n && $n <= 21) {
            $text = $digits.str_repeat('0', $n - $k);
        } elseif ($n > 0 && $n <= 21) {
            $text = substr($digits, 0, $n).'.'.substr($digits, $n);
        } elseif ($n > -6 && $n <= 0) {
            $text = '0.'.str_repeat('0', -$n).$digits;
        } else {
            $e = $n - 1;
            $text = ($k === 1 ? $digits : $digits[0].'.'.substr($digits, 1)).'e'.($e < 0 ? '-' : '+').abs($e);
        }

        return ($value < 0 ? '-' : '').$text;
    }
}
