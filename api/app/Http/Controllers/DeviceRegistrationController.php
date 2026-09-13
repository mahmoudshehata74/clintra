<?php

namespace App\Http\Controllers;

use App\Http\Requests\RegisterDeviceRequest;
use App\Models\Device;
use App\Support\ActivationCode;
use App\Support\EgyptianPhone;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * POST /api/devices/register — the install-team flow's live counterpart to
 * php artisan clintra:provision (see docs/auth-plan.md's registration
 * credential resolution). No auth middleware: this endpoint IS how a
 * device gets its first credential, so nothing can gate it beforehand.
 *
 * Every credential failure (wrong code, expired, already used, wrong
 * phone) returns the exact same generic response — see
 * register_device(jsonb)'s own doc comment for why they are deliberately
 * not distinguished, in the database function or here.
 */
class DeviceRegistrationController extends Controller
{
    private const MAX_ATTEMPTS = 5;

    private const DECAY_SECONDS = 900;

    /**
     * A third layer, independent of the caller's claimed identity — see
     * 2026_09_12_000022_add_resolve_registration_org_function.php's own
     * doc comment for why the IP-keyed and code-keyed limits above aren't
     * enough on their own (docs/deployment.md's "HTTPS and reverse
     * proxies"). 30 failures per 24 hours: generous enough that a real
     * install day — several devices, a couple of mistyped codes each,
     * maybe a replacement device the same week — never comes close,
     * while still bounding sustained guessing against one specific,
     * targeted org even if every attempt arrives from a different
     * (possibly forged) source IP.
     */
    private const MAX_ORG_ATTEMPTS = 30;

    private const ORG_DECAY_SECONDS = 86400;

    public function register(RegisterDeviceRequest $request): JsonResponse
    {
        try {
            $phone = EgyptianPhone::normalize($request->string('phone')->toString());
        } catch (InvalidArgumentException) {
            throw ValidationException::withMessages([
                'phone' => 'رقم الهاتف غير صالح',
            ]);
        }

        $activationCode = $request->string('activation_code')->toString();
        $codeHash = ActivationCode::hash($activationCode);

        $ipKey = 'device-register:ip:'.$request->ip();
        $codeKey = 'device-register:code:'.$activationCode;
        $orgId = $this->resolveOrgForRateLimit($phone, $codeHash);
        $orgKey = $orgId !== null ? 'device-register:org:'.$orgId : null;

        if ($orgKey !== null && RateLimiter::tooManyAttempts($orgKey, self::MAX_ORG_ATTEMPTS)) {
            // A security event worth its own log line, deliberately
            // without the phone or the code that triggered it — org_id
            // and the (possibly forged) source IP are what an operator
            // investigating this actually needs; the credential itself
            // is exactly what must never end up in a log.
            Log::warning('registration_org_rate_limited', ['org_id' => $orgId, 'ip' => $request->ip()]);

            return $this->tooManyAttempts();
        }

        if (RateLimiter::tooManyAttempts($ipKey, self::MAX_ATTEMPTS) || RateLimiter::tooManyAttempts($codeKey, self::MAX_ATTEMPTS)) {
            return $this->tooManyAttempts();
        }

        $payload = [
            'device_id' => $request->string('device_id')->toString(),
            'phone' => $phone,
            'code_hash' => $codeHash,
            'audit_device_id' => (string) Str::uuid(),
            'audit_code_used_id' => (string) Str::uuid(),
        ];

        try {
            // Default connection (clintra_app) — register_device(jsonb) has
            // EXECUTE granted to clintra_app specifically, since this is a
            // live, unauthenticated request; see the function's own
            // migration comment.
            $row = DB::selectOne('select register_device(?::jsonb) as result', [json_encode($payload, JSON_THROW_ON_ERROR)]);
        } catch (QueryException) {
            RateLimiter::hit($ipKey, self::DECAY_SECONDS);
            RateLimiter::hit($codeKey, self::DECAY_SECONDS);
            if ($orgKey !== null) {
                RateLimiter::hit($orgKey, self::ORG_DECAY_SECONDS);
            }

            return $this->genericFailure();
        }

        RateLimiter::clear($ipKey);
        RateLimiter::clear($codeKey);
        if ($orgKey !== null) {
            RateLimiter::clear($orgKey);
        }

        $result = json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);

        // A bare, unfetched instance — see App\Models\Device's own doc
        // comment for why this is never queried from the database.
        $device = new Device(['id' => $result['device_id']]);
        $token = $device->createToken('device', ['membership:'.$result['membership_id']])->plainTextToken;

        return response()->json([
            'token' => $token,
            'device_id' => $result['device_id'],
            'org_id' => $result['org_id'],
            'location_id' => $result['location_id'],
            'membership_id' => $result['membership_id'],
            'organization' => $result['organization'],
            'locations' => $result['locations'],
            'practitioners' => $result['practitioners'],
            'memberships' => $result['memberships'],
            'users' => $result['users'],
        ]);
    }

    /**
     * Best-effort only: a failure here (a bad deploy where the function
     * doesn't exist yet, an unexpected DB error) must never break
     * registration itself over a rate-limiting refinement — it just means
     * this one attempt isn't org-limited, falling back to the IP/code
     * layers exactly as before this existed.
     */
    private function resolveOrgForRateLimit(string $phone, string $codeHash): ?string
    {
        try {
            $row = DB::selectOne('select resolve_registration_org(?::jsonb) as org_id', [
                json_encode(['phone' => $phone, 'code_hash' => $codeHash], JSON_THROW_ON_ERROR),
            ]);

            return $row->org_id ?? null;
        } catch (Throwable) {
            return null;
        }
    }

    private function tooManyAttempts(): JsonResponse
    {
        // Identical shape regardless of which layer tripped — a
        // "this org is locked" message would itself confirm the org
        // exists, the same credential-guessing oracle this endpoint's
        // generic-failure design already refuses to open elsewhere.
        return response()->json([
            'error' => 'too_many_attempts',
            'message' => 'محاولات كثيرة جدًا — حاول لاحقًا',
        ], Response::HTTP_TOO_MANY_REQUESTS);
    }

    private function genericFailure(): JsonResponse
    {
        return response()->json([
            'error' => 'registration_failed',
            'message' => 'فشل التفعيل — تأكد من رقم الهاتف وكود التفعيل',
        ], Response::HTTP_UNAUTHORIZED);
    }
}
