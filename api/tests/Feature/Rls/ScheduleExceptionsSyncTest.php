<?php

use Illuminate\Support\Str;

/**
 * schedule_exceptions is syncable
 * (2026_09_12_000038_make_schedule_exceptions_syncable.php): a doctor's
 * closed date or one-day hours, written on a device and pulled by the
 * others. It carries `rev` under the shared enforce_row_rev() trigger, and
 * its policy (unchanged, the schedules expression) keeps it inside the
 * doctor's organization.
 */

/** A push op on schedule_exceptions for $practitionerId. */
function exceptionOp(string $practitionerId, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();
    $action = $overrides['action'] ?? 'create';

    $op = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'schedule_exceptions',
        'entity_id' => $entityId,
        'action' => $action,
        'payload' => $action === 'delete' ? null : array_merge([
            'id' => $entityId,
            'practitioner_id' => $practitionerId,
            'date' => now('Africa/Cairo')->addDay()->toDateString(),
            'type' => 'closed',
            'start_time' => null,
            'end_time' => null,
            'shift_minutes' => null,
        ], $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ];

    if ($action !== 'create') {
        $op['base_rev'] = $overrides['base_rev'] ?? 1;
    }

    return $op;
}

/** @return array{credential: array<string, string>, practitionerId: string} */
function exceptionFixture(): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();

    return [
        'credential' => $credential,
        'practitionerId' => $test->makePractitioner($credential['orgId'], $test->makeSpecialtyTemplate(null)),
    ];
}

function forgetExceptionOps(array $exceptionIds): void
{
    $fx = test()->fx();
    $fx->table('audit_log')->whereIn('entity_id', $exceptionIds)->delete();
    $fx->table('sync_ledger')->whereIn('entity_id', $exceptionIds)->delete();
    $fx->table('schedule_exceptions')->whereIn('id', $exceptionIds)->delete();
}

test('schedule_exceptions has a rev column and the enforcement trigger attached', function () {
    $column = $this->asOwner()->selectOne(<<<'SQL'
        SELECT data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'schedule_exceptions' AND column_name = 'rev'
    SQL);
    expect($column)->not->toBeNull();
    expect($column->data_type)->toBe('integer');
    expect($column->is_nullable)->toBe('NO');
    expect($column->column_default)->toBe('1');

    $trigger = $this->asOwner()->selectOne(<<<'SQL'
        SELECT t.tgname
        FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'schedule_exceptions'::regclass AND p.proname = 'enforce_row_rev' AND NOT t.tgisinternal
    SQL);
    expect($trigger?->tgname)->toBe('schedule_exceptions_enforce_rev');
});

test('the trigger sets rev on insert and raises it on update, whatever the writer sends', function () {
    ['practitionerId' => $practitionerId] = exceptionFixture();
    $row = exceptionOp($practitionerId)['payload'];

    $this->fx()->table('schedule_exceptions')->insert(array_merge($row, ['rev' => 40]));
    expect($this->fx()->table('schedule_exceptions')->where('id', $row['id'])->value('rev'))->toBe(1);

    $this->fx()->table('schedule_exceptions')->where('id', $row['id'])->update(['type' => 'shifted', 'start_time' => '10:00', 'end_time' => '13:00', 'rev' => 1]);
    expect($this->fx()->table('schedule_exceptions')->where('id', $row['id'])->value('rev'))->toBe(2);

    $this->fx()->table('schedule_exceptions')->where('id', $row['id'])->delete();
});

test('a closure and a day\'s own hours round trip through push and pull, and a delete is pulled as gone', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = exceptionFixture();
    $closure = exceptionOp($practitionerId);
    $hours = exceptionOp($practitionerId, ['payload' => [
        'date' => now('Africa/Cairo')->addDays(2)->toDateString(),
        'type' => 'shifted',
        'start_time' => '10:00',
        'end_time' => '13:30',
    ]]);

    pushOps($credential['token'], [$closure, $hours])->assertOk()->assertJson(['results' => [
        ['op_id' => $closure['op_id'], 'status' => 'accepted', 'rev' => 1],
        ['op_id' => $hours['op_id'], 'status' => 'accepted', 'rev' => 1],
    ]]);

    $rows = collect(pullOps($credential['token'])->assertOk()->json('rows'))->where('entity', 'schedule_exceptions')->keyBy('entity_id');
    expect($rows[$closure['entity_id']]['payload'])->toMatchArray([
        'practitioner_id' => $practitionerId,
        'date' => $closure['payload']['date'],
        'type' => 'closed',
        'start_time' => null,
        'end_time' => null,
        'rev' => 1,
    ]);
    expect($rows[$hours['entity_id']]['payload'])->toMatchArray(['type' => 'shifted', 'start_time' => '10:00', 'end_time' => '13:30']);

    $delete = exceptionOp($practitionerId, ['entity_id' => $closure['entity_id'], 'action' => 'delete', 'base_rev' => 1]);
    pushOps($credential['token'], [$delete])->assertOk()->assertJson(['results' => [['op_id' => $delete['op_id'], 'status' => 'accepted']]]);

    $last = collect(pullOps($credential['token'])->assertOk()->json('rows'))->where('entity_id', $closure['entity_id'])->last();
    expect($last['payload'])->toBeNull();
    expect($this->fx()->table('schedule_exceptions')->where('id', $closure['entity_id'])->exists())->toBeFalse();

    forgetExceptionOps([$closure['entity_id'], $hours['entity_id']]);
});

