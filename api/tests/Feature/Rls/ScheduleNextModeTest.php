<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * schedules.next_mode and schedules.next_mode_from
 * (2026_09_12_000035_add_next_mode_to_schedules_table.php): a doctor's
 * slots/queue switch, dated. They sync like every other schedule field —
 * SyncOpApplier merges the payload as-is and the pull returns whole rows —
 * and the existing schedules policy keeps them out of another org's reach.
 *
 * @return array{op_id: string, entity: string, entity_id: string, action: string, payload: array, created_at: string, base_rev?: int}
 */
function scheduleOp(array $credential, string $practitionerId, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();
    $action = $overrides['action'] ?? 'create';

    $op = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'schedules',
        'entity_id' => $entityId,
        'action' => $action,
        'payload' => array_merge([
            'id' => $entityId,
            'practitioner_id' => $practitionerId,
            'location_id' => $credential['locationId'],
            'weekday' => 1,
            'start_time' => '09:00',
            'end_time' => '14:00',
            'mode' => 'slots',
            'slot_minutes' => 30,
            'max_capacity' => null,
            'resource_count' => 1,
            'next_mode' => null,
            'next_mode_from' => null,
        ], $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ];

    if ($action !== 'create') {
        $op['base_rev'] = $overrides['base_rev'] ?? 1;
    }

    return $op;
}

/**
 * @return array{credential: array, practitionerId: string}
 */
function scheduleFixture(): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();

    return [
        'credential' => $credential,
        'practitionerId' => $test->makePractitioner($credential['orgId'], $test->makeSpecialtyTemplate(null)),
    ];
}

function cleanupScheduleOps(string $scheduleId, array $opIds): void
{
    $fx = test()->fx();
    $fx->table('audit_log')->where('entity_id', $scheduleId)->delete();
    $fx->table('sync_ledger')->whereIn('op_id', $opIds)->delete();
    $fx->table('schedules')->where('id', $scheduleId)->delete();
}

test('next_mode has mode\'s type and next_mode_from is a date, both nullable', function () {
    $columns = collect($this->asOwner()->select(<<<'SQL'
        SELECT column_name, data_type, character_maximum_length, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'schedules' AND column_name IN ('mode', 'next_mode', 'next_mode_from')
    SQL))->keyBy('column_name');

    expect($columns['next_mode']->data_type)->toBe($columns['mode']->data_type);
    expect($columns['next_mode']->character_maximum_length)->toBe($columns['mode']->character_maximum_length);
    expect($columns['next_mode']->is_nullable)->toBe('YES');
    expect($columns['next_mode_from']->data_type)->toBe('date');
    expect($columns['next_mode_from']->is_nullable)->toBe('YES');
});

test('the CHECK refuses any next_mode but slots and queue', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = scheduleFixture();
    $row = scheduleOp($credential, $practitionerId)['payload'];

    expect(fn () => $this->fx()->table('schedules')->insert(array_merge($row, [
        'next_mode' => 'walkin', 'next_mode_from' => '2026-10-18',
    ])))->toThrow(QueryException::class, 'schedules_next_mode_check');
    expect($this->fx()->table('schedules')->where('id', $row['id'])->exists())->toBeFalse();

    foreach (['slots', 'queue'] as $mode) {
        $id = (string) Str::uuid();
        $this->fx()->table('schedules')->insert(array_merge($row, ['id' => $id, 'next_mode' => $mode, 'next_mode_from' => '2026-10-18']));
        expect($this->fx()->table('schedules')->where('id', $id)->value('next_mode'))->toBe($mode);
        $this->fx()->table('schedules')->where('id', $id)->delete();
    }
});

