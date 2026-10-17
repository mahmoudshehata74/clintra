<?php

namespace App\Http\Controllers;

use App\Http\Requests\PullDeviceAuditRequest;
use App\Http\Requests\PushDeviceAuditRequest;
use App\Support\Sync\DeviceAuditPuller;
use App\Support\Sync\DeviceAuditPusher;
use App\Support\Sync\SyncSeqLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/audit/push and GET /api/audit/pull (docs/audit-sync.md):
 * device audit rows up and down, behind the `membership` middleware on the
 * ordinary RLS-bound clintra_app connection. Their own endpoints, not the
 * sync push: an audit row is not a sync op, writes no sync_ledger row and
 * never enters a device's sync review.
 */
class DeviceAuditController extends Controller
{
    public function __construct(
        private readonly DeviceAuditPusher $pusher,
        private readonly DeviceAuditPuller $puller,
    ) {}

    public function push(PushDeviceAuditRequest $request): JsonResponse
    {
        $deviceId = $this->deviceId($request);
        if ($deviceId === null) {
            return $this->unauthenticated();
        }

        $membershipId = DB::selectOne('select current_membership() as id')->id;

        // Before the first insert: seq order is commit order (SyncSeqLock).
        SyncSeqLock::acquire();

        $results = [];
        foreach ($request->input('rows') as $row) {
            $results[] = $this->pusher->push($row, $membershipId, $deviceId);
        }

        return response()->json(['results' => $results]);
    }

    public function pull(PullDeviceAuditRequest $request): JsonResponse
    {
        $deviceId = $this->deviceId($request);
        if ($deviceId === null) {
            return $this->unauthenticated();
        }

        $cursor = $request->validated()['cursor'] ?? null;

        // A cursor ahead of what the caller can see is corrupted, forged or
        // another organization's — refused, as the ledger pull refuses one.
        if ($cursor !== null && $cursor > $this->puller->currentMaxSeq()) {
            return response()->json([
                'error' => 'invalid_cursor',
                'message' => 'المؤشر غير صالح',
            ], 422);
        }

        return response()->json($this->puller->pull($cursor ?? $this->puller->firstPullStart(), $deviceId));
    }

    /** The token's device; null on the local-only X-Membership-Id bridge, which has none. */
    private function deviceId(Request $request): ?string
    {
        return $request->attributes->get('device_id');
    }

    private function unauthenticated(): JsonResponse
    {
        return response()->json([
            'error' => 'unauthenticated',
            'message' => 'يجب تسجيل الدخول',
        ], 401);
    }
}
