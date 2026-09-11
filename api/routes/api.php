<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

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
// api/docs/rls.md). Not a real endpoint — it exists so a human (or a
// verification script) can confirm the ApplyMembership middleware and
// current_setting('app.membership_id') round-trip correctly.
Route::middleware('membership')->get('/isolation-probe', function () {
    $seen = DB::selectOne("SELECT current_setting('app.membership_id', true) AS membership_id");

    return response()->json([
        'membership_id' => $seen->membership_id,
    ]);
});
