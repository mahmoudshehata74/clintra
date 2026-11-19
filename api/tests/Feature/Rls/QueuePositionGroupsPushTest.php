<?php

use Illuminate\Support\Str;

/**
 * "Send to end of queue" and a doctor's switch between slots and queue
 * (web/src/db/visitQueue.ts, web/src/db/scheduleModeSwitch.ts) pushed as
 * one group each (SyncPushController's class comment): the device orders
 * its writes so no two visits ever share a position — the first visit
 * whose place is still taken parked below zero — and the group applies
 * whole or not at all. A device that moves positions another device
 * already moved has the whole group refused.
 */

/**
 * A device of a fresh organization and one doctor's visits today, at the
 * given positions (each with its own extra columns).
 *
 * @param  list<array<string, mixed>>  $visits
 * @return array{credential: array<string, string>, practitionerId: string, visitIds: list<string>}
 */
function groupedMovesDay(array $visits): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();
    $templateId = $test->fx()->table('specialty_templates')->whereNull('org_id')->where('key', 'general')->value('id');
    $practitionerId = $test->makePractitioner($credential['orgId'], $templateId);
    $visitIds = [];

    foreach ($visits as $index => $columns) {
        $patientId = $test->makePatient($credential['orgId'], "grouped patient {$index}");
        $visitIds[] = $test->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], $columns);
    }

    return ['credential' => $credential, 'practitionerId' => $practitionerId, 'visitIds' => $visitIds];
}

/** An update op of `$entity` `$id`: its current row with `$changes`, on `$baseRev`, in `$groupId`. */
function groupedUpdateOp(string $entity, string $id, array $changes, int $baseRev, ?string $groupId): array
{
    $row = (array) test()->fx()->table($entity)->where('id', $id)->first();
    unset($row['rev']);

    return [
        'op_id' => (string) Str::uuid(),
        'entity' => $entity,
        'entity_id' => $id,
        'action' => 'update',
        'base_rev' => $baseRev,
        'payload' => array_merge($row, $changes),
        'created_at' => now()->toIso8601String(),
        'group_id' => $groupId,
    ];
}

/** A slots schedule row for today's weekday, created through a push. */
function groupedSchedule(array $credential, string $practitionerId): string
{
    $id = (string) Str::uuid();
    pushOps($credential['token'], [[
        'op_id' => (string) Str::uuid(),
        'entity' => 'schedules',
        'entity_id' => $id,
        'action' => 'create',
        'payload' => [
            'id' => $id,
            'practitioner_id' => $practitionerId,
            'location_id' => $credential['locationId'],
            'weekday' => now('Africa/Cairo')->dayOfWeek,
            'start_time' => '09:00',
            'end_time' => '14:00',
            'mode' => 'slots',
            'slot_minutes' => 30,
            'max_capacity' => null,
            'resource_count' => 1,
            'next_mode' => null,
            'next_mode_from' => null,
        ],
        'created_at' => now()->toIso8601String(),
    ]])->assertOk();

    return $id;
}

/** The visits' positions, by id. */
function groupedPositions(array $visitIds): array
{
    return test()->fx()->table('visits')->whereIn('id', $visitIds)->pluck('position', 'id')->all();
}

/** Removes what the pushes left: audit and ledger rows of the entities, and the schedule rows. */
function forgetGroupedOps(array $entityIds, array $scheduleIds = []): void
{
    $fx = test()->fx();
    $fx->table('audit_log')->whereIn('entity_id', $entityIds)->delete();
    $fx->table('sync_ledger')->whereIn('entity_id', $entityIds)->delete();
    $fx->table('schedules')->whereIn('id', $scheduleIds)->delete();
}

function arrivedAt(int $position): array
{
    return ['position' => $position, 'status' => 'arrived', 'arrived_at' => now()];
}