test('a pushed switch round trips: next_mode and next_mode_from are stored and pulled as written', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = scheduleFixture();
    $create = scheduleOp($credential, $practitionerId);
    pushOps($credential['token'], [$create])->assertJson(['results' => [['status' => 'accepted', 'rev' => 1]]]);

    $switch = scheduleOp($credential, $practitionerId, [
        'entity_id' => $create['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
        'payload' => array_merge($create['payload'], ['next_mode' => 'queue', 'next_mode_from' => '2026-10-18']),
    ]);

    pushOps($credential['token'], [$switch])
        ->assertOk()
        ->assertJson(['results' => [['op_id' => $switch['op_id'], 'status' => 'accepted', 'rev' => 2]]]);

    $row = $this->fx()->table('schedules')->where('id', $create['entity_id'])->first();
    expect($row->next_mode)->toBe('queue');
    expect($row->next_mode_from)->toBe('2026-10-18');
    // Today's mode is untouched by the switch.
    expect($row->mode)->toBe('slots');

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'))
        ->where('entity_id', $create['entity_id'])
        ->last();
    expect($pulled['payload']['next_mode'])->toBe('queue');
    expect($pulled['payload']['next_mode_from'])->toBe('2026-10-18');
    expect($pulled['payload']['mode'])->toBe('slots');

    // Switching back before the start date clears both; so does the fold
    // (mode := next_mode), which is the same two nulls beside a new mode.
    $fold = scheduleOp($credential, $practitionerId, [
        'entity_id' => $create['entity_id'],
        'action' => 'update',
        'base_rev' => 2,
        'payload' => array_merge($create['payload'], ['mode' => 'queue', 'next_mode' => null, 'next_mode_from' => null]),
    ]);
    pushOps($credential['token'], [$fold])->assertJson(['results' => [['op_id' => $fold['op_id'], 'status' => 'accepted', 'rev' => 3]]]);

    $row = $this->fx()->table('schedules')->where('id', $create['entity_id'])->first();
    expect($row->mode)->toBe('queue');
    expect($row->next_mode)->toBeNull();
    expect($row->next_mode_from)->toBeNull();

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'))
        ->where('entity_id', $create['entity_id'])
        ->last();
    expect($pulled['payload']['next_mode'])->toBeNull();
    expect($pulled['payload']['next_mode_from'])->toBeNull();

    cleanupScheduleOps($create['entity_id'], [$create['op_id'], $switch['op_id'], $fold['op_id']]);
});

test('another org can neither create a schedule on a doctor of this org nor switch its mode', function () {
    ['credential' => $credentialA, 'practitionerId' => $practitionerId] = scheduleFixture();
    $create = scheduleOp($credentialA, $practitionerId);
    pushOps($credentialA['token'], [$create])->assertJson(['results' => [['status' => 'accepted', 'rev' => 1]]]);

    $credentialB = makeAuthenticatedDevice();
    $foreignCreate = scheduleOp($credentialB, $practitionerId, ['payload' => ['next_mode' => 'queue', 'next_mode_from' => '2026-10-18']]);
    $foreignSwitch = scheduleOp($credentialB, $practitionerId, [
        'entity_id' => $create['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
        'payload' => ['next_mode' => 'queue', 'next_mode_from' => '2026-10-18'],
    ]);

    pushOps($credentialB['token'], [$foreignCreate, $foreignSwitch])->assertOk()->assertJson(['results' => [
        ['op_id' => $foreignCreate['op_id'], 'status' => 'failed', 'reason' => 'internal_error'],
        ['op_id' => $foreignSwitch['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev'],
    ]]);

    expect($this->fx()->table('schedules')->where('id', $foreignCreate['entity_id'])->exists())->toBeFalse();
    $row = $this->fx()->table('schedules')->where('id', $create['entity_id'])->first();
    expect($row->next_mode)->toBeNull();
    expect($row->next_mode_from)->toBeNull();
    expect($row->rev)->toBe(1);

    // Nor can B's membership read A's row, its next mode included.
    $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($create) {
        expect($db->table('schedules')->where('id', $create['entity_id'])->exists())->toBeFalse();
    });

    cleanupScheduleOps($create['entity_id'], [$create['op_id'], $foreignCreate['op_id'], $foreignSwitch['op_id']]);
});
