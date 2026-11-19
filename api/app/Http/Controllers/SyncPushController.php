<?php

namespace App\Http\Controllers;

use App\Http\Requests\PushSyncOpsRequest;
use App\Support\Sync\SyncGroupRefused;
use App\Support\Sync\SyncOpApplier;
use App\Support\Sync\SyncSeqLock;
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
 *
 * Ops that carry the same group_id, one after another, are one write: a
 * queue reorder's or "send to end"'s position moves
 * (web/src/db/visitQueue.ts), or a switch between slots and queue with
 * the visits it renumbers (web/src/db/scheduleModeSwitch.ts), which only
 * make sense together. They apply in one savepoint; if any of them is not
 * accepted (or a duplicate), the savepoint is rolled back so none of the
 * group's writes, ledger rows or audit rows stay, that op returns its own
 * result, and every other op of the group returns `rejected` with reason
 * `group_rejected` — never `accepted`, since nothing of it was kept. Every
 * entity the group named is then blocked for the rest of the batch.
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

        // Before any op writes: this push holds its organization's sync
        // lock until the request commits (SyncSeqLock).
        SyncSeqLock::acquire();

        $results = [];
        $blockedEntityIds = [];

        foreach ($this->runs($ops) as $run) {
            if (count($run) > 1 || ($run[0]['group_id'] ?? null) !== null) {
                array_push($results, ...$this->applyGroup($run, $membershipId, $deviceId, $blockedEntityIds));

                continue;
            }

            $op = $run[0];

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
     * The batch split into runs: each op alone, except consecutive ops
     * sharing a non-null group_id, which form one run.
     *
     * @param  list<array<string, mixed>>  $ops
     * @return list<list<array<string, mixed>>>
     */
    private function runs(array $ops): array
    {
        $runs = [];

        foreach ($ops as $op) {
            $groupId = $op['group_id'] ?? null;
            $last = array_key_last($runs);

            if ($groupId !== null && $last !== null && ($runs[$last][0]['group_id'] ?? null) === $groupId) {
                $runs[$last][] = $op;
            } else {
                $runs[] = [$op];
            }
        }

        return $runs;
    }

    /**
     * One group, all or nothing (see the class comment).
     *
     * @param  list<array<string, mixed>>  $group
     * @param  array<string, true>  $blockedEntityIds
     * @return list<array<string, mixed>>
     */
    private function applyGroup(array $group, string $membershipId, string $deviceId, array &$blockedEntityIds): array
    {
        $blockEntities = function () use ($group, &$blockedEntityIds): void {
            foreach ($group as $op) {
                $blockedEntityIds[$op['entity_id']] = true;
            }
        };

        $blocked = collect($group)->first(fn (array $op) => isset($blockedEntityIds[$op['entity_id']]));

        if ($blocked !== null) {
            $blockEntities();

            return array_map(fn (array $op) => ['op_id' => $op['op_id'], 'status' => 'blocked'], $group);
        }

        $results = [];

        try {
            DB::transaction(function () use ($group, $membershipId, $deviceId, &$results): void {
                foreach ($group as $op) {
                    $result = $this->applier->apply($this->normalizeOp($op), $membershipId, $deviceId);
                    $results[] = $result;

                    if (! in_array($result['status'], ['accepted', 'duplicate'], true)) {
                        throw new SyncGroupRefused;
                    }
                }
            });
        } catch (SyncGroupRefused) {
            $refused = end($results);
            $blockEntities();

            return array_map(
                fn (array $op) => $op['op_id'] === $refused['op_id']
                    ? $refused
                    : ['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'group_rejected'],
                $group,
            );
        }

        return $results;
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
