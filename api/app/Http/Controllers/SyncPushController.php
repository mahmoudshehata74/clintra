<?php

namespace App\Http\Controllers;

use App\Http\Requests\PushSyncOpsRequest;
use App\Support\DatabaseSession;
use App\Support\Identity\Es256;
use App\Support\Identity\Identity;
use App\Support\Identity\ProofMessage;
use App\Support\Sync\SyncGroupRefused;
use App\Support\Sync\SyncOpApplier;
use App\Support\Sync\SyncSeqLock;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use stdClass;

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
 *
 * Once the organization is enforced (identity A1,
 * docs/design-identity-permissions.md, 3.6), every op carries
 * `credential_id` and `proof`, read from the raw body: no proof is
 * `proof_missing`; a credential that is not a live one of this device, or a
 * signature that does not verify, `proof_invalid`; a deactivated person
 * `actor_deactivated`. The op is then applied as that person
 * (DatabaseSession::actAs, restored to the device's membership after it),
 * and the applier checks the actor and the person's permissions. A group is
 * proven by one credential: the first op proven by another, or not proven,
 * is refused with its own reason and the rest `group_rejected`. Until the
 * organization is enforced none of this runs and the fields are not read.
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

        if (Identity::enforced($request)) {
            // The ops exactly as sent, beside the validated ones (same order):
            // what the proofs were signed over.
            $raw = json_decode($request->getContent(), associative: false)->ops ?? [];
            foreach ($ops as $index => $op) {
                $ops[$index]['__raw'] = $raw[$index] ?? null;
            }
        }

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

            $result = $this->applyProven([$op], $membershipId, $deviceId, fn (?array $identity) => [$this->applier->apply(
                $this->normalizeOp($op), $identity['membership_id'] ?? $membershipId, $deviceId, [], $identity,
            )])[0];
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

        // The whole group goes to every op's rules: a correction is checked
        // as one group (SyncOpApplier::applyCorrectionRule).
        $normalized = array_map(fn (array $op) => $this->normalizeOp($op), $group);

        $results = $this->applyProven($group, $membershipId, $deviceId, function (?array $identity) use ($normalized, $membershipId, $deviceId): array {
            $results = [];

            try {
                DB::transaction(function () use ($normalized, $membershipId, $deviceId, $identity, &$results): void {
                    foreach ($normalized as $op) {
                        $result = $this->applier->apply($op, $identity['membership_id'] ?? $membershipId, $deviceId, $normalized, $identity === null ? null : [
                            ...$identity, 'proof' => $identity['proofs'][$op['op_id']],
                        ]);
                        $results[] = $result;

                        if (! in_array($result['status'], ['accepted', 'duplicate'], true)) {
                            throw new SyncGroupRefused;
                        }
                    }
                });
            } catch (SyncGroupRefused) {
                return [end($results)];
            }

            return $results;
        });

        $refused = collect($results)->first(fn (array $result) => ! in_array($result['status'], ['accepted', 'duplicate'], true));

        if ($refused === null) {
            return $results;
        }

        $blockEntities();

        return array_map(
            fn (array $op) => $op['op_id'] === $refused['op_id']
                ? $refused
                : ['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'group_rejected'],
            $group,
        );
    }

    /**
     * Runs $apply as the person who proved $ops — every op of a run by one
     * credential — or, for an organization that is not enforced, exactly as
     * before ($apply(null)). Returns $apply's results, or a single refusal
     * of the first op that is not proven (the caller blocks and group-rejects
     * as for any refusal).
     *
     * @param  list<array<string, mixed>>  $ops
     * @param  callable(?array): list<array<string, mixed>>  $apply
     * @return list<array<string, mixed>>
     */
    private function applyProven(array $ops, string $membershipId, string $deviceId, callable $apply): array
    {
        if (! array_key_exists('__raw', $ops[0])) {
            return $apply(null);
        }

        $identity = null;
        $proofs = [];

        foreach ($ops as $op) {
            $raw = $op['__raw'];
            $credentialId = $raw->credential_id ?? null;
            $proof = $raw->proof ?? null;

            if (! $raw instanceof stdClass || ! is_string($credentialId) || ! is_string($proof) || $proof === '') {
                return [$this->refused($op, 'proof_missing')];
            }

            if ($identity !== null && strtolower($credentialId) !== $identity['credential_id']) {
                return [$this->refused($op, 'proof_invalid')];
            }

            if ($identity === null) {
                $credential = Identity::liveCredential($credentialId, $deviceId);
                $person = $credential === null ? null : Identity::person($credential->membership_id);

                if ($person === null) {
                    return [$this->refused($op, 'proof_invalid')];
                }

                $identity = [
                    'membership_id' => $person['membership_id'], 'role' => $person['role'],
                    'permissions' => $person['permissions'], 'credential_id' => strtolower($credential->id),
                    'is_active' => $person['is_active'], 'public_key' => $credential->public_key,
                ];
            }

            if (! Es256::verify($identity['public_key'], ProofMessage::op($raw, $deviceId, $credentialId), $proof)) {
                return [$this->refused($op, 'proof_invalid')];
            }

            if (! $identity['is_active']) {
                return [$this->refused($op, 'actor_deactivated')];
            }

            $proofs[$op['op_id']] = $proof;
        }

        $session = app(DatabaseSession::class);
        $session->actAs($identity['membership_id']);

        try {
            return $apply([
                'membership_id' => $identity['membership_id'], 'role' => $identity['role'],
                'permissions' => $identity['permissions'], 'credential_id' => $identity['credential_id'],
                'proof' => $proofs[$ops[0]['op_id']], 'proofs' => $proofs,
            ]);
        } finally {
            $session->actAs($membershipId);
        }
    }

    /** @param  array<string, mixed>  $op */
    private function refused(array $op, string $reason): array
    {
        return ['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => $reason];
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
