<?php

namespace App\Http\Controllers;

use App\Http\Requests\SyncBootstrapRequest;
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

        return response()->json($this->puller->pull($cursor));
    }
}
