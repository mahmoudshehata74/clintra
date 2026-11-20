<?php

namespace App\Support\Identity;

use Normalizer;

/**
 * Staff passwords (docs/design-identity-permissions.md, 3.7, and its owner
 * decision 8): Argon2id through PHP's password_hash, 64 MiB, 3 passes, one
 * lane by default (config/identity.php; tests use a cheap override, as
 * BCRYPT_ROUNDS is today). Input is NFC-normalised before hashing or
 * verifying, so the same password typed on two keyboards is the same bytes.
 *
 * Rules: 10 to 128 characters of any script; not the username; not in
 * contract/common-passwords.txt (compared case-insensitively); no
 * composition rules, no expiry.
 *
 * Nothing here logs: neither a password, nor a hash.
 */
final class Password
{
    public const MIN_LENGTH = 10;

    public const MAX_LENGTH = 128;

    /** No 0/O, 1/l/I: a temporary password is read aloud or copied from a screen. */
    private const TEMPORARY_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    private const TEMPORARY_LENGTH = 12;

    private static ?string $dummyHash = null;

    private static ?string $dummyOptions = null;

    /** @var array<string, true>|null */
    private static ?array $common = null;

    /** @return array{memory_cost: int, time_cost: int, threads: int} */
    public static function options(): array
    {
        return [
            'memory_cost' => (int) config('identity.argon.memory_cost'),
            'time_cost' => (int) config('identity.argon.time_cost'),
            'threads' => (int) config('identity.argon.threads'),
        ];
    }

    public static function normalize(string $password): string
    {
        $normalized = Normalizer::normalize($password, Normalizer::FORM_C);

        return is_string($normalized) ? $normalized : $password;
    }

    public static function hash(string $password): string
    {
        return password_hash(self::normalize($password), PASSWORD_ARGON2ID, self::options());
    }

    /**
     * Verifies against the stored hash, or — for an unknown username — against
     * a fixed dummy hash of the same parameters, so both take the same time
     * and fail the same way.
     */
    public static function verify(string $password, ?string $hash): bool
    {
        $matches = password_verify(self::normalize($password), $hash ?? self::dummyHash());

        return $hash !== null && $matches;
    }

    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_ARGON2ID, self::options());
    }

    /**
     * The Arabic line that refuses a new password, or null when it may be set.
     */
    public static function problem(string $password, ?string $username): ?string
    {
        $normalized = self::normalize($password);
        $length = mb_strlen($normalized, 'UTF-8');

        if ($length < self::MIN_LENGTH) {
            return 'كلمة السر لازم تكون 10 حروف على الأقل';
        }
        if ($length > self::MAX_LENGTH) {
            return 'كلمة السر لازم تكون 128 حرف بالكتير';
        }

        $lowered = mb_strtolower($normalized, 'UTF-8');

        if (($username !== null && $lowered === mb_strtolower($username, 'UTF-8')) || isset(self::common()[$lowered])) {
            return 'كلمة السر دي سهلة أوي، اختار غيرها';
        }

        return null;
    }

    public static function temporary(): string
    {
        $password = '';
        for ($i = 0; $i < self::TEMPORARY_LENGTH; $i++) {
            $password .= self::TEMPORARY_ALPHABET[random_int(0, strlen(self::TEMPORARY_ALPHABET) - 1)];
        }

        return $password;
    }

    private static function dummyHash(): string
    {
        $options = json_encode(self::options());

        if (self::$dummyHash === null || self::$dummyOptions !== $options) {
            self::$dummyHash = password_hash(bin2hex(random_bytes(16)), PASSWORD_ARGON2ID, self::options());
            self::$dummyOptions = $options;
        }

        return self::$dummyHash;
    }

    /** @return array<string, true> */
    private static function common(): array
    {
        if (self::$common === null) {
            $lines = file(base_path('../contract/common-passwords.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            self::$common = array_fill_keys(array_map(fn (string $line) => mb_strtolower(trim($line), 'UTF-8'), $lines ?: []), true);
        }

        return self::$common;
    }
}
