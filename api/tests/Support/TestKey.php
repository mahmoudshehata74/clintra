<?php

namespace Tests\Support;

use App\Support\Identity\Es256;
use OpenSSLAsymmetricKey;
use RuntimeException;

/**
 * A P-256 key pair standing in for a device's or a person's WebCrypto key in
 * tests: its public half as the JWK a device sends, and signatures in
 * WebCrypto's IEEE P1363 `r || s` form, base64url.
 */
final class TestKey
{
    /** @param  array{kty: string, crv: string, x: string, y: string}  $jwk */
    private function __construct(private readonly OpenSSLAsymmetricKey $private, public readonly array $jwk) {}

    public static function make(): self
    {
        $options = ['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1'];

        // Windows PHP builds find no openssl.cnf on their own (key generation
        // fails with "no such file"); they ship one beside the binary.
        $bundled = dirname(PHP_BINARY).'/extras/ssl/openssl.cnf';
        if (getenv('OPENSSL_CONF') === false && is_file($bundled)) {
            $options['config'] = $bundled;
        }

        $key = openssl_pkey_new($options);
        if ($key === false) {
            throw new RuntimeException('could not make a P-256 key');
        }

        $ec = openssl_pkey_get_details($key)['ec'];

        return new self($key, [
            'kty' => 'EC',
            'crv' => 'P-256',
            'x' => Es256::base64UrlEncode(str_pad($ec['x'], 32, "\0", STR_PAD_LEFT)),
            'y' => Es256::base64UrlEncode(str_pad($ec['y'], 32, "\0", STR_PAD_LEFT)),
        ]);
    }

    public function sign(string $message): string
    {
        openssl_sign($message, $der, $this->private, OPENSSL_ALGO_SHA256);

        return Es256::base64UrlEncode(self::p1363($der));
    }

    /** DER SEQUENCE { INTEGER r, INTEGER s } to 64 bytes r || s. */
    private static function p1363(string $der): string
    {
        $offset = 2;
        if (ord($der[1]) & 0x80) {
            $offset += ord($der[1]) & 0x7F;
        }

        $parts = [];
        for ($i = 0; $i < 2; $i++) {
            $length = ord($der[$offset + 1]);
            $parts[] = str_pad(ltrim(substr($der, $offset + 2, $length), "\0"), 32, "\0", STR_PAD_LEFT);
            $offset += 2 + $length;
        }

        return $parts[0].$parts[1];
    }
}
