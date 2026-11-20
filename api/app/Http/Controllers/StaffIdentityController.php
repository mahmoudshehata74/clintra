<?php

namespace App\Http\Controllers;

use App\Support\Identity\AuthCall;
use App\Support\Identity\AuthCallFailed;
use App\Support\Identity\Identity;
use App\Support\Identity\Password;
use App\Support\Identity\StepUp;
use App\Support\Identity\Username;
use App\Support\Sync\SyncSeqLock;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

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
     * PUT /api/staff/{membership}/username: a proven owner with a fresh step-up.
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

        $person = $request->attributes->get('person');
        if ($person['role'] !== 'owner') {
            return $this->notFound();
        }
        $input = $request->validate([
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'max:1024'],
        ]);
        $username = Username::normalize($input['username']);

        if ($username === null) {
            return Username::invalid();
        }

        $attempt = StepUp::attempt($deviceId, $person['membership_id'], $input['password']);
        if ($attempt instanceof JsonResponse) {
            return $attempt;
        }

        SyncSeqLock::acquire();

        try {
            $result = AuthCall::run('auth_set_username', [
                'membership_id' => strtolower($membership),
                'username' => $username,
                'audit_id' => (string) Str::uuid(),
                'attempt_id' => $attempt,
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

    /** Live sign-ins visible to the caller. Each target follows the revoke rule. */
    public function credentials(Request $request): JsonResponse
    {
        $person = $request->attributes->get('person');
        $owner = $person['role'] === 'owner';
        if (! $owner && ! in_array('staff.manage', $person['permissions'], true)) {
            return $this->notFound();
        }
        $rows = DB::table('member_credentials as c')
            ->join('memberships as m', 'm.id', '=', 'c.membership_id')
            ->join('device as d', 'd.id', '=', 'c.device_id')
            ->whereNull('c.revoked_at')->whereNull('d.revoked_at')
            ->orderBy('c.created_at')->orderBy('c.id')
            ->get(['c.id', 'c.membership_id', 'c.device_id', 'c.created_at', 'd.location_id', 'd.series', 'm.role', 'm.permissions']);

        return response()->json(['credentials' => $rows->filter(fn (object $row) => $owner || (
            $row->membership_id !== $person['membership_id']
            && ! in_array($row->role, ['owner', 'practitioner'], true)
            && array_diff(Identity::parseTextArray($row->permissions), $person['permissions']) === []
        ))->map(fn (object $row) => [
            'id' => $row->id, 'membership_id' => $row->membership_id, 'device_id' => $row->device_id,
            'location_id' => $row->location_id, 'series' => $row->series, 'created_at' => $row->created_at,
        ])->values()]);
    }

    /** Update permissions as clintra_app through the membership RLS policy and guard trigger. */
    public function setPermissions(Request $request, string $membership): JsonResponse
    {
        $person = $request->attributes->get('person');
        $owner = $person['role'] === 'owner';
        if (! Identity::enforced($request) || ! Str::isUuid($membership)
            || strtolower($membership) === $person['membership_id']
            || (! $owner && ! in_array('staff.manage', $person['permissions'], true))) {
            return $this->notFound();
        }
        $input = $request->validate([
            'permissions' => ['present', 'array', 'list', 'max:10'],
            'permissions.*' => ['required', 'string', 'distinct:strict', Rule::in(Identity::PERMISSIONS)],
            'password' => ['required', 'string', 'max:1024'],
        ]);
        $deviceId = $request->attributes->get('device_id');
        $attempt = StepUp::attempt($deviceId, $person['membership_id'], $input['password']);
        if ($attempt instanceof JsonResponse) {
            return $attempt;
        }
        SyncSeqLock::acquire();
        try {
            return DB::transaction(function () use ($membership, $input, $attempt, $deviceId, $person, $owner) {
                $target = DB::table('memberships')->where('id', $membership)->lockForUpdate()->first();
                if ($target === null || (! $owner && $target->role === 'owner')) {
                    return $this->notFound();
                }
                $old = Identity::parseTextArray($target->permissions);
                $new = $input['permissions'];
                $difference = [...array_diff($old, $new), ...array_diff($new, $old)];
                if (! $owner && array_diff($difference, $person['permissions']) !== []) {
                    return $this->notFound();
                }
                AuthCall::run('auth_consume_staff_step_up', ['attempt_id' => $attempt]);
                if ($difference !== []) {
                    DB::table('memberships')->where('id', $target->id)->update(['permissions' => '{'.implode(',', $new).'}']);
                    $target->rev = DB::table('memberships')->where('id', $target->id)->value('rev');
                    Username::recordInLedger($target->id, (int) $target->rev, $deviceId);
                    DB::table('audit_log')->insert([
                        'id' => (string) Str::uuid(), 'org_id' => $target->org_id, 'actor_membership_id' => $person['membership_id'],
                        'entity' => 'memberships', 'entity_id' => $target->id, 'action' => 'update',
                        'before' => json_encode(['permissions' => $old], JSON_THROW_ON_ERROR),
                        'after' => json_encode(['permissions' => $new], JSON_THROW_ON_ERROR), 'at' => now()->toIso8601String(),
                    ]);
                }

                return response()->json(['membership_id' => $target->id, 'permissions' => $difference === [] ? $old : $new, 'rev' => $target->rev]);
            });
        } catch (QueryException|AuthCallFailed $e) {
            $state = $e instanceof AuthCallFailed ? $e->sqlState : $e->getCode();
            return in_array($state, ['42501', 'P0001'], true) ? $this->notFound() : throw $e;
        }
    }

    private function notFound(): JsonResponse
    {
        return response()->json(['error' => 'not_found', 'message' => 'لم يتم العثور على المورد'], 404);
    }
}
