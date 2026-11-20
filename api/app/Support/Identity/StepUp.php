<?php

namespace App\Support\Identity;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Step-up (docs/design-identity-permissions.md, 3.7, and "A1 decisions", 3):
 * the proven caller retypes their own password. It is an attempt like a
 * sign-in — auth_login_begin with kind step_up, which resolves only to the
 * caller, so the same failed-attempt limits apply — and on success
 * auth_attempt_succeeded marks it, so a successful step-up never counts
 * toward a limit. The functions that need one take its attempt id and refuse
 * without a succeeded step-up of the caller from the last 2 minutes.
 */
final class StepUp
{
    /**
     * @return int|JsonResponse the succeeded attempt's id, or the response refusing it
     */
    public static function attempt(string $deviceId, string $membershipId, string $password): int|JsonResponse
    {
        $username = DB::table('memberships')->where('id', $membershipId)->value('username');

        try {
            $begin = AuthCall::run('auth_login_begin', ['device_id' => $deviceId, 'username' => $username ?? '-', 'kind' => 'step_up']);
        } catch (AuthCallFailed $e) {
            return $e->sqlState === 'CL429' ? self::tooManyAttempts() : throw $e;
        }

        if (! Password::verify($password, $begin['password_hash']) || $begin['membership_id'] !== $membershipId) {
            return response()->json(['error' => 'step_up_failed', 'message' => 'كلمة السر غلط'], 403);
        }

        AuthCall::run('auth_attempt_succeeded', ['attempt_id' => $begin['attempt_id']]);

        return (int) $begin['attempt_id'];
    }

    public static function tooManyAttempts(): JsonResponse
    {
        return response()->json(['error' => 'too_many_attempts', 'message' => 'محاولات كتير، استنى شوية وجرّب تاني'], 429);
    }
}
