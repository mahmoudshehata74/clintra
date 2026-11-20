<?php

namespace App\Support\Identity;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Proofs carried by a request (docs/design-identity-permissions.md, 3.4 and
 * 6.5):
 *
 *     X-Clintra-Device-Proof: v1.<unix_ms>.<nonce>.<signature>
 *     X-Clintra-Person-Proof: v1.<credential_id>.<unix_ms>.<nonce>.<signature>
 *
 * Both sign ProofMessage::request() — the method, the path with its query as
 * sent, the time, the nonce and the SHA-256 of the raw body — the first with
 * the device key, the second with a person's key on that device. A proof is
 * good within ±5 minutes of the server's clock, and each nonce once per
 * device (or per credential) for 10 minutes. A nonce is spent only by a proof
 * whose signature verified, so garbage never fills the cache.
 */
final class RequestProof
{
    public const DEVICE_HEADER = 'X-Clintra-Device-Proof';

    public const PERSON_HEADER = 'X-Clintra-Person-Proof';

    public const WINDOW_MS = 300000;

    public const NONCE_TTL_SECONDS = 600;

    public static function verifyDevice(Request $request, string $deviceId, mixed $publicKey): bool
    {
        $header = $request->header(self::DEVICE_HEADER);

        if (! is_string($header) || preg_match('/^v1\.(\d{1,15})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{86})$/', $header, $m) !== 1) {
            return false;
        }

        return self::verify($request, (int) $m[1], $m[2], $m[3], $publicKey, 'device-nonce:'.$deviceId);
    }

    /**
     * The credential a person proof names, or null when the header is absent
     * or malformed.
     *
     * @return array{credential_id: string, unix_ms: int, nonce: string, signature: string}|null
     */
    public static function parsePerson(Request $request): ?array
    {
        $header = $request->header(self::PERSON_HEADER);

        if (! is_string($header)
            || preg_match('/^v1\.([0-9a-fA-F-]{36})\.(\d{1,15})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{86})$/', $header, $m) !== 1
            || ! Str::isUuid($m[1])) {
            return null;
        }

        return ['credential_id' => strtolower($m[1]), 'unix_ms' => (int) $m[2], 'nonce' => $m[3], 'signature' => $m[4]];
    }

    /** @param  array{credential_id: string, unix_ms: int, nonce: string, signature: string}  $proof */
    public static function verifyPerson(Request $request, array $proof, mixed $publicKey): bool
    {
        return self::verify($request, $proof['unix_ms'], $proof['nonce'], $proof['signature'], $publicKey,
            'person-nonce:'.$proof['credential_id']);
    }

    public static function withinWindow(int $unixMs): bool
    {
        return abs(now()->getTimestampMs() - $unixMs) <= self::WINDOW_MS;
    }

    private static function verify(Request $request, int $unixMs, string $nonce, string $signature, mixed $publicKey, string $noncePrefix): bool
    {
        if (! self::withinWindow($unixMs)) {
            return false;
        }

        $message = ProofMessage::request($request->getMethod(), $request->getRequestUri(), $unixMs, $nonce, $request->getContent());

        if (! Es256::verify($publicKey, $message, $signature)) {
            return false;
        }

        return Cache::add($noncePrefix.':'.$nonce, true, self::NONCE_TTL_SECONDS);
    }
}
