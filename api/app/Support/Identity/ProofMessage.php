<?php

namespace App\Support\Identity;

use App\Support\Sync\Jcs;
use stdClass;

/**
 * The exact bytes a device or person key signs
 * (docs/design-identity-permissions.md, 3.4 and 3.5). Every field is taken
 * from the request as sent — the raw body, decoded with objects kept — never
 * from input Laravel's TrimStrings / ConvertEmptyStringsToNull rewrote.
 */
final class ProofMessage
{
    /** clintra-req-v1: one HTTP request (the device proof, and a person proof of an endpoint call). */
    public static function request(string $method, string $pathWithQuery, int $unixMs, string $nonce, string $rawBody): string
    {
        return implode("\n", [
            'clintra-req-v1', strtoupper($method), $pathWithQuery, (string) $unixMs, $nonce, hash('sha256', $rawBody),
        ]);
    }

    /**
     * clintra-op-v1: one sync op, as it appears in the pushed body.
     */
    public static function op(stdClass $op, string $deviceId, string $credentialId): string
    {
        $payloadHash = ($op->action ?? null) === 'delete' || ! property_exists($op, 'payload')
            ? '-'
            : hash('sha256', Jcs::canonicalize($op->payload));

        return implode("\n", [
            'clintra-op-v1',
            self::text($op->op_id ?? null),
            $deviceId,
            $credentialId,
            self::text($op->entity ?? null),
            self::text($op->entity_id ?? null),
            self::text($op->action ?? null),
            self::orDash($op->base_rev ?? null),
            self::orDash($op->group_id ?? null),
            self::text($op->created_at ?? null),
            $payloadHash,
        ]);
    }

    /** clintra-audit-v1: one device audit row, as it appears in the pushed body. */
    public static function audit(stdClass $row, string $deviceId, string $credentialId): string
    {
        $record = new stdClass;
        $record->after = property_exists($row, 'after') ? $row->after : null;
        $record->before = property_exists($row, 'before') ? $row->before : null;

        return implode("\n", [
            'clintra-audit-v1',
            self::text($row->id ?? null),
            $deviceId,
            $credentialId,
            self::text($row->entity ?? null),
            self::text($row->entity_id ?? null),
            self::text($row->action ?? null),
            self::text($row->at ?? null),
            hash('sha256', Jcs::canonicalize($record)),
        ]);
    }

    private static function text(mixed $value): string
    {
        return is_string($value) || is_int($value) ? (string) $value : '';
    }

    private static function orDash(mixed $value): string
    {
        return $value === null ? '-' : self::text($value);
    }
}
