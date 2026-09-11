<?php

namespace App\Support;

/**
 * Registration activation codes (docs/schema.md's activation_codes,
 * docs/auth-plan.md's registration credential resolution) — a one-time,
 * high-entropy secret an owner types into a new device, format
 * CLT-XXXX-XXXX-XXXX-XXXX from an alphabet excluding 0/O/1/I/L (visually
 * ambiguous when handwritten or read off a screen). Hashed with SHA-256,
 * not Argon2id — see PinHash's doc comment for the contrasting case that
 * needs a slow KDF; this is a high-entropy random secret, not a
 * low-entropy PIN, so a slow hash buys nothing but latency, and this
 * follows the exact convention Sanctum's own personal_access_tokens table
 * already uses for its own tokens.
 */
class ActivationCode
{
    private const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L

    private const GROUP_COUNT = 4;

    private const GROUP_LENGTH = 4;

    public const LIFETIME_HOURS = 72;

    /** A fresh plaintext code, e.g. "CLT-7F3K-9QRT-4XWM-2BCD". */
    public static function generate(): string
    {
        $groups = [];

        for ($i = 0; $i < self::GROUP_COUNT; $i++) {
            $group = '';

            for ($j = 0; $j < self::GROUP_LENGTH; $j++) {
                $group .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }

            $groups[] = $group;
        }

        return 'CLT-'.implode('-', $groups);
    }

    /** SHA-256 hex digest of a plaintext code, for storage/comparison. */
    public static function hash(string $plainTextCode): string
    {
        return hash('sha256', $plainTextCode);
    }
}
