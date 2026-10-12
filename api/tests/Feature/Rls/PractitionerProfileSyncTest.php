<?php

use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Practitioners sync with name, title and syndicate number editable
 * (2026_09_12_000027_add_profile_and_rev_to_practitioners.php,
 * 2026_09_12_000028_add_practitioner_profile_to_register_device.php,
 * SyncOpApplier's profile rule, docs/schema.md's v18 additions).
 */

/**
 * @return array{credential: array, practitionerId: string, row: array<string, mixed>}
 */
function practitionerProfileFixture(): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();
    $specialtyId = $test->makeSpecialtyTemplate(null);
    $practitionerId = $test->makePractitioner($credential['orgId'], $specialtyId, 'أحمد المصري');

    return [
        'credential' => $credential,
        'practitionerId' => $practitionerId,
        'row' => (array) $test->fx()->table('practitioners')->where('id', $practitionerId)->first(),
    ];
}

/**
 * The whole row, as the device sends it, with `$changes` applied.
 *
 * @return array{op_id: string, entity: string, entity_id: string, action: string, payload: ?array, created_at: string, base_rev?: int}
 */
function practitionerOp(array $row, string $action = 'update', array $changes = [], int $baseRev = 1): array
{
    $op = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'practitioners',
        'entity_id' => $row['id'],
        'action' => $action,
        'payload' => $action === 'delete' ? null : array_merge($row, $changes),
        'created_at' => now()->toIso8601String(),
    ];

    if ($action !== 'create') {
        $op['base_rev'] = $baseRev;
    }

    return $op;
}

function cleanupPractitionerOps(string $practitionerId, array $opIds): void
{
    $fx = test()->fx();
    $fx->table('audit_log')->where('entity_id', $practitionerId)->delete();
    $fx->table('sync_ledger')->whereIn('op_id', $opIds)->delete();
}

test('practitioners carry a nullable syndicate_number and a rev enforced by the shared trigger', function () {
    ['practitionerId' => $practitionerId, 'row' => $row] = practitionerProfileFixture();

    expect($row)->toHaveKeys(['syndicate_number', 'rev']);
    expect($row['syndicate_number'])->toBeNull();
    expect($row['rev'])->toBe(1);

    $column = $this->fx()->selectOne(
        "SELECT data_type, character_maximum_length, is_nullable FROM information_schema.columns
         WHERE table_name = 'practitioners' AND column_name = 'syndicate_number'"
    );
    expect([$column->data_type, $column->character_maximum_length, $column->is_nullable])
        ->toBe(['character varying', 50, 'YES']);

    $trigger = $this->fx()->selectOne(
        "SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE t.tgrelid = 'practitioners'::regclass AND p.proname = 'enforce_row_rev' AND NOT t.tgisinternal"
    );
    expect($trigger?->tgname)->toBe('practitioners_enforce_rev');

    // A client-supplied rev is never honoured.
    $this->fx()->table('practitioners')->where('id', $practitionerId)->update(['title' => 'x', 'rev' => 999]);
    expect($this->fx()->table('practitioners')->where('id', $practitionerId)->value('rev'))->toBe(2);
});

test('the practitioners policy and clintra_app\'s grants are unchanged', function () {
    $policies = $this->fx()->select(
        "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'practitioners' ORDER BY policyname"
    );
    expect(collect($policies)->map(fn ($p) => [$p->policyname, $p->cmd, $p->qual, $p->with_check])->all())
        ->toBe([['practitioners_scope', 'ALL', '(org_id = current_org())', '(org_id = current_org())']]);

    $flags = $this->fx()->selectOne("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'practitioners'");
    expect([$flags->relrowsecurity, $flags->relforcerowsecurity])->toBe([true, true]);

    // Read as clintra_owner, the grantor: information_schema shows a grant
    // only to a role that is party to it (ProvisioningRoleGrantsTest does the same).
    $grants = collect($this->asOwner()->select(
        "SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'practitioners' AND grantee = 'clintra_app' ORDER BY privilege_type"
    ))->pluck('privilege_type')->all();
    expect($grants)->toBe(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);

    $columnGrants = $this->asOwner()->select(
        "SELECT column_name FROM information_schema.column_privileges
         WHERE table_name = 'practitioners' AND grantee = 'clintra_app'
           AND column_name IN ('syndicate_number', 'rev')"
    );
    // Table-level grants show up per column here too: both new columns are covered.
    expect(collect($columnGrants)->pluck('column_name')->unique()->sort()->values()->all())->toBe(['rev', 'syndicate_number']);
});

