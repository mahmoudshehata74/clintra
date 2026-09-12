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
 *
 * This class carries the entire isolation guarantee for every
 * membership-gated route, so every rejection path below returns the exact
 * same generic 401 body — never a distinguishing message, and never an
 * uncaught exception that could render as a 500 (confirmed empirically:
 * a token whose id segment wasn't numeric used to reach a raw
 * `WHERE id = 'abc'` query against a bigint column and throw a real
 * QueryException, rendering as 500 with the query text in the message).
 */
class ApplyMembership
{
    public function handle(Request $request, Closure $next): Response
    {
        $credential = $this->resolveCredential($request);

        if ($credential === null) {
            return $this->unauthenticated();
        }

        return DB::transaction(function () use ($request, $next, $credential) {
            app(DatabaseSession::class)->applyMembership($credential['membership_id']);

            // current_org() re-resolves live from `memberships`, scoped to
            // `is_active = true` (see 2026_09_11_170029_enable_rls_policies.php)
            // — this is what actually catches a membership deactivated, or
            // deleted, since the token was issued, without this middleware
            // ever reading the RLS-protected `memberships` table directly.
            // It is also what makes "moved to another org" safe by
            // construction: org scope is never cached anywhere from
            // token-issuance time, only ever resolved fresh, right here,
            // on every request.
            $resolved = DB::selectOne('select current_org() as org_id');

            if ($resolved === null || $resolved->org_id === null) {
                return $this->unauthenticated();
            }

            if ($credential['device_id'] !== null) {
                $device = DB::selectOne('select device_exists(?) as exists', [$credential['device_id']]);

                if (! $device->exists) {
                    return $this->unauthenticated();
                }
            }

            // Exposed for routes that need to attribute a write to the
            // calling device (e.g. sync_ledger.device_id) — membership_id
            // itself is deliberately not duplicated here, since
            // current_membership() is already the single source of truth
            // for it and every existing route reads it that way.
            $request->attributes->set('device_id', $credential['device_id']);

            return $next($request);
        });
    }

    private function unauthenticated(): Response
    {
        return response()->json([
            'error' => 'unauthenticated',
            'message' => 'يجب تسجيل الدخول',
        ], 401);
    }

    /**
     * @return array{membership_id: string, device_id: ?string}|null device_id is
     *                                                               null for the local-only X-Membership-Id bridge, which has no real
     *                                                               device behind it.
     */
    private function resolveCredential(Request $request): ?array
    {
        if (app()->environment('local')) {
            $header = $request->header('X-Membership-Id');

            if ($header) {
                return ['membership_id' => $header, 'device_id' => null];
            }
        }

        return $this->resolveCredentialFromToken($request);
    }

    /**
     * Replicates Sanctum's own "id|token" lookup (PersonalAccessToken::findToken())
     * by hand, against the raw table — see this class's own doc comment for why.
     *
     * @return array{membership_id: string, device_id: ?string}|null
     */
    private function resolveCredentialFromToken(Request $request): ?array
    {
        $token = $request->bearerToken();

        if (! $token || ! str_contains($token, '|')) {
            return null;
        }

        [$id, $plainTextToken] = explode('|', $token, 2);

        // personal_access_tokens.id is a bigint — a non-numeric or
        // out-of-range id segment must be rejected here, before it ever
        // reaches a WHERE clause bound against that column. Without this,
        // a malformed id throws a real QueryException (confirmed: PHP's
        // pgsql driver cannot bind a non-numeric string to a bigint
        // parameter) that bootstrap/app.php's generic Throwable handler
        // renders as 500 — not 401 — and leaks the query text in debug mode.
        if (! ctype_digit($id) || strlen($id) > 18) {
            return null;
        }

        $row = DB::table('personal_access_tokens')->where('id', $id)->first();

        if (! $row || ! hash_equals($row->token, hash('sha256', $plainTextToken))) {
            return null;
        }

        if ($row->expires_at && now()->greaterThan($row->expires_at)) {
            return null;
        }

        $abilities = json_decode($row->abilities ?? '[]', true) ?? [];
        $membershipId = null;

        foreach ($abilities as $ability) {
            if (str_starts_with($ability, 'membership:')) {
                $membershipId = substr($ability, strlen('membership:'));

                break;
            }
        }

        if ($membershipId === null) {
            return null;
        }

        // toIso8601String(), not a bare Carbon instance: the query grammar
        // would otherwise format it as a naive "Y-m-d H:i:s" string with no
        // offset, which a Postgres session in a different timezone than
        // config('app.timezone') would misinterpret — see
        // tests/Support/RlsFixtures.php's normalizeTimestamps() for the
        // confirmed failure mode this exact pattern caused elsewhere.
        DB::table('personal_access_tokens')->where('id', $id)->update(['last_used_at' => now()->toIso8601String()]);

        return ['membership_id' => $membershipId, 'device_id' => $row->tokenable_id];
    }
}
