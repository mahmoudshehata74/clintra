<?php

namespace App\Http\Middleware;

use App\Support\DatabaseSession;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Wraps the request in a transaction and declares the acting membership to
 * Postgres for Row-Level Security (Decision B — SET LOCAL only lives inside
 * a transaction, which is why the whole request runs in one here).
 *
 * The membership comes from the authenticated device's Sanctum token,
 * verified directly against personal_access_tokens (unprotected by RLS) —
 * deliberately NOT via Laravel's auth:sanctum guard. That guard resolves
 * the token's tokenable (a device row) via an ordinary Eloquent query,
 * which is exactly the kind of RLS-protected read that needs a membership
 * to already be known — the same bootstrapping problem
 * provision_organization/register_device solve for writes
 * (api/docs/rls.md), but for a read, on every single authenticated
 * request, if the tokenable were the RLS-protected `device` table.
 * Verifying the token by hand here, against a table that carries no RLS at
 * all, sidesteps that circularity entirely. App\Models\Device exists only
 * to issue tokens at registration (App\Http\Controllers\DeviceRegistrationController);
 * nothing ever fetches a Device model afterward.
 *
 * X-Membership-Id is trusted ONLY when APP_ENV is literally "local" —
 * checked here, in the middleware itself, not via a config value, so it
 * can never be silently re-enabled by an environment-specific config file
 * shipped to a real environment by mistake.
 */
class ApplyMembership
{
    public function handle(Request $request, Closure $next): Response
    {
        $membershipId = $this->resolveMembershipId($request);

        if ($membershipId === null) {
            return response()->json([
                'error' => 'unauthenticated',
                'message' => 'يجب تسجيل الدخول',
            ], 401);
        }

        return DB::transaction(function () use ($request, $next, $membershipId) {
            app(DatabaseSession::class)->applyMembership($membershipId);

            return $next($request);
        });
    }

    private function resolveMembershipId(Request $request): ?string
    {
        if (app()->environment('local')) {
            $header = $request->header('X-Membership-Id');

            if ($header) {
                return $header;
            }
        }

        return $this->resolveMembershipIdFromToken($request);
    }

    /**
     * Replicates Sanctum's own "id|token" lookup (PersonalAccessToken::findToken())
     * by hand, against the raw table — see this class's own doc comment for why.
     */
    private function resolveMembershipIdFromToken(Request $request): ?string
    {
        $token = $request->bearerToken();

        if (! $token || ! str_contains($token, '|')) {
            return null;
        }

        [$id, $plainTextToken] = explode('|', $token, 2);

        $row = DB::table('personal_access_tokens')->where('id', $id)->first();

        if (! $row || ! hash_equals($row->token, hash('sha256', $plainTextToken))) {
            return null;
        }

        if ($row->expires_at && now()->greaterThan($row->expires_at)) {
            return null;
        }

        $abilities = json_decode($row->abilities ?? '[]', true) ?? [];

        foreach ($abilities as $ability) {
            if (str_starts_with($ability, 'membership:')) {
                DB::table('personal_access_tokens')->where('id', $id)->update(['last_used_at' => now()]);

                return substr($ability, strlen('membership:'));
            }
        }

        return null;
    }
}
