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
 * TODO(auth): the membership id is read from an X-Membership-Id header —
 * a temporary bridge because Sanctum device-token auth isn't wired yet.
 * Once it is, this must read the membership from the authenticated token
 * (or its related model) instead of trusting a client-supplied header.
 * Not registered globally on purpose — attach only to routes that are
 * ready to be membership-scoped.
 */
class ApplyMembership
{
    public function handle(Request $request, Closure $next): Response
    {
        $membershipId = $request->header('X-Membership-Id');

        if (! $membershipId) {
            return response()->json([
                'error' => 'membership_required',
                'message' => 'رأس X-Membership-Id مطلوب',
            ], 400);
        }

        return DB::transaction(function () use ($request, $next, $membershipId) {
            app(DatabaseSession::class)->applyMembership($membershipId);

            return $next($request);
        });
    }
}
