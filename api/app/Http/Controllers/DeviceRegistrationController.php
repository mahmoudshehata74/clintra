<?php

namespace App\Http\Controllers;

use App\Http\Requests\RegisterDeviceRequest;
use App\Models\Device;
use App\Support\ActivationCode;
use App\Support\EgyptianPhone;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\Response;

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
        $ipKey = 'device-register:ip:'.$request->ip();
        $codeKey = 'device-register:code:'.$activationCode;

        if (RateLimiter::tooManyAttempts($ipKey, self::MAX_ATTEMPTS) || RateLimiter::tooManyAttempts($codeKey, self::MAX_ATTEMPTS)) {
            return response()->json([
                'error' => 'too_many_attempts',
                'message' => 'محاولات كثيرة جدًا — حاول لاحقًا',
            ], Response::HTTP_TOO_MANY_REQUESTS);
        }

        $payload = [
            'device_id' => $request->string('device_id')->toString(),
            'phone' => $phone,
            'code_hash' => ActivationCode::hash($activationCode),
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

            return $this->genericFailure();
        }

        RateLimiter::clear($ipKey);
        RateLimiter::clear($codeKey);

        $result = json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);

        // A bare, unfetched instance — see App\Models\Device's own doc
        // comment for why this is never queried from the database.
        $device = new Device(['id' => $result['device_id']]);
        $token = $device->createToken('device', ['membership:'.$result['membership_id']])->plainTextToken;

        return response()->json([
            'token' => $token,
            'organization' => $result['organization'],
            'locations' => $result['locations'],
            'practitioners' => $result['practitioners'],
            'memberships' => $result['memberships'],
        ]);
    }

    private function genericFailure(): JsonResponse
    {
        return response()->json([
            'error' => 'registration_failed',
            'message' => 'فشل التفعيل — تأكد من رقم الهاتف وكود التفعيل',
        ], Response::HTTP_UNAUTHORIZED);
    }
}
