<?php

namespace App\Http\Controllers;

use App\Support\ActivationCode;
use App\Support\EgyptianPhone;
use App\Support\Identity\AuthCall;
use App\Support\Identity\AuthCallFailed;
use App\Support\Identity\Es256;
use App\Support\Identity\Identity;
use App\Support\Identity\Password;
use App\Support\Identity\RequestProof;
use App\Support\Identity\StepUp;
use App\Support\Identity\Username;
use App\Support\Sync\SyncSeqLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

/**
 * Signing in, changing one's own password, and owner recovery
 * (docs/design-identity-permissions.md, 3.2, 3.7 and 6.5, and "A1
 * decisions"). Every route runs behind `membership` (the device token),
 * `throttle:auth` and `device.proof`, inside the request's one transaction;
 * every auth function runs through AuthCall, in its own savepoint, so a
 * refusal leaves the transaction usable and the failed attempt it recorded
 * is kept, and no failure carries its payload into a log.
 *
 * Nothing here logs a password, a hash, a proof or a key.
 */
class AuthController extends Controller
{
    private const RECOVERY_MAX_ATTEMPTS = 5;

    private const RECOVERY_DECAY_SECONDS = 900;

    private const RECOVERY_MAX_ORG_ATTEMPTS = 30;

    private const RECOVERY_ORG_DECAY_SECONDS = 86400;

    /**
     * POST /api/auth/login: auth_login_begin (rate limits, the stored hash or
     * none), password_verify here (Argon2id, against a dummy hash for an
     * unknown username), then auth_login_complete (the new credential, the
     * device key when unbound, the audit row, the attempt marked succeeded).
     */
    public function login(Request $request): JsonResponse
    {
        $deviceId = (string) $request->attributes->get('device_id');
        $input = $request->validate([
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'max:1024'],
            'credential_id' => ['required', 'uuid'],
            'credential_public_key' => ['required', 'array'],
            'device_public_key' => ['present', 'nullable', 'array'],
        ]);

        if (! Es256::isPublicJwk($input['credential_public_key'])
            || ($input['device_public_key'] !== null && ! Es256::isPublicJwk($input['device_public_key']))) {
            return $this->invalid();
        }

        // A device with a bound key proved it already (device.proof). A device
        // binding its key now proves it holds that key: the request carries
        // the new key's own device proof.
        if (Identity::enforced($request) && $request->attributes->get('device_proof_verified') !== true && $input['device_public_key'] === null) {
            return $this->unauthenticated();
        }
        $deviceKey = null;
        if ($request->attributes->get('device_proof_verified') !== true && $input['device_public_key'] !== null) {
            if (! RequestProof::verifyDevice($request, $deviceId, $input['device_public_key'])) {
                return $this->unauthenticated();
            }
            $deviceKey = $input['device_public_key'];
        }

        try {
            $begin = AuthCall::run('auth_login_begin', ['device_id' => $deviceId, 'username' => $input['username'], 'kind' => 'login']);
        } catch (AuthCallFailed $e) {
            return match ($e->sqlState) {
                'CL429' => StepUp::tooManyAttempts(),
                'P0001' => $this->unauthenticated(),
                default => throw $e,
            };
        }

        if (! Password::verify($input['password'], $begin['password_hash'])) {
            return $this->wrongCredentials();
        }

        $payload = [
            'device_id' => $deviceId,
            'attempt_id' => $begin['attempt_id'],
            'membership_id' => $begin['membership_id'],
            'credential_id' => strtolower($input['credential_id']),
            'credential_public_key' => $input['credential_public_key'],
            'device_public_key' => $deviceKey,
            'rehash' => Password::needsRehash($begin['password_hash']) ? Password::hash($input['password']) : null,
            'audit_id' => (string) Str::uuid(),
        ];

        try {
            $result = AuthCall::run('auth_login_complete', $payload);
        } catch (AuthCallFailed $e) {
            return match ($e->sqlState) {
                'P0001' => $this->wrongCredentials(),
                '23505' => $this->invalid(),
                default => throw $e,
            };
        }

