<?php

namespace App\Http\Controllers;

use App\Http\Requests\SyncBootstrapRequest;
use App\Support\Identity\Identity;
use App\Support\Sync\CodeNotices;
use App\Support\Sync\DeviceSeries;
use App\Support\Sync\SupportAccess;
use App\Support\Sync\SyncBootstrapPuller;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/sync/bootstrap — see App\Support\Sync\SyncBootstrapPuller's own
 * doc comment for why this exists as a separate endpoint rather than a mode
 * on GET /api/sync/pull. Runs behind the `membership` middleware, on the
 * same ordinary RLS-bound `clintra_app` connection as pull/push — no
 * special role, no BYPASSRLS, org isolation is once again never a
 * hand-written filter here.
 */
class SyncBootstrapController extends Controller
{
    public function __construct(private readonly SyncBootstrapPuller $puller) {}

    public function bootstrap(SyncBootstrapRequest $request): JsonResponse
    {
        $cursor = $request->validated()['cursor'] ?? null;

        // Same as GET /api/sync/pull: the requesting device's own series
        // (docs/schema.md's v16 additions).
        return response()->json([
            ...$this->puller->pull($cursor, Identity::enforced($request), $request->attributes->get('device_id')),
            'device_series' => DeviceSeries::of($request->attributes->get('device_id')),
            'code_notices' => CodeNotices::current(),
            'support_sessions' => SupportAccess::sessions(),
            ...Identity::syncMetadata($request),
        ]);
    }
}
