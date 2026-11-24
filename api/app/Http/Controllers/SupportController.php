<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Support\ActivationCode;
use App\Support\DatabaseSession;
use App\Support\Identity\Es256;
use App\Support\Identity\Identity;
use App\Support\Sync\SupportAccess;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class SupportController extends Controller
{
    public function codes(Request $request): JsonResponse
    {
        $p = $request->all();
        $keys = array_keys($p);
        sort($keys);
        if ($keys !== ['audit_id', 'code_hash', 'id', 'include_clinical', 'location_id', 'support_hours']
            || ! Str::isUuid($p['id']) || ! Str::isUuid($p['location_id']) || ! Str::isUuid($p['audit_id'])
            || ! is_string($p['code_hash']) || preg_match('/^[0-9a-f]{64}$/', $p['code_hash']) !== 1
            || ! in_array($p['support_hours'], [1, 24, 72], true)
            || ! is_bool($p['include_clinical'])) {
            return response()->json(['error' => 'invalid_payload', 'message' => 'البيانات غير صالحة'], 422);
        }

        try {
            $row = DB::selectOne('SELECT mint_support_code(?::jsonb) AS result', [
                json_encode($p, JSON_THROW_ON_ERROR),
            ]);
        } catch (QueryException $error) {
            if ($error->getCode() === 'CL403') {
                return response()->json(['error' => 'forbidden', 'message' => 'غير مسموح'], 403);
            }
            if ($error->getCode() === '22023') {
                return response()->json(['error' => 'invalid_payload', 'message' => 'البيانات غير صالحة'], 422);
            }
            throw $error;
        }

        return response()->json(json_decode($row->result, true, flags: JSON_THROW_ON_ERROR), 201);
    }

    public function exchange(Request $request): JsonResponse
    {
        if ($this->hasSupportBearer($request)) {
            return response()->json([
                'error' => 'support_read_only',
                'message' => 'جهاز الدعم للقراءة بس، مفيش تغيير بيتحفظ منه',
            ], 403);
        }

        $code = $request->input('exchange_code');
        $key = $request->input('device_public_key');
        $ipKey = 'support-exchange:ip:'.$request->ip();
        $codeKey = 'support-exchange:code:'.hash('sha256', is_string($code) ? $code : '');

        if (RateLimiter::tooManyAttempts($ipKey, 5) || RateLimiter::tooManyAttempts($codeKey, 5)) {
            return response()->json([
                'error' => 'too_many_attempts',
                'message' => 'محاولات كثيرة جدًا — حاول لاحقًا',
            ], 429);
        }

        if (! is_string($code) || $code === '' || strlen($code) > 200 || ! Es256::isPublicJwk($key)) {
            return $this->exchangeFailure($ipKey, $codeKey);
        }

        try {
            $result = DB::transaction(function () use ($code, $key) {
                $row = DB::selectOne('SELECT support_exchange(?::jsonb) AS result', [
                    json_encode(['exchange_hash' => ActivationCode::hash($code),
                        'device_public_key' => $key], JSON_THROW_ON_ERROR),
                ]);
                $exchange = json_decode($row->result, true, flags: JSON_THROW_ON_ERROR);
                app(DatabaseSession::class)->applyMembership($exchange['membership_id']);
                $bootstrap = $this->bootstrap($exchange);
                $device = new Device(['id' => $exchange['device_id']]);
                $token = $device->createToken('support', [
                    'membership:'.$exchange['membership_id'], 'support:read-only',
                ], Carbon::parse($exchange['expires_at']))->plainTextToken;

                return ['token' => $token, ...$bootstrap,
                    'support' => ['expires_at' => $exchange['expires_at'],
                        'include_clinical' => $exchange['include_clinical'],
                        'admin_name' => $exchange['admin_name']]];
            });
        } catch (QueryException) {
            return $this->exchangeFailure($ipKey, $codeKey);
        }

        RateLimiter::clear($ipKey);
        RateLimiter::clear($codeKey);

        return response()->json($result);
    }

    public function end(Request $request, string $device): JsonResponse
    {
        if (! Str::isUuid($device)) {
            return response()->json(['error' => 'not_found', 'message' => 'جهاز الدعم غير متاح'], 404);
        }

        try {
            $row = DB::selectOne('SELECT end_support_session(?::jsonb) AS result', [
                json_encode(['device_id' => $device, 'audit_id' => (string) Str::uuid()], JSON_THROW_ON_ERROR),
            ]);
        } catch (QueryException $error) {
            if ($error->getCode() === 'CL403') {
                return response()->json(['error' => 'not_found', 'message' => 'جهاز الدعم غير متاح'], 404);
            }
            throw $error;
        }

        return response()->json(json_decode($row->result, true, flags: JSON_THROW_ON_ERROR));
    }

    private function exchangeFailure(string $ipKey, string $codeKey): JsonResponse
    {
        RateLimiter::hit($ipKey, 900);
        RateLimiter::hit($codeKey, 900);

        return response()->json([
            'error' => 'registration_failed',
            'message' => 'فشل التفعيل — تأكد من رقم الهاتف وكود التفعيل',
        ], 401);
    }

    private function hasSupportBearer(Request $request): bool
    {
        $bearer = $request->bearerToken();
        if (! is_string($bearer) || ! str_contains($bearer, '|')) {
            return false;
        }
        [$id, $secret] = explode('|', $bearer, 2);
        if (! ctype_digit($id) || strlen($id) > 18) {
            return false;
        }
        $row = DB::table('personal_access_tokens')->where('id', $id)->first(['token', 'abilities']);
        if ($row === null || ! hash_equals($row->token, hash('sha256', $secret))) {
            return false;
        }

        return in_array('support:read-only', json_decode($row->abilities ?? '[]', true) ?? [], true);
    }

    private function bootstrap(array $exchange): array
    {
        $org = DB::table('organizations')->where('id', $exchange['org_id'])
            ->first(['id', 'name', 'plan_tier', 'created_at', 'identity_enforced_at']);
        $enforced = $org->identity_enforced_at !== null;
        $organization = (array) $org;
        unset($organization['identity_enforced_at']);

        $memberships = DB::table('memberships')->where('org_id', $exchange['org_id'])->get([
            'id', 'user_id', 'org_id', 'role', 'location_scope', 'practitioner_scope',
            'practitioner_id', 'is_active', 'rev', 'display_name',
            ...($enforced ? ['username', 'permissions'] : []),
        ])->map(function ($row) use ($enforced) {
            $member = (array) $row;
            if ($enforced) {
                $member['permissions'] = Identity::parseTextArray($row->permissions);
            }

            return SupportAccess::redactEntity('memberships', $member, false);
        })->all();

        return [
            'device_id' => $exchange['device_id'],
            'org_id' => $exchange['org_id'],
            'location_id' => $exchange['location_id'],
            'membership_id' => $exchange['membership_id'],
            'series' => null,
            'organization' => $organization,
            'locations' => DB::table('locations')->where('org_id', $exchange['org_id'])->get([
                'id', 'org_id', 'name', 'address', 'phone', 'is_active',
            ])->map(fn ($row) => (array) $row)->all(),
            'practitioners' => DB::table('practitioners')->where('org_id', $exchange['org_id'])->get([
                'id', 'org_id', 'user_id', 'full_name', 'specialty_id', 'title', 'is_active',
                'syndicate_number', 'rev',
            ])->map(fn ($row) => (array) $row)->all(),
            'memberships' => $memberships,
            'users' => DB::table('users')->whereIn('id', array_column($memberships, 'user_id'))->get([
                'id', 'full_name', 'phone', 'email', 'is_active',
            ])->map(fn ($row) => (array) $row)->all(),
            ...($enforced ? ['identity_enforced_at' => $org->identity_enforced_at] : []),
        ];
    }
}