        return response()->json([...$result, 'credential_id' => $payload['credential_id']]);
    }

    /**
     * POST /api/auth/password: the proven person (person:required) changes
     * their own password, retyping the current one (or the temporary one).
     */
    public function changePassword(Request $request): JsonResponse
    {
        $person = $request->attributes->get('person');
        $input = $request->validate([
            'current_password' => ['required', 'string', 'max:1024'],
            'password' => ['required', 'string', 'max:1024'],
        ]);

        $attempt = StepUp::attempt((string) $request->attributes->get('device_id'), $person['membership_id'], $input['current_password']);
        if ($attempt instanceof JsonResponse) {
            return $attempt;
        }

        $username = DB::table('memberships')->where('id', $person['membership_id'])->value('username');
        $problem = Password::problem($input['password'], $username);
        if ($problem !== null) {
            return response()->json(['error' => 'password_rejected', 'message' => $problem], 422);
        }

        AuthCall::run('auth_set_password', [
            'membership_id' => $person['membership_id'],
            'new_hash' => Password::hash($input['password']),
            'attempt_id' => $attempt,
            'audit_id' => (string) Str::uuid(),
        ]);

        return response()->json(['must_change_password' => false]);
    }

    /**
     * POST /api/auth/owner-recovery: the owner's phone, a CLI-minted
     * owner-recovery code, their username and a new password, from a device
     * of the clinic. The same generic failure for every credential problem,
     * rate limited like registration (per IP, per code, per organization).
     */
    public function recoverOwner(Request $request): JsonResponse
    {
        $deviceId = (string) $request->attributes->get('device_id');
        $input = $request->validate([
            'phone' => ['required', 'string'],
            'code' => ['required', 'string', 'max:64'],
            'username' => ['required', 'string', 'max:64'],
            'password' => ['required', 'string', 'max:1024'],
        ]);

        try {
            $phone = EgyptianPhone::normalize($input['phone']);
        } catch (InvalidArgumentException) {
            return $this->invalid();
        }

        $username = Username::normalize($input['username']);
        if ($username === null) {
            return Username::invalid();
        }

        $codeHash = ActivationCode::hash(strtoupper(trim($input['code'])));
        $ipKey = 'owner-recovery:ip:'.$request->ip();
        $codeKey = 'owner-recovery:code:'.$codeHash;
        $orgId = $this->registrationOrg($phone, $codeHash);
        $orgKey = $orgId === null ? null : 'owner-recovery:org:'.$orgId;

        if (($orgKey !== null && RateLimiter::tooManyAttempts($orgKey, self::RECOVERY_MAX_ORG_ATTEMPTS))
            || RateLimiter::tooManyAttempts($ipKey, self::RECOVERY_MAX_ATTEMPTS)
            || RateLimiter::tooManyAttempts($codeKey, self::RECOVERY_MAX_ATTEMPTS)) {
            return StepUp::tooManyAttempts();
        }

        $problem = Password::problem($input['password'], $username);
        if ($problem !== null) {
            return response()->json(['error' => 'password_rejected', 'message' => $problem], 422);
        }

        SyncSeqLock::acquire();

        try {
            $result = AuthCall::run('auth_recover_owner', [
                'code_hash' => $codeHash,
                'phone' => $phone,
                'username' => $username,
                'new_hash' => Password::hash($input['password']),
                'device_id' => $deviceId,
                'audit_id' => (string) Str::uuid(),
            ]);
        } catch (AuthCallFailed $e) {
            if ($e->sqlState === '23505') {
                return Username::taken();
            }
            if ($e->sqlState !== 'P0001') {
                throw $e;
            }

            RateLimiter::hit($ipKey, self::RECOVERY_DECAY_SECONDS);
            RateLimiter::hit($codeKey, self::RECOVERY_DECAY_SECONDS);
            if ($orgKey !== null) {
                RateLimiter::hit($orgKey, self::RECOVERY_ORG_DECAY_SECONDS);
            }

            return response()->json(['error' => 'recovery_failed', 'message' => 'البيانات دي مش صح'], 401);
        }

        RateLimiter::clear($ipKey);
        RateLimiter::clear($codeKey);
        if ($orgKey !== null) {
            RateLimiter::clear($orgKey);
        }

        // A username set here moved the membership's rev: the organization's
        // devices learn the new rev from the ledger, as for any server write.
        if ($result['username_set']) {
            Username::recordInLedger($result['membership_id'], (int) $result['rev'], $deviceId);
        }

        return response()->json(['membership_id' => $result['membership_id'], 'username' => $result['username']]);
    }

    private function registrationOrg(string $phone, string $codeHash): ?string
    {
        try {
            $row = DB::transaction(fn () => DB::selectOne('select resolve_registration_org(?::jsonb) as org_id', [
                json_encode(['phone' => $phone, 'code_hash' => $codeHash], JSON_THROW_ON_ERROR),
            ]));

            return $row->org_id ?? null;
        } catch (Throwable) {
            return null;
        }
    }

    private function wrongCredentials(): JsonResponse
    {
        return response()->json(['error' => 'invalid_credentials', 'message' => 'اسم المستخدم أو كلمة السر غلط'], 401);
    }

    private function unauthenticated(): JsonResponse
    {
        return response()->json(['error' => 'unauthenticated', 'message' => 'يجب تسجيل الدخول'], 401);
    }

    private function invalid(): JsonResponse
    {
        return response()->json(['error' => 'validation_failed', 'message' => 'بيانات غير صالحة'], 422);
    }
}
