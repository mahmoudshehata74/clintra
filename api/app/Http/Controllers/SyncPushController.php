<?php

namespace App\Http\Controllers;

use App\Http\Requests\PushSyncOpsRequest;
use App\Support\Sync\SyncOpApplier;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/sync/push — matches SyncTransport.pushOps exactly (an array
 * of ops in, one result per op out, same order). Runs behind the
 * `membership` middleware, on the ordinary RLS-bound clintra_app
 * connection — never a BYPASSRLS path (docs/sync-plan.md's Q12).
 *
 * Ops apply in the order given (the brief's "chronological order per
 * device" — the client is what sorts them that way before sending; this
 * endpoint trusts and preserves that order, it doesn't re-sort). Once an
 * op targeting a given entity_id is rejected or fails, every later op in
 * the same batch targeting that same entity_id returns `blocked` without
 * being attempted — docs/sync-plan.md's Q2. Ops on other entities are
 * unaffected.
 */
class SyncPushController extends Controller
{
    public function __construct(private readonly SyncOpApplier $applier) {}

    public function push(PushSyncOpsRequest $request): JsonResponse
    {
        $deviceId = $request->attributes->get('device_id');

        if ($deviceId === null) {
            // The local-only X-Membership-Id bridge has no real device
            // behind it (ApplyMembership's own doc comment) — sync has no
            // meaning without one, so this is unauthenticated here too,
            // the same generic body every other rejection in this app uses.
            return response()->json([
                'error' => 'unauthenticated',
                'message' => 'يجب تسجيل الدخول',
            ], 401);
        }

        $membershipId = DB::selectOne('select current_membership() as id')->id;
        $ops = $request->validated()['ops'];

        $results = [];
        $blockedEntityIds = [];

        foreach ($ops as $op) {
            if (isset($blockedEntityIds[$op['entity_id']])) {
                $results[] = ['op_id' => $op['op_id'], 'status' => 'blocked'];

                continue;
            }

            $result = $this->applier->apply($this->normalizeOp($op), $membershipId, $deviceId);
            $results[] = $result;

            if (in_array($result['status'], ['rejected', 'failed'], true)) {
                $blockedEntityIds[$op['entity_id']] = true;
            }
        }

        return response()->json(['results' => $results]);
    }

    /**
     * @return array{op_id: string, entity: string, entity_id: string, action: string, payload: ?array, created_at: string, base_rev: ?int}
     */
    private function normalizeOp(array $op): array
    {
        return [
            'op_id' => $op['op_id'],
            'entity' => $op['entity'],
            'entity_id' => $op['entity_id'],
            'action' => $op['action'],
            'payload' => $op['payload'] ?? null,
            'created_at' => $op['created_at'],
            'base_rev' => $op['base_rev'] ?? null,
        ];
    }
}