test('send to end, pushed as one group in the device\'s order, is applied whole', function () {
    ['credential' => $credential, 'visitIds' => [$first, $second, $third]] = groupedMovesDay([arrivedAt(1), arrivedAt(2), arrivedAt(3)]);
    $group = (string) Str::uuid();
    // The first visit to the end: parked, the others one place earlier, then it takes the last place.
    $ops = [
        groupedUpdateOp('visits', $first, ['position' => -1], 1, $group),
        groupedUpdateOp('visits', $second, ['position' => 1], 1, $group),
        groupedUpdateOp('visits', $third, ['position' => 2], 1, $group),
        groupedUpdateOp('visits', $first, ['position' => 3], 2, $group),
    ];

    $results = pushOps($credential['token'], $ops)->assertOk()->json('results');

    expect(array_column($results, 'status'))->toBe(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(groupedPositions([$first, $second, $third]))->toEqual([$first => 3, $second => 1, $third => 2]);

    forgetGroupedOps([$first, $second, $third]);
});

test('the same moves without parking collide on the position key and keep none of the group', function () {
    ['credential' => $credential, 'visitIds' => [$first, $second, $third]] = groupedMovesDay([arrivedAt(1), arrivedAt(2), arrivedAt(3)]);
    $group = (string) Str::uuid();
    // As the device wrote them before: the second into the first's place while the first still holds it.
    $ops = [
        groupedUpdateOp('visits', $second, ['position' => 1], 1, $group),
        groupedUpdateOp('visits', $third, ['position' => 2], 1, $group),
        groupedUpdateOp('visits', $first, ['position' => 3], 1, $group),
    ];

    $results = pushOps($credential['token'], $ops)->assertOk()->json('results');

    // A unique violation is no business conflict: `failed`, which the device only retries — the move never lands.
    expect($results[0]['status'])->toBe('failed');
    expect(array_column(array_slice($results, 1), 'reason'))->toBe(['group_rejected', 'group_rejected']);
    expect(groupedPositions([$first, $second, $third]))->toEqual([$first => 1, $second => 2, $third => 3]);

    forgetGroupedOps([$first, $second, $third]);
});

test('a switch to queue — the day\'s visits renumbered by time and the schedule row — is applied whole', function () {
    $tenOClock = now('Africa/Cairo')->setTime(10, 0)->utc();
    $nineOClock = now('Africa/Cairo')->setTime(9, 0)->utc();
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'visitIds' => [$late, $early]] = groupedMovesDay([
        ['position' => 1, 'scheduled_at' => $tenOClock, 'unique_scheduled_at' => $tenOClock],
        ['position' => 2, 'scheduled_at' => $nineOClock, 'unique_scheduled_at' => $nineOClock],
    ]);
    $scheduleId = groupedSchedule($credential, $practitionerId);
    $group = (string) Str::uuid();
    $queued = ['scheduled_at' => null, 'unique_scheduled_at' => null];
    $ops = [
        groupedUpdateOp('visits', $late, ['position' => -1], 1, $group),
        groupedUpdateOp('visits', $early, ['position' => 1, ...$queued], 1, $group),
        groupedUpdateOp('visits', $late, ['position' => 2, ...$queued], 2, $group),
        groupedUpdateOp('schedules', $scheduleId, ['mode' => 'queue'], 1, $group),
    ];

    $results = pushOps($credential['token'], $ops)->assertOk()->json('results');

    expect(array_column($results, 'status'))->toBe(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(groupedPositions([$late, $early]))->toEqual([$late => 2, $early => 1]);
    expect($this->fx()->table('visits')->whereIn('id', [$late, $early])->whereNotNull('scheduled_at')->exists())->toBeFalse();
    expect($this->fx()->table('schedules')->where('id', $scheduleId)->value('mode'))->toBe('queue');

    forgetGroupedOps([$late, $early, $scheduleId], [$scheduleId]);
});

test('two devices switch the same doctor: the later one, on what it saw before, is refused whole', function () {
    $tenOClock = now('Africa/Cairo')->setTime(10, 0)->utc();
    $nineOClock = now('Africa/Cairo')->setTime(9, 0)->utc();
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'visitIds' => [$late, $early]] = groupedMovesDay([
        ['position' => 1, 'scheduled_at' => $tenOClock, 'unique_scheduled_at' => $tenOClock],
        ['position' => 2, 'scheduled_at' => $nineOClock, 'unique_scheduled_at' => $nineOClock],
    ]);
    $scheduleId = groupedSchedule($credential, $practitionerId);
    $queued = ['scheduled_at' => null, 'unique_scheduled_at' => null];

    // Both devices write their switch on the same rows, at the same revs.
    $groupA = (string) Str::uuid();
    $opsA = [
        groupedUpdateOp('visits', $late, ['position' => -1], 1, $groupA),
        groupedUpdateOp('visits', $early, ['position' => 1, ...$queued], 1, $groupA),
        groupedUpdateOp('visits', $late, ['position' => 2, ...$queued], 2, $groupA),
        groupedUpdateOp('schedules', $scheduleId, ['mode' => 'queue'], 1, $groupA),
    ];
    $groupB = (string) Str::uuid();
    $opsB = [
        groupedUpdateOp('visits', $late, ['position' => -1], 1, $groupB),
        groupedUpdateOp('visits', $early, ['position' => 1, ...$queued], 1, $groupB),
        groupedUpdateOp('visits', $late, ['position' => 2, ...$queued], 2, $groupB),
        groupedUpdateOp('schedules', $scheduleId, ['mode' => 'queue', 'slot_minutes' => 20], 1, $groupB),
    ];

    expect(array_column(pushOps($credential['token'], $opsA)->assertOk()->json('results'), 'status'))->toBe(['accepted', 'accepted', 'accepted', 'accepted']);
    $afterA = (array) $this->fx()->table('schedules')->where('id', $scheduleId)->first();
    $results = pushOps($credential['token'], $opsB)->assertOk()->json('results');

    expect($results[0])->toMatchArray(['status' => 'rejected', 'reason' => 'conflict_stale_rev']);
    expect(array_column(array_slice($results, 1), 'reason'))->toBe(['group_rejected', 'group_rejected', 'group_rejected']);
    expect(groupedPositions([$late, $early]))->toEqual([$late => 2, $early => 1]);
    expect((array) $this->fx()->table('schedules')->where('id', $scheduleId)->first())->toEqual($afterA);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', array_column($opsB, 'op_id'))->exists())->toBeFalse();

    forgetGroupedOps([$late, $early, $scheduleId], [$scheduleId]);
});
