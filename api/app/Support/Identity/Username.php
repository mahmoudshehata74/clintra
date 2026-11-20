<?php

namespace App\Support\Identity;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Usernames ("A1 decisions", 1): 3 to 32 characters of a-z, 0-9, ".", "_"
 * and "-", stored lowercase, unique per organization. Latin, so a keyboard's
 * language never changes what is typed; display names stay Arabic.
 */
final class Username
{
    public const PATTERN = '/^[a-z0-9._-]{3,32}$/';

    /** The stored form, or null when the input can never be a username. */
    public static function normalize(string $username): ?string
    {
        $lowered = strtolower(trim($username));

        return preg_match(self::PATTERN, $lowered) === 1 ? $lowered : null;
    }

    public static function invalid(): JsonResponse
    {
        return response()->json([
            'error' => 'username_invalid',
            'message' => 'اسم المستخدم لازم يكون من 3 لـ 32 حرف: حروف إنجليزي صغيرة أو أرقام أو . أو _ أو -',
        ], 422);
    }

    public static function taken(): JsonResponse
    {
        return response()->json([
            'error' => 'username_taken',
            'message' => 'اسم المستخدم ده مستخدم قبل كده',
        ], 409);
    }

    /**
     * One ledger row for a membership whose rev the server moved (its
     * username changed), attributed like StaffController's rows: the
     * request's membership and device, on the caller's organization. The
     * organization's devices then pull the row's new rev, so their next edit
     * of that member is not refused as stale. Call after SyncSeqLock::acquire().
     */
    public static function recordInLedger(string $membershipId, int $rev, string $deviceId): void
    {
        $session = DB::selectOne('select current_org() as org_id, current_membership() as membership_id');
        $now = now()->toIso8601String();

        DB::table('sync_ledger')->insert([
            'op_id' => (string) Str::uuid(),
            'org_id' => $session->org_id,
            'entity' => 'memberships',
            'entity_id' => $membershipId,
            'rev' => $rev,
            'actor_membership_id' => $session->membership_id,
            'device_id' => $deviceId,
            'applied_at' => $now,
            'client_created_at' => $now,
        ]);
    }
}
