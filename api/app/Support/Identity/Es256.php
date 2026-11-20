<?php

namespace App\Support\Identity;

/**
 * ECDSA P-256 / SHA-256 signatures as WebCrypto makes them
 * (docs/design-identity-permissions.md, 3.1 and 3.4): the public key is a JWK
 * ({kty: "EC", crv: "P-256", x, y}, base64url coordinates of 32 bytes), the
 * signature IEEE P1363 `r || s` (64 bytes, base64url). OpenSSL wants the key
 * as SubjectPublicKeyInfo PEM and the signature as DER, so both are rebuilt
 * here; nothing else is accepted, and every malformed input verifies false.
 */
final class Es256
{
    /** DER prefix of a P-256 SubjectPublicKeyInfo, before the 65-byte uncompressed point. */
    private const SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

    public static function base64UrlDecode(string $value): ?string
    {
        if ($value === '' || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1) {
            return null;
        }

        $decoded = base64_decode(strtr($value, '-_', '+/').str_repeat('=', (4 - strlen($value) % 4) % 4), true);

        return $decoded === false ? null : $decoded;
    }

    public static function base64UrlEncode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /** A P-256 public JWK whose point is on the curve, or false. */
    public static function isPublicJwk(mixed $jwk): bool
    {
        return self::pem($jwk) !== null;
    }

    /**
     * The key as PEM, or null for anything but a valid P-256 public JWK.
     * OpenSSL refuses a point that is not on the curve.
     */
    public static function pem(mixed $jwk): ?string
    {
        if (! is_array($jwk) || ($jwk['kty'] ?? null) !== 'EC' || ($jwk['crv'] ?? null) !== 'P-256'
            || ! is_string($jwk['x'] ?? null) || ! is_string($jwk['y'] ?? null)) {
            return null;
        }

        $x = self::base64UrlDecode($jwk['x']);
        $y = self::base64UrlDecode($jwk['y']);

        if ($x === null || $y === null || strlen($x) !== 32 || strlen($y) !== 32) {
            return null;
        }

        $der = hex2bin(self::SPKI_PREFIX)."\x04".$x.$y;
        $pem = "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END PUBLIC KEY-----\n";

        return openssl_pkey_get_public($pem) === false ? null : $pem;
    }

    public static function verify(mixed $jwk, string $message, string $signature): bool
    {
        $pem = self::pem($jwk);
        $raw = self::base64UrlDecode($signature);

        if ($pem === null || $raw === null || strlen($raw) !== 64) {
            return false;
        }

        return openssl_verify($message, self::derSignature($raw), $pem, OPENSSL_ALGO_SHA256) === 1;
    }

    /** P1363 r || s to the DER SEQUENCE { INTEGER r, INTEGER s } OpenSSL verifies. */
    private static function derSignature(string $raw): string
    {
        $integer = function (string $bytes): string {
            $bytes = ltrim($bytes, "\x00");
            if ($bytes === '' || ord($bytes[0]) & 0x80) {
                $bytes = "\x00".$bytes;
            }

            return "\x02".chr(strlen($bytes)).$bytes;
        };

        $body = $integer(substr($raw, 0, 32)).$integer(substr($raw, 32, 32));

        return "\x30".chr(strlen($body)).$body;
    }
}
