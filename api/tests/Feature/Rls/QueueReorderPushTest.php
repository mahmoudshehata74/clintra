<?php

use Illuminate\Support\Str;

/**
 * A queue reorder's position moves pushed as one group (group_id —
 * SyncPushController's class comment, web/src/db/visitQueue.ts): applied
 * together or not at all. A device that reorders on positions another
 * device already moved gets `conflict_stale_rev` for the group, and none
 * of its writes stay.
 */

/**
 * A device of a fresh organization and three arrived visits of one doctor
 * today, at positions 1, 2 and 3.
 *
 * @return array{credential: array<string, string>, visitIds: list<string>}
 */
function reorderDay(): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();
    $templateId = $test->fx()->table('specialty_templates')->whereNull('org_id')->where('key', 'general')->value('id');
    $practitionerId = $test->makePractitioner($credential['orgId'], $templateId);
    $visitIds = [];

    foreach ([1, 2, 3] as $position) {
        $patientId = $test->makePatient($credential['orgId'], "queue patient {$position}");
        $visitIds[] = $test->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], [
            'position' => $position,
            'status' => 'arrived',
            'arrived_at' => now(),
        ]);
    }

    return ['credential' => $credential, 'visitIds' => $visitIds];
}

/** An update op moving `$visitId` to `$position`, on `$baseRev`, in `$groupId`. */
function positionOp(string $visitId, int $position, int $baseRev, ?string $groupId): array
{
    $row = (array) test()->fx()->table('visits')->where('id', $visitId)->first();
    unset($row['rev']);

    return [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $visitId,
        'action' => 'update',
        'base_rev' => $baseRev,
        'payload' => array_merge($row, ['position' => $position]),
        'created_at' => now()->toIso8601String(),
        'group_id' => $groupId,
    ];
}

/** The day's positions, by visit id. */
function positionsOf(array $visitIds): array
{
    return test()->fx()->table('visits')->whereIn('id', $visitIds)->pluck('position', 'id')->all();
}

function forgetReorderOps(array $ops): void
{
    $fx = test()->fx();
    $opIds = array_column($ops, 'op_id');
    $fx->table('audit_log')->whereIn('entity_id', array_column($ops, 'entity_id'))->delete();
    $fx->table('sync_ledger')->whereIn('op_id', $opIds)->delete();
}

test('a swap pushed as one group is applied whole', function () {
    ['credential' => $credential, 'visitIds' => [$first, $second]] = reorderDay();
    $group = (string) Str::uuid();
    // Park the first, move the second into its place, bring the first to the second's.
    $ops = [
        positionOp($first, -1, 1, $group),
        positionOp($second, 1, 1, $group),
        positionOp($first, 2, 2, $group),
    ];

    $results = pushOps($credential['token'], $ops)->assertOk()->json('results');

    expect(array_column($results, 'status'))->toBe(['accepted', 'accepted', 'accepted']);
    expect(positionsOf([$first, $second]))->toEqual([$first => 2, $second => 1]);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', array_column($ops, 'op_id'))->count())->toBe(3);

    forgetReorderOps($ops);
});

test('a reorder on positions another device already moved is refused whole as conflict_stale_rev', function () {
    ['credential' => $credential, 'visitIds' => [$first, $second, $third]] = reorderDay();

    // Device A swaps the first two.
    $groupA = (string) Str::uuid();
    $opsA = [positionOp($first, -1, 1, $groupA), positionOp($second, 1, 1, $groupA), positionOp($first, 2, 2, $groupA)];
    pushOps($credential['token'], $opsA)->assertOk();
    $afterA = positionsOf([$first, $second, $third]);

    // Device B, on what it saw before A's push, swaps the second and third.
    $groupB = (string) Str::uuid();
    $opsB = [positionOp($second, -2, 1, $groupB), positionOp($third, 2, 1, $groupB), positionOp($second, 3, 2, $groupB)];
    $results = pushOps($credential['token'], $opsB)->assertOk()->json('results');

    expect($results[0])->toMatchArray(['status' => 'rejected', 'reason' => 'conflict_stale_rev']);
    expect($results[1])->toMatchArray(['status' => 'rejected', 'reason' => 'group_rejected']);
    expect($results[2])->toMatchArray(['status' => 'rejected', 'reason' => 'group_rejected']);
    expect(positionsOf([$first, $second, $third]))->toEqual($afterA);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', array_column($opsB, 'op_id'))->exists())->toBeFalse();

    forgetReorderOps([...$opsA, ...$opsB]);
});

test('a group whose later op is refused keeps none of its earlier, accepted writes', function () {
    ['credential' => $credential, 'visitIds' => [$first, $second]] = reorderDay();
    $group = (string) Str::uuid();
    // The second visit's base_rev is stale: its first op alone would be accepted.
    $ops = [positionOp($first, -1, 1, $group), positionOp($second, 1, 7, $group), positionOp($first, 2, 2, $group)];

    $results = pushOps($credential['token'], $ops)->assertOk()->json('results');

    expect($results[0])->toMatchArray(['status' => 'rejected', 'reason' => 'group_rejected']);
    expect($results[1])->toMatchArray(['status' => 'rejected', 'reason' => 'conflict_stale_rev']);
    expect($results[2])->toMatchArray(['status' => 'rejected', 'reason' => 'group_rejected']);
    expect(positionsOf([$first, $second]))->toEqual([$first => 1, $second => 2]);
    expect($this->fx()->table('visits')->where('id', $first)->value('rev'))->toBe(1);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', array_column($ops, 'op_id'))->exists())->toBeFalse();
    expect($this->fx()->table('audit_log')->whereIn('entity_id', [$first, $second])->exists())->toBeFalse();
});

test('after a refused group, a later op on any of its visits is blocked; another visit is still applied', function () {
    ['credential' => $credential, 'visitIds' => [$first, $second, $third]] = reorderDay();
    $group = (string) Str::uuid();
    $later = positionOp($first, 9, 1, null);
    $elsewhere = positionOp($third, 8, 1, null);

    $results = pushOps($credential['token'], [
        positionOp($first, -1, 1, $group),
        positionOp($second, 1, 7, $group),
        positionOp($first, 2, 2, $group),
        $later,
        $elsewhere,
    ])->assertOk()->json('results');

    expect($results[3])->toMatchArray(['op_id' => $later['op_id'], 'status' => 'blocked']);
    expect($results[4])->toMatchArray(['op_id' => $elsewhere['op_id'], 'status' => 'accepted']);

    forgetReorderOps([$elsewhere]);
});

test('a group resent after it was applied is a duplicate, op by op', function () {
    ['credential' => $credential, 'visitIds' => [$first, $second]] = reorderDay();
    $group = (string) Str::uuid();
    $ops = [positionOp($first, -1, 1, $group), positionOp($second, 1, 1, $group), positionOp($first, 2, 2, $group)];
    pushOps($credential['token'], $ops)->assertOk();

    $results = pushOps($credential['token'], $ops)->assertOk()->json('results');

    expect(array_column($results, 'status'))->toBe(['duplicate', 'duplicate', 'duplicate']);
    expect(positionsOf([$first, $second]))->toEqual([$first => 2, $second => 1]);

    forgetReorderOps($ops);
});