test('an update of name, title and syndicate number is accepted, bumps rev, and pull returns it', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'row' => $row] = practitionerProfileFixture();
    $op = practitionerOp($row, 'update', [
        'full_name' => 'أحمد محمود المصري',
        'title' => 'استشاري العلاج الطبيعي',
        'syndicate_number' => '12345',
    ]);

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => 2]]]);
    $stored = $this->fx()->table('practitioners')->where('id', $practitionerId)->first();
    expect([$stored->full_name, $stored->title, $stored->syndicate_number, $stored->rev])
        ->toBe(['أحمد محمود المصري', 'استشاري العلاج الطبيعي', '12345', 2]);

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'))->firstWhere('entity_id', $practitionerId);
    expect($pulled)->not->toBeNull();
    expect($pulled['entity'])->toBe('practitioners');
    expect($pulled['rev'])->toBe(2);
    expect($pulled['payload']['syndicate_number'])->toBe('12345');
    expect($pulled['payload']['full_name'])->toBe('أحمد محمود المصري');

    // Clearing it: null syndicate number, "" title (the column is NOT NULL;
    // the request pipeline delivers that "" as null, stored as "" again).
    $clear = practitionerOp((array) $stored, 'update', ['title' => '', 'syndicate_number' => null], 2);
    pushOps($credential['token'], [$clear])->assertJson(['results' => [['status' => 'accepted', 'rev' => 3]]]);
    $cleared = $this->fx()->table('practitioners')->where('id', $practitionerId)->first();
    expect([$cleared->title, $cleared->syndicate_number])->toBe(['', null]);

    cleanupPractitionerOps($practitionerId, [$op['op_id'], $clear['op_id']]);
});

test('a create or a delete of a practitioner is refused as practitioner_not_editable', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'row' => $row] = practitionerProfileFixture();
    $newId = (string) Str::uuid();
    $create = practitionerOp(array_merge($row, ['id' => $newId]), 'create');
    $delete = practitionerOp($row, 'delete');

    $response = pushOps($credential['token'], [$create, $delete]);

    $response->assertOk();
    $response->assertJson(['results' => [
        ['op_id' => $create['op_id'], 'status' => 'rejected', 'reason' => 'practitioner_not_editable'],
        ['op_id' => $delete['op_id'], 'status' => 'rejected', 'reason' => 'practitioner_not_editable'],
    ]]);
    expect($this->fx()->table('practitioners')->where('id', $newId)->exists())->toBeFalse();
    expect($this->fx()->table('practitioners')->where('id', $practitionerId)->value('rev'))->toBe(1);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', [$create['op_id'], $delete['op_id']])->exists())->toBeFalse();
});

test('an update that changes any other column is refused as practitioner_not_editable', function (string $column, mixed $value) {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'row' => $row] = practitionerProfileFixture();
    if ($column === 'specialty_id') {
        $value = $this->makeSpecialtyTemplate(null, 'other-'.Str::random(6));
    }
    if ($column === 'user_id') {
        $value = $this->makeUser('linked-'.Str::random(6));
    }
    $op = practitionerOp($row, 'update', [$column => $value, 'syndicate_number' => '777']);

    $response = pushOps($credential['token'], [$op]);

    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'practitioner_not_editable']]]);
    $stored = $this->fx()->table('practitioners')->where('id', $practitionerId)->first();
    expect($stored->rev)->toBe(1);
    expect($stored->syndicate_number)->toBeNull();
})->with([
    'is_active' => ['is_active', false],
    'specialty_id' => ['specialty_id', null],
    'user_id' => ['user_id', null],
    'an unknown column' => ['nickname', 'x'],
]);

test('the profile is validated: a blank name, a non-string title or a syndicate number over 50 characters is refused', function (array $changes) {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'row' => $row] = practitionerProfileFixture();
    $op = practitionerOp($row, 'update', $changes);

    $response = pushOps($credential['token'], [$op]);

    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'practitioner_profile_invalid']]]);
    expect($this->fx()->table('practitioners')->where('id', $practitionerId)->value('rev'))->toBe(1);
})->with([
    'blank name' => [['full_name' => "  \t "]],
    'empty name' => [['full_name' => '']],
    'a title that is not a string' => [['title' => ['x']]],
    'syndicate number of 51 characters' => [['syndicate_number' => str_repeat('1', 51)]],
]);

test('a syndicate number of exactly 50 characters is accepted', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'row' => $row] = practitionerProfileFixture();
    $op = practitionerOp($row, 'update', ['syndicate_number' => str_repeat('9', 50)]);

    pushOps($credential['token'], [$op])->assertJson(['results' => [['status' => 'accepted', 'rev' => 2]]]);

    cleanupPractitionerOps($practitionerId, [$op['op_id']]);
});

