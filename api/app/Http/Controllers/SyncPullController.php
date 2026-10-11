<?php

namespace App\Http\Controllers;

use App\Http\Requests\PullSyncOpsRequest;
use App\Support\Sync\DeviceSeries;
use App\Support\Sync\SyncPuller;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/sync/pull — matches SyncTransport.pullSince exactly (one
 * opaque cursor in, a batch and a new cursor out). Runs behind the
 * `membership` middleware, on the ordinary RLS-bound `clintra_app`
 * connection — see App\Support\Sync\SyncPuller's own doc comment for why
 * org isolation here is never a hand-written filter.
 */
class SyncPullController extends Controller
{
    public function __construct(private readonly SyncPuller $puller) {}

    public function pull(PullSyncOpsRequest $request): JsonResponse
    {
        $since = $request->validated()['cursor'] ?? 0;

        // A cursor ahead of the org's own history is never something a
        // real client, following this contract, could legitimately hold
        // — either corrupted, forged, or borrowed from another org's
        // sequence space entirely. Rejected outright rather than treated
        // as "nothing new yet", which would hide exactly that.
        if ($since > $this->puller->currentMaxSeq()) {
            return response()->json([
                'error' => 'invalid_cursor',
                'message' => 'المؤشر غير صالح',
            ], 422);
        }

        // device_series rides on every page so a device registered before
        // number series existed learns its own on its next pull
        // (docs/schema.md's v16 additions).
        return response()->json([
            ...$this->puller->pull($since),
            'device_series' => DeviceSeries::of($request->attributes->get('device_id')),
        ]);
    }
}
