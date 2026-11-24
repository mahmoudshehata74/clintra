<?php

namespace App\Support;

final class Code
{
    private const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

    public static function generate(): string
    {
        $groups = [];
        for ($group = 0; $group < 4; $group++) {
            $part = '';
            for ($character = 0; $character < 4; $character++) {
                $part .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
            $groups[] = $part;
        }

        return 'CLT-'.implode('-', $groups);
    }

    public static function hash(string $code): string
    {
        return hash('sha256', $code);
    }
}
