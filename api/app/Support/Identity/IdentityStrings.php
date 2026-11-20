<?php

namespace App\Support\Identity;

final class IdentityStrings
{
    public static function get(string $key): string
    {
        static $strings;
        $strings ??= json_decode(file_get_contents(base_path('../contract/identity-strings.json')), true, flags: JSON_THROW_ON_ERROR);

        return $strings[$key];
    }
}
