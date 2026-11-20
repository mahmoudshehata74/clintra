<?php

namespace App\Http\Controllers;

use App\Support\Identity\AuthCall;
use App\Support\Identity\AuthCallFailed;
use App\Support\Identity\Password;
use App\Support\Identity\StepUp;
use App\Support\Identity\Username;
use App\Support\Sync\SyncSeqLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * A member's identity, managed online (docs/design-identity-permissions.md,
 * 3.7 and 6.5, and "A1 decisions", 1): resetting a member's password and
 * revoking a credential (person proof and step-up), and setting a username
 * (owner only). Who may do what is the functions' decision; every refusal
 * about who is asking or what exists renders like a route that does not
 * exist — 404, as POST /api/staff does.
 */
class StaffIdentityController extends Controller
{
    /**
     * POST /api/staff/{membership}/password-reset: a 12-character temporary
     * password, shown once in this response and never stored in plain text;
     * every credential the member holds is revoked.
     */
    public function resetPassword(Request $request, string $membership): JsonResponse
    {
        if (! Str::isUuid($membership)) {
            return $this->notFound();
        }

        $input = $request->validate(['password' => ['required', 'string', 'max:1024']]);
        $person = $request->attributes->get('person');

        $attempt = StepUp::attempt((string) $request->attributes->get('device_id'), $person['membership_id'], $input['password']);
        if ($attempt instanceof JsonResponse) {
            return $attempt;
        }

        $temporary = Password::temporary();

        try {
            AuthCall::run('auth_reset_member_password', [
                'target_membership_id' => strtolower($membership),
                'temporary_hash' => Password::hash($temporary),
                'attempt_id' => $attempt,
                'audit_id' => (string) Str::uuid(),
            ]);
        } catch (AuthCallFailed $e) {
            return match ($e->sqlState) {
                'P0001' => $this->notFound(),
                'CL422' => response()->json([
                    'error' => 'username_required',
                    'message' => 'حدد اسم مستخدم للموظف ده الأول',
                ], 422),
                default => throw $e,
            };
        }

        return response()->json(['temporary_password' => $temporary, 'must_change_password' => true]);
    }

    /** DELETE /api/staff/credentials/{credential}: the member signs in again on that device. */
    public function revokeCredential(Request $request, string $credential): JsonResponse
    {
        if (! Str::isUuid($credential)) {
            return $this->notFound();
        }

        $input = $request->validate(['password' => ['required', 'string', 'max:1024']]);
        $person = $request->attributes->get('person');

        $attempt = StepUp::attempt((string) $request->attributes->get('device_id'), $person['membership_id'], $input['password']);
        if ($attempt instanceof JsonResponse) {
            return $attempt;
        }

        try {
            AuthCall::run('auth_revoke_credential', [
                'credential_id' => strtolower($credential),
                'attempt_id' => $attempt,
                'audit_id' => (string) Str::uuid(),
            ]);
        } catch (AuthCallFailed $e) {
            return $e->sqlState === 'P0001' ? $this->notFound() : throw $e;
        }

        return response()->json(['revoked' => true]);
    }

    /**
     * PUT /api/staff/{membership}/username: owner only — the device token's
     * membership, or the proven person once the organization is enforced.
     * A changed username moves the membership's rev, recorded in the ledger
     * for the organization's devices to pull.
     */
    public function setUsername(Request $request, string $membership): JsonResponse
    {
        $deviceId = $request->attributes->get('device_id');

        if ($deviceId === null) {
            return response()->json(['error' => 'unauthenticated', 'message' => 'يجب تسجيل الدخول'], 401);
        }
        if (! Str::isUuid($membership)) {
            return $this->notFound();
        }

        $input = $request->validate(['username' => ['required', 'string', 'max:64']]);
        $username = Username::normalize($input['username']);

        if ($username === null) {
            return Username::invalid();
        }

        SyncSeqLock::acquire();

        try {
            $result = AuthCall::run('auth_set_username', [
                'membership_id' => strtolower($membership),
                'username' => $username,
                'audit_id' => (string) Str::uuid(),
            ]);
        } catch (AuthCallFailed $e) {
            return match ($e->sqlState) {
                'P0001' => $this->notFound(),
                '23505' => Username::taken(),
                '22023' => Username::invalid(),
                default => throw $e,
            };
        }

        if ($result['changed']) {
            Username::recordInLedger($result['membership_id'], (int) $result['rev'], $deviceId);
        }

        return response()->json([
            'membership_id' => $result['membership_id'],
            'username' => $result['username'],
            'rev' => $result['rev'],
        ]);
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['error' => 'not_found', 'message' => 'لم يتم العثور على المورد'], 404);
    }
}
