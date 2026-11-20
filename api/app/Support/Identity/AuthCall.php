<?php

namespace App\Support\Identity;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Calls one auth_* function in its own savepoint (a refusal leaves the
 * request's transaction usable). A QueryException's message carries the SQL
 * and its bindings — here a payload holding a password hash — so it never
 * leaves this class: a failure is rethrown as AuthCallFailed with only the
 * function and the SQLSTATE, and that is all an unexpected failure can put
 * in a log.
 */
final class AuthCall
{
    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>|null the function's jsonb result, null for a void function
     *
     * @throws AuthCallFailed
     */
    public static function run(string $function, array $payload): ?array
    {
        if (preg_match('/^auth_[a-z_]+$/', $function) !== 1) {
            throw new AuthCallFailed($function, '42883');
        }

        try {
            $row = DB::transaction(fn () => DB::selectOne(
                "select {$function}(?::jsonb)::text as result",
                [json_encode($payload, JSON_THROW_ON_ERROR)],
            ));
        } catch (QueryException $e) {
            throw new AuthCallFailed($function, (string) $e->getCode());
        }

        return $row->result === null || $row->result === '' ? null : json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);
    }
}