test('a fresh device\'s bootstrap carries the exceptions in its window', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = exceptionFixture();
    $closure = exceptionOp($practitionerId);
    pushOps($credential['token'], [$closure])->assertOk();

    $rows = [];
    $cursor = null;
    do {
        $page = $this->withHeaders(['Authorization' => "Bearer {$credential['token']}"])
            ->getJson('/api/sync/bootstrap'.($cursor === null ? '' : '?cursor='.urlencode($cursor)))
            ->assertOk()
            ->json();
        $rows = [...$rows, ...$page['rows']];
        $cursor = $page['cursor'];
    } while ($page['has_more']);

    $pulled = collect($rows)->firstWhere('entity_id', $closure['entity_id']);
    expect($pulled['entity'])->toBe('schedule_exceptions');
    expect($pulled['payload']['type'])->toBe('closed');

    forgetExceptionOps([$closure['entity_id']]);
});

test('another org can neither add an exception for this org\'s doctor, change one, nor read one', function () {
    ['credential' => $credentialA, 'practitionerId' => $practitionerId] = exceptionFixture();
    $closure = exceptionOp($practitionerId);
    pushOps($credentialA['token'], [$closure])->assertJson(['results' => [['status' => 'accepted', 'rev' => 1]]]);

    $credentialB = makeAuthenticatedDevice();
    $foreignCreate = exceptionOp($practitionerId);
    $foreignChange = exceptionOp($practitionerId, [
        'entity_id' => $closure['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
        'payload' => ['type' => 'shifted', 'start_time' => '09:00', 'end_time' => '10:00'],
    ]);

    $results = pushOps($credentialB['token'], [$foreignCreate, $foreignChange])->assertOk()->json('results');
    expect(array_column($results, 'status'))->not->toContain('accepted');

    expect($this->fx()->table('schedule_exceptions')->where('id', $foreignCreate['entity_id'])->exists())->toBeFalse();
    $row = $this->fx()->table('schedule_exceptions')->where('id', $closure['entity_id'])->first();
    expect($row->type)->toBe('closed');
    expect($row->rev)->toBe(1);

    $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($closure) {
        expect($db->table('schedule_exceptions')->where('id', $closure['entity_id'])->exists())->toBeFalse();
    });
    $pulledByB = collect(pullOps($credentialB['token'])->assertOk()->json('rows'))->where('entity_id', $closure['entity_id']);
    expect($pulledByB)->toBeEmpty();

    forgetExceptionOps([$closure['entity_id'], $foreignCreate['entity_id']]);
});

/*
 * schedule_exceptions.reason (docs/schema.md's v27 additions,
 * 2026_09_12_000039_add_reason_to_schedule_exceptions.php): a closure's
 * optional reason, a nullable varchar(200) synced with the rest of the
 * row, inside the table's policy like every other column.
 */

test('reason is a nullable varchar(200) with no default', function () {
    $column = $this->asOwner()->selectOne(<<<'SQL'
        SELECT data_type, character_maximum_length, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'schedule_exceptions' AND column_name = 'reason'
    SQL);

    expect($column)->not->toBeNull();
    expect($column->data_type)->toBe('character varying');
    expect($column->character_maximum_length)->toBe(200);
    expect($column->is_nullable)->toBe('YES');
    expect($column->column_default)->toBeNull();
});

