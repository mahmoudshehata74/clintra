<?php

namespace App\Support;

/**
 * Staff PIN hashing (Layer 2, docs/auth-plan.md) — matches the web's
 * Argon2id implementation (web/src/auth/pinHash.ts) exactly, byte for byte,
 * so a hash created by either side verifies identically against the other.
 * Parameters come from contract/pin-hash.json, shared with the web client,
 * never duplicated here. See contract/README.md.
 *
 * sodium_crypto_pwhash's memlimit is bytes, not KiB — the one unit
 * difference from the web's @noble/hashes call, which takes m in KiB
 * directly. Both compute the same standardized (RFC 9106) Argon2id
 * algorithm with SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13 (not the default
 * password_hash()/PASSWORD_ARGON2ID, whose parameters and defaults are not
 * pinned the same way), so identical parameters + salt + PIN produce
 * identical output — verified against contract/pin-hash.json's testVector
 * by tests/Unit/PinHashTest.php.
 */
class PinHash
{
    /** @return array{t: int, m: int, p: int, dkLen: int, saltBytes: int} */
    public static function params(): array
    {
        $config = json_decode(
            file_get_contents(base_path('../contract/pin-hash.json')),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        return $config['argon2id'];
    }

    /** A fresh random per-membership salt, hex-encoded for storage in memberships.pin_salt. */
    public static function generateSalt(): string
    {
        return bin2hex(random_bytes(self::params()['saltBytes']));
    }

    /** Hashes a PIN with the given (hex) salt under the pinned Argon2id parameters; returns a hex digest. */
    public static function hash(string $pin, string $saltHex): string
    {
        $params = self::params();

        $digest = sodium_crypto_pwhash(
            $params['dkLen'],
            $pin,
            hex2bin($saltHex),
            $params['t'],
            $params['m'] * 1024,
            SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13,
        );

        return bin2hex($digest);
    }
}