test('org B can neither read nor update org A\'s practitioners', function () {
    ['credential' => $credentialA, 'practitionerId' => $practitionerId, 'row' => $row] = practitionerProfileFixture();
    $this->fx()->table('practitioners')->where('id', $practitionerId)->update(['syndicate_number' => 'A-555']);
    $credentialB = makeAuthenticatedDevice();

    // Push as org B: the payload names org A, so it fails before any write.
    $asIs = practitionerOp($row, 'update', ['syndicate_number' => 'B-1'], 2);
    pushOps($credentialB['token'], [$asIs])
        ->assertJson(['results' => [['op_id' => $asIs['op_id'], 'status' => 'failed', 'reason' => 'org_mismatch']]]);
    // And with org B's own org_id: the row is invisible, so nothing matches.
    $disguised = practitionerOp($row, 'update', ['org_id' => $credentialB['orgId'], 'syndicate_number' => 'B-1'], 2);
    pushOps($credentialB['token'], [$disguised])
        ->assertJson(['results' => [['op_id' => $disguised['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev']]]);
    expect($this->fx()->table('practitioners')->where('id', $practitionerId)->value('syndicate_number'))->toBe('A-555');

    // Org B's bootstrap never carries it, nor does its pull.
    expect(collect(drainBootstrap($credentialB['token']))->pluck('entity_id'))->not->toContain($practitionerId);
    expect(pullOps($credentialB['token'])->assertOk()->getContent())->not->toContain('A-555');

    // Directly, on the RLS-bound connection as org B's membership.
    $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($practitionerId) {
        expect($db->table('practitioners')->where('id', $practitionerId)->exists())->toBeFalse();
        expect($db->table('practitioners')->where('id', $practitionerId)->update(['syndicate_number' => 'B-2']))->toBe(0);
    });
    expect($this->fx()->table('practitioners')->where('id', $practitionerId)->value('syndicate_number'))->toBe('A-555');

    // Sanity: org A's own membership sees it.
    $this->withMembership($this->asApp(), $credentialA['membershipId'], function ($db) use ($practitionerId) {
        expect($db->table('practitioners')->where('id', $practitionerId)->value('syndicate_number'))->toBe('A-555');
    });
});

test('bootstrap returns every practitioner of the org, with its syndicate number and rev', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId] = practitionerProfileFixture();
    $this->fx()->table('practitioners')->where('id', $practitionerId)->update(['syndicate_number' => '4242']);
    $second = $this->makePractitioner($credential['orgId'], $this->makeSpecialtyTemplate(null, 'g2-'.Str::random(6)), 'سلمى إبراهيم');

    $rows = collect(drainBootstrap($credential['token']))->where('entity', 'practitioners');

    expect($rows->pluck('entity_id')->sort()->values()->all())->toBe(collect([$practitionerId, $second])->sort()->values()->all());
    $row = $rows->firstWhere('entity_id', $practitionerId);
    expect($row['payload']['syndicate_number'])->toBe('4242');
    expect($row['rev'])->toBe(2);
});

test('register_device returns each practitioner with its syndicate number and rev', function () {
    RateLimiter::clear('device-register:ip:127.0.0.1');
    $fixture = makeRegistrationFixture();
    $practitionerId = $this->makePractitioner($fixture['orgId'], $this->makeSpecialtyTemplate(null), 'أحمد المصري');
    $this->fx()->table('practitioners')->where('id', $practitionerId)->update(['syndicate_number' => '98765']);

    $response = $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertOk();
    $practitioners = collect($response->json('practitioners'));
    expect($practitioners->pluck('id')->all())->toBe([$practitionerId]);
    expect($practitioners->first())->toHaveKeys(['id', 'org_id', 'user_id', 'full_name', 'specialty_id', 'title', 'is_active', 'syndicate_number', 'rev']);
    expect($practitioners->first()['syndicate_number'])->toBe('98765');
    expect($practitioners->first()['rev'])->toBe(2);

    // register_device's own rows, before afterEach removes the fixtures they point at.
    $deviceId = $response->json('device_id');
    $this->fx()->table('activation_codes')->where('id', $fixture['codeId'])->update(['used_by_device_id' => null]);
    $this->fx()->table('device')->where('id', $deviceId)->delete();
    $this->fx()->table('audit_log')->where('org_id', $fixture['orgId'])->delete();
});