test('a closure\'s reason round trips through push, pull and bootstrap, and an update sending null clears it', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = exceptionFixture();
    $closure = exceptionOp($practitionerId, ['payload' => ['reason' => 'سفر مؤتمر']]);

    pushOps($credential['token'], [$closure])->assertOk()
        ->assertJson(['results' => [['op_id' => $closure['op_id'], 'status' => 'accepted', 'rev' => 1]]]);
    expect($this->fx()->table('schedule_exceptions')->where('id', $closure['entity_id'])->value('reason'))->toBe('سفر مؤتمر');

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'))->where('entity_id', $closure['entity_id'])->last();
    expect($pulled['payload']['reason'])->toBe('سفر مؤتمر');

    $rows = [];
    $cursor = null;
    do {
        $page = $this->withHeaders(['Authorization' => "Bearer {$credential['token']}"])
            ->getJson('/api/sync/bootstrap'.($cursor === null ? '' : '?cursor='.urlencode($cursor)))
            ->assertOk()
            ->json();
        $rows = [...$rows, ...$page['rows']];
        $cursor = $page['cursor'];
    } while ($page['has_more']);
    expect(collect($rows)->firstWhere('entity_id', $closure['entity_id'])['payload']['reason'])->toBe('سفر مؤتمر');

    $clear = exceptionOp($practitionerId, [
        'entity_id' => $closure['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
        'payload' => ['reason' => null],
    ]);
    pushOps($credential['token'], [$clear])->assertOk()
        ->assertJson(['results' => [['op_id' => $clear['op_id'], 'status' => 'accepted', 'rev' => 2]]]);
    expect($this->fx()->table('schedule_exceptions')->where('id', $closure['entity_id'])->value('reason'))->toBeNull();

    forgetExceptionOps([$closure['entity_id']]);
});

test('an exception pushed without reason reads null, and an update that leaves reason out keeps it', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = exceptionFixture();
    // A device not yet updated sends the row without the column.
    $old = exceptionOp($practitionerId);
    $withReason = exceptionOp($practitionerId, ['payload' => [
        'date' => now('Africa/Cairo')->addDays(3)->toDateString(),
        'reason' => 'إجازة سنوية',
    ]]);
    pushOps($credential['token'], [$old, $withReason])->assertOk();
    expect($this->fx()->table('schedule_exceptions')->where('id', $old['entity_id'])->value('reason'))->toBeNull();

    $change = exceptionOp($practitionerId, [
        'entity_id' => $withReason['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
        'payload' => ['date' => now('Africa/Cairo')->addDays(4)->toDateString()],
    ]);
    pushOps($credential['token'], [$change])->assertOk()
        ->assertJson(['results' => [['op_id' => $change['op_id'], 'status' => 'accepted', 'rev' => 2]]]);
    expect($this->fx()->table('schedule_exceptions')->where('id', $withReason['entity_id'])->value('reason'))->toBe('إجازة سنوية');

    forgetExceptionOps([$old['entity_id'], $withReason['entity_id']]);
});

test('a reason over 200 characters is not stored, and nothing is written', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = exceptionFixture();
    $atLimit = exceptionOp($practitionerId, ['payload' => ['reason' => str_repeat('س', 200)]]);
    $overLimit = exceptionOp($practitionerId, ['payload' => [
        'date' => now('Africa/Cairo')->addDays(2)->toDateString(),
        'reason' => str_repeat('س', 201),
    ]]);

    $results = pushOps($credential['token'], [$atLimit, $overLimit])->assertOk()->json('results');

    expect($results[0]['status'])->toBe('accepted');
    expect($results[1]['status'])->not->toBe('accepted');
    expect(mb_strlen($this->fx()->table('schedule_exceptions')->where('id', $atLimit['entity_id'])->value('reason')))->toBe(200);
    expect($this->fx()->table('schedule_exceptions')->where('id', $overLimit['entity_id'])->exists())->toBeFalse();
    expect($this->fx()->table('sync_ledger')->where('op_id', $overLimit['op_id'])->exists())->toBeFalse();

    forgetExceptionOps([$atLimit['entity_id'], $overLimit['entity_id']]);
});

test('another org can neither set a reason on this org\'s closure nor read it', function () {
    ['credential' => $credentialA, 'practitionerId' => $practitionerId] = exceptionFixture();
    $closure = exceptionOp($practitionerId, ['payload' => ['reason' => 'سفر للخارج']]);
    pushOps($credentialA['token'], [$closure])->assertOk();

    $credentialB = makeAuthenticatedDevice();
    $foreign = exceptionOp($practitionerId, [
        'entity_id' => $closure['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
        'payload' => ['reason' => 'سبب من بره'],
    ]);
    $results = pushOps($credentialB['token'], [$foreign])->assertOk()->json('results');

    expect(array_column($results, 'status'))->not->toContain('accepted');
    $row = $this->fx()->table('schedule_exceptions')->where('id', $closure['entity_id'])->first();
    expect($row->reason)->toBe('سفر للخارج');
    expect($row->rev)->toBe(1);
    expect(pullOps($credentialB['token'])->assertOk()->getContent())->not->toContain($closure['entity_id']);

    forgetExceptionOps([$closure['entity_id']]);
});
