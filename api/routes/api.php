<?php

use App\Http\Controllers\DeviceRegistrationController;
use App\Http\Controllers\SyncBootstrapController;
use App\Http\Controllers\SyncPullController;
use App\Http\Controllers\SyncPushController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

// No auth middleware: this endpoint IS how a device gets its first
// credential — see App\Http\Controllers\DeviceRegistrationController.
// Already rate-limited inside the controller itself (dual-keyed by IP and
// by the submitted activation code, 5 failures/15 minutes, cleared on
// success) — deliberately not also wrapped in a throttle: middleware
// here, which would be a second, cruder limiter stacked in front of a
// more specific one, and could shadow its distinct
// {"error":"too_many_attempts",...} response with Laravel's own generic
// 429 shape the moment the blunter counter tripped first.
Route::post('/devices/register', [DeviceRegistrationController::class, 'register']);

// Matches SyncTransport.pushOps/pullSince (web/src/sync/transport.ts)
// exactly — see App\Http\Controllers\SyncPushController/SyncPullController.
// Both behind `membership`, on the ordinary RLS-bound connection.
// throttle:sync is token-keyed, not IP-keyed — see
// App\Providers\AppServiceProvider's own comment for why.
Route::middleware(['membership', 'throttle:sync'])->post('/sync/push', [SyncPushController::class, 'push']);
Route::middleware(['membership', 'throttle:sync'])->get('/sync/pull', [SyncPullController::class, 'pull']);

// A fresh device's fast path to a usable day screen — see
// App\Support\Sync\SyncBootstrapPuller's own doc comment. Additive only:
// GET /sync/pull above is completely unchanged by this route's existence.
Route::middleware(['membership', 'throttle:sync'])->get('/sync/bootstrap', [SyncBootstrapController::class, 'bootstrap']);

Route::get('/health', function () {
    $composer = json_decode(file_get_contents(base_path('composer.json')), true);

    return response()->json([
        'status' => 'ok',
        'time' => now('UTC')->toIso8601String(),
        'version' => $composer['version'] ?? 'unknown',
    ]);
});

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Verification-only route for the RLS isolation model (see
// api/docs/rls.md). Not a real entity endpoint — it exists so a human (or
// a verification script/test) can confirm the ApplyMembership middleware
// and current_setting('app.membership_id') round-trip correctly, and that
// a real RLS-scoped read through this connection sees only the caller's
// own org, end to end over HTTP.
Route::middleware('membership')->get('/isolation-probe', function () {
    $seen = DB::selectOne("SELECT current_setting('app.membership_id', true) AS membership_id");
    $visibleOrgIds = DB::table('organizations')->pluck('id');

    return response()->json([
        'membership_id' => $seen->membership_id,
        'visible_organization_ids' => $visibleOrgIds,
    ]);
});
