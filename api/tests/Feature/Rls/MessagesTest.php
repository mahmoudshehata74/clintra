<?php

use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * messages and message_templates (docs/schema.md's v19 additions):
 * 2026_09_12_000029_create_messages_tables.php, and SyncOpApplier's message
 * and template override rules.
 */

/**
 * @return array{credential: array, patientId: string}
 */
function messageFixture(?array $credential = null): array
{
    $test = test();
    $credential ??= makeAuthenticatedDevice();

    return [
        'credential' => $credential,
        'patientId' => $test->makePatient($credential['orgId'], 'كريم فتحي'),
    ];
}

/** The whole row, as the device writes it. */
function messageRow(array $credential, string $patientId, array $overrides = []): array
{
    $now = now()->toIso8601String();

    return array_merge([
        'id' => (string) Str::uuid(),
        'org_id' => $credential['orgId'],
        'location_id' => $credential['locationId'],
        'patient_id' => $patientId,
        'visit_id' => null,
        'template_key' => 'booking_confirmation',
        'channel' => 'whatsapp',
        'phone' => '+201001234567',
        'body' => "مرحباً كريم،\nاتأكد حجزك 📅",
        'attempted_at' => $now,
        'marked_sent_at' => null,
        'created_by' => $credential['membershipId'],
        'created_at' => $now,
    ], $overrides);
}

function messageOp(array $row, string $action = 'create', int $baseRev = 1): array
{
    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => 'messages',
        'entity_id' => $row['id'],
        'action' => $action,
        'payload' => $action === 'delete' ? null : $row,
        'created_at' => now()->toIso8601String(),
    ], ['base_rev' => $baseRev]);
}

function templateRow(array $credential, array $overrides = []): array
{
    return array_merge([
        'id' => (string) Str::uuid(),
        'org_id' => $credential['orgId'],
        'key' => 'appointment_reminder',
        'body' => "مرحباً {{patient_name}}،\nبنفكّرك بموعدك بكرة.",
        'updated_by' => $credential['membershipId'],
        'updated_at' => now()->toIso8601String(),
    ], $overrides);
}

function templateOp(array $row, string $action = 'create', int $baseRev = 1): array
{
    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => 'message_templates',
        'entity_id' => $row['id'],
        'action' => $action,
        'payload' => $action === 'delete' ? null : $row,
        'created_at' => now()->toIso8601String(),
    ], ['base_rev' => $baseRev]);
}

/** Inserts a message directly (BYPASSRLS), for the visibility tests. */
function insertMessage(array $row): void
{
    test()->fx()->table('messages')->insert($row);
}

/** Removes every message and template override (and their ledger and audit rows) this org has. */
function forgetMessages(string $orgId): void
{
    $fx = test()->fx();
    $entities = ['messages', 'message_templates'];

    $fx->table('audit_log')->where('org_id', $orgId)->whereIn('entity', $entities)->delete();
    $fx->table('sync_ledger')->where('org_id', $orgId)->whereIn('entity', $entities)->delete();
    $fx->table('messages')->where('org_id', $orgId)->delete();
    $fx->table('message_templates')->where('org_id', $orgId)->delete();
}

// --- Structure ---------------------------------------------------------------

test('both tables are forced under RLS, granted to clintra_app, and carry rev with the shared trigger', function () {
    foreach (['messages', 'message_templates'] as $table) {
        $flags = $this->fx()->selectOne('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ?', [$table]);
        expect([$flags->relrowsecurity, $flags->relforcerowsecurity])->toBe([true, true]);

        $grants = collect($this->asOwner()->select(
            "SELECT privilege_type FROM information_schema.role_table_grants
             WHERE table_name = ? AND grantee = 'clintra_app' ORDER BY privilege_type",
            [$table]
        ))->pluck('privilege_type')->all();
        expect($grants)->toBe(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);

        $rev = $this->asOwner()->selectOne(
            "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = 'rev'",
            [$table]
        );
        expect([$rev->data_type, $rev->is_nullable])->toBe(['integer', 'NO']);

        $trigger = $this->fx()->selectOne(
            "SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = ?::regclass AND p.proname = 'enforce_row_rev' AND NOT t.tgisinternal",
            [$table]
        );
        expect($trigger?->tgname)->toBe("{$table}_enforce_rev");
    }
});

test('messages copies the invoices policy and message_templates the practitioners policy, both with USING and WITH CHECK', function () {
    $policy = fn (string $table) => collect($this->fx()->select(
        'SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = ? ORDER BY policyname',
        [$table]
    ))->map(fn ($p) => [$p->policyname, $p->cmd, $p->qual, $p->with_check])->all();

    [[, , $invoicesQual]] = $policy('invoices');
    expect($policy('messages'))->toBe([['messages_scope', 'ALL', $invoicesQual, $invoicesQual]]);

    [[, , $practitionersQual]] = $policy('practitioners');
    expect($policy('message_templates'))->toBe([['message_templates_scope', 'ALL', $practitionersQual, $practitionersQual]]);
});

test('the checks, unique key, indexes and non-cascading foreign keys are in place', function () {
    $checks = collect($this->fx()->select(
        "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid IN ('messages'::regclass, 'message_templates'::regclass) AND contype = 'c' ORDER BY conname"
    ))->pluck('def', 'conname')->all();
    expect(array_keys($checks))->toBe(['message_templates_key_check', 'messages_channel_check', 'messages_template_key_check']);
    expect($checks['message_templates_key_check'])->not->toContain('custom');
    expect($checks['messages_template_key_check'])->toContain('custom');

    $indexes = collect($this->fx()->select("SELECT indexname FROM pg_indexes WHERE tablename IN ('messages', 'message_templates')"))
        ->pluck('indexname')->sort()->values()->all();
    expect($indexes)->toBe([
        'message_templates_org_id_key_unique',
        'message_templates_pkey',
        'messages_attempted_at_index',
        'messages_location_id_index',
        'messages_org_id_index',
        'messages_patient_id_index',
        'messages_pkey',
    ]);

    $deleteRules = collect($this->fx()->select(
        "SELECT confdeltype FROM pg_constraint
         WHERE conrelid IN ('messages'::regclass, 'message_templates'::regclass) AND contype = 'f'"
    ))->pluck('confdeltype')->unique()->values()->all();
    expect($deleteRules)->toBe(['r']);
});

// --- Messages ----------------------------------------------------------------

test('a message is created at rev 1 with created_by from the token, then marked and unmarked; nothing else changes', function () {
    ['credential' => $credential, 'patientId' => $patientId] = messageFixture();
    $row = messageRow($credential, $patientId);
    // No claim: the token's membership (ActorAttributionTest covers claims).
    unset($row['created_by']);
    $create = messageOp($row);

    pushOps($credential['token'], [$create])->assertOk()
        ->assertJson(['results' => [['op_id' => $create['op_id'], 'status' => 'accepted', 'rev' => 1]]]);
    $stored = $this->fx()->table('messages')->where('id', $row['id'])->first();
    expect($stored->created_by)->toBe($credential['membershipId']);
    expect($stored->body)->toBe($row['body']);

    // Marked from another device in the same org, carrying the whole row as
    // the device does: created_by stays the creator's.
    $other = makeSecondAuthenticatedDeviceInSameOrg($credential['orgId'], $credential['locationId']);
    $sentAt = now()->addMinute()->toIso8601String();
    $mark = messageOp(array_merge($row, ['created_by' => $other['membershipId'], 'marked_sent_at' => $sentAt]), 'update', 1);
    pushOps($other['token'], [$mark])->assertJson(['results' => [['status' => 'accepted', 'rev' => 2]]]);
    $marked = $this->fx()->table('messages')->where('id', $row['id'])->first();
    expect($marked->marked_sent_at)->not->toBeNull();
    expect($marked->created_by)->toBe($credential['membershipId']);

    $unmark = messageOp(array_merge($row, ['marked_sent_at' => null]), 'update', 2);
    pushOps($credential['token'], [$unmark])->assertJson(['results' => [['status' => 'accepted', 'rev' => 3]]]);
    $unmarked = $this->fx()->table('messages')->where('id', $row['id'])->first();
    expect($unmarked->marked_sent_at)->toBeNull();
    expect([$unmarked->body, $unmarked->phone, $unmarked->channel, $unmarked->template_key, $unmarked->created_by])
        ->toBe([$row['body'], $row['phone'], $row['channel'], $row['template_key'], $credential['membershipId']]);

    // A whole-row update whose timestamps are the same instants in another
    // rendering changes nothing it may not change.
    $rerendered = messageOp(array_merge($row, [
        'attempted_at' => Carbon::parse($row['attempted_at'])->utc()->format('Y-m-d\TH:i:s.uP'),
        'marked_sent_at' => $sentAt,
    ]), 'update', 3);
    pushOps($credential['token'], [$rerendered])->assertJson(['results' => [['status' => 'accepted', 'rev' => 4]]]);

    forgetMessages($credential['orgId']);
});

test('an update that changes any column but marked_sent_at is refused as message_immutable', function (string $column, mixed $value) {
    ['credential' => $credential, 'patientId' => $patientId] = messageFixture();
    $row = messageRow($credential, $patientId);
    pushOps($credential['token'], [messageOp($row)])->assertJson(['results' => [['status' => 'accepted']]]);

    $value = match ($value) {
        'another patient' => $this->makePatient($credential['orgId'], 'ياسمين توفيق'),
        'a visit' => $this->makeVisit(
            $credential['orgId'],
            $credential['locationId'],
            $this->makePractitioner($credential['orgId'], $this->makeSpecialtyTemplate(null)),
            $patientId,
            $credential['membershipId'],
        ),
        'another location' => $this->makeLocation($credential['orgId'], 'loc-2'),
        'an hour later' => now()->addHour()->toIso8601String(),
        default => $value,
    };
    $op = messageOp(array_merge($row, [$column => $value, 'marked_sent_at' => now()->toIso8601String()]), 'update', 1);

    pushOps($credential['token'], [$op])
        ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'message_immutable']]]);
    $stored = $this->fx()->table('messages')->where('id', $row['id'])->first();
    expect([$stored->rev, $stored->marked_sent_at])->toBe([1, null]);

    forgetMessages($credential['orgId']);
})->with([
    'body' => ['body', 'نص تاني'],
    'phone' => ['phone', '+201112345678'],
    'channel' => ['channel', 'sms'],
    'template_key' => ['template_key', 'custom'],
    'patient_id' => ['patient_id', 'another patient'],
    'visit_id' => ['visit_id', 'a visit'],
    'location_id' => ['location_id', 'another location'],
    'attempted_at' => ['attempted_at', 'an hour later'],
    'created_at' => ['created_at', 'an hour later'],
    'an unknown column' => ['status', 'delivered'],
]);

test('a message delete is refused as message_immutable and the row stays', function () {
    ['credential' => $credential, 'patientId' => $patientId] = messageFixture();
    $row = messageRow($credential, $patientId);
    pushOps($credential['token'], [messageOp($row)])->assertJson(['results' => [['status' => 'accepted']]]);
    $delete = messageOp($row, 'delete', 1);

    pushOps($credential['token'], [$delete])
        ->assertJson(['results' => [['op_id' => $delete['op_id'], 'status' => 'rejected', 'reason' => 'message_immutable']]]);
    expect($this->fx()->table('messages')->where('id', $row['id'])->value('rev'))->toBe(1);
    expect($this->fx()->table('sync_ledger')->where('op_id', $delete['op_id'])->exists())->toBeFalse();

    forgetMessages($credential['orgId']);
});

test('a message create is validated: an empty body is refused, never stored as null', function (array $changes) {
    ['credential' => $credential, 'patientId' => $patientId] = messageFixture();
    $row = messageRow($credential, $patientId, $changes);
    $op = messageOp($row);

    pushOps($credential['token'], [$op])
        ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'message_invalid']]]);
    expect($this->fx()->table('messages')->where('id', $row['id'])->exists())->toBeFalse();
})->with([
    'empty body (arrives as null)' => [['body' => '']],
    'blank body' => [['body' => " \n\t "]],
    'unknown template key' => [['template_key' => 'promo']],
    'unknown channel' => [['channel' => 'email']],
    'a local phone, not E.164' => [['phone' => '01001234567']],
    'no attempted_at' => [['attempted_at' => null]],
]);

test('every template key, including custom, and both channels are accepted', function (string $key, string $channel) {
    ['credential' => $credential, 'patientId' => $patientId] = messageFixture();
    $op = messageOp(messageRow($credential, $patientId, ['template_key' => $key, 'channel' => $channel]));

    pushOps($credential['token'], [$op])->assertJson(['results' => [['status' => 'accepted', 'rev' => 1]]]);

    forgetMessages($credential['orgId']);
})->with([
    ['booking_confirmation', 'whatsapp'],
    ['appointment_reminder', 'sms'],
    ['post_visit_followup', 'whatsapp'],
    ['care_plan_session_reminder', 'sms'],
    ['balance_reminder', 'whatsapp'],
    ['custom', 'sms'],
]);

// --- Template overrides ------------------------------------------------------

test('a template override is created, updated and deleted, with updated_by from the token', function () {
    $credential = makeAuthenticatedDevice();
    $row = templateRow($credential);
    // No claim: the token's membership (ActorAttributionTest covers claims).
    unset($row['updated_by']);

    $create = templateOp($row);
    pushOps($credential['token'], [$create])->assertJson(['results' => [['status' => 'accepted', 'rev' => 1]]]);
    expect($this->fx()->table('message_templates')->where('id', $row['id'])->value('updated_by'))->toBe($credential['membershipId']);

    $update = templateOp(array_merge($row, ['body' => 'مرحباً {{patient_name}}']), 'update', 1);
    pushOps($credential['token'], [$update])->assertJson(['results' => [['status' => 'accepted', 'rev' => 2]]]);
    expect($this->fx()->table('message_templates')->where('id', $row['id'])->value('body'))->toBe('مرحباً {{patient_name}}');

    $delete = templateOp($row, 'delete', 2);
    pushOps($credential['token'], [$delete])->assertJson(['results' => [['status' => 'accepted', 'rev' => 2]]]);
    expect($this->fx()->table('message_templates')->where('id', $row['id'])->exists())->toBeFalse();

    forgetMessages($credential['orgId']);
});

test('a template body of exactly 4000 characters is accepted', function () {
    $credential = makeAuthenticatedDevice();
    $op = templateOp(templateRow($credential, ['body' => str_repeat('ب', 4000)]));

    pushOps($credential['token'], [$op])->assertJson(['results' => [['status' => 'accepted', 'rev' => 1]]]);

    forgetMessages($credential['orgId']);
});

test('a template create or update is refused as template_invalid for a bad key or body', function (array $changes, string $action) {
    $credential = makeAuthenticatedDevice();
    $row = templateRow($credential);

    if ($action === 'update') {
        pushOps($credential['token'], [templateOp($row)])->assertJson(['results' => [['status' => 'accepted']]]);
    }
    $op = templateOp(array_merge($row, $changes), $action, 1);

    pushOps($credential['token'], [$op])
        ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'template_invalid']]]);
    $stored = $this->fx()->table('message_templates')->where('id', $row['id'])->first();
    expect($action === 'create' ? $stored : $stored->body)->toBe($action === 'create' ? null : $row['body']);

    forgetMessages($credential['orgId']);
})->with([
    'custom has no override' => [['key' => 'custom'], 'create'],
    'unknown key' => [['key' => 'promo'], 'create'],
    'empty body (arrives as null)' => [['body' => ''], 'create'],
    'blank body' => [['body' => "  \n "], 'create'],
    'body of 4001 characters' => [['body' => str_repeat('ب', 4001)], 'create'],
    'emptied on update' => [['body' => ''], 'update'],
    'key changed to custom on update' => [['key' => 'custom'], 'update'],
]);

// --- Isolation ---------------------------------------------------------------

test('org B can neither read nor write org A\'s messages and template overrides', function () {
    ['credential' => $credentialA, 'patientId' => $patientId] = messageFixture();
    $message = messageRow($credentialA, $patientId);
    $template = templateRow($credentialA);
    pushOps($credentialA['token'], [messageOp($message), templateOp($template)])
        ->assertJson(['results' => [['status' => 'accepted'], ['status' => 'accepted']]]);
    $credentialB = makeAuthenticatedDevice();

    // The payload names org A: refused before any write.
    $markAsIs = messageOp(array_merge($message, ['marked_sent_at' => now()->toIso8601String()]), 'update', 1);
    $editAsIs = templateOp(array_merge($template, ['body' => 'B']), 'update', 1);
    pushOps($credentialB['token'], [$markAsIs, $editAsIs])->assertJson(['results' => [
        ['op_id' => $markAsIs['op_id'], 'status' => 'failed', 'reason' => 'org_mismatch'],
        ['op_id' => $editAsIs['op_id'], 'status' => 'failed', 'reason' => 'org_mismatch'],
    ]]);

    // With org B's own org_id (and, for the template, org B's own member as
    // the actor, as B's device would send): the rows are invisible, so
    // nothing matches.
    $markDisguised = messageOp(array_merge($message, ['org_id' => $credentialB['orgId'], 'marked_sent_at' => now()->toIso8601String()]), 'update', 1);
    $editDisguised = templateOp(array_merge($template, ['org_id' => $credentialB['orgId'], 'body' => 'B', 'updated_by' => $credentialB['membershipId']]), 'update', 1);
    pushOps($credentialB['token'], [$markDisguised, $editDisguised])->assertJson(['results' => [
        ['op_id' => $markDisguised['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev'],
        ['op_id' => $editDisguised['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev'],
    ]]);
    // In its own batch: a second op on an entity rejected earlier in the
    // same batch is blocked, never applied (SyncPushController).
    $deleteTemplate = templateOp($template, 'delete', 1);
    pushOps($credentialB['token'], [$deleteTemplate])
        ->assertJson(['results' => [['op_id' => $deleteTemplate['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev']]]);

    // A create naming org A's patient and location with org B's org_id is
    // refused by WITH CHECK (org B cannot see org A's location).
    $intruder = messageRow($credentialA, $patientId, ['org_id' => $credentialB['orgId'], 'created_by' => $credentialB['membershipId']]);
    $intruderOp = messageOp($intruder);
    $result = pushOps($credentialB['token'], [$intruderOp])->json('results.0');
    expect($result['status'])->not->toBe('accepted');
    expect($this->fx()->table('messages')->where('id', $intruder['id'])->exists())->toBeFalse();

    expect($this->fx()->table('messages')->where('id', $message['id'])->value('marked_sent_at'))->toBeNull();
    expect($this->fx()->table('message_templates')->where('id', $template['id'])->value('body'))->toBe($template['body']);

    // Org B's bootstrap and pull carry neither.
    $bootstrapIds = collect(drainBootstrap($credentialB['token']))->pluck('entity_id');
    expect($bootstrapIds)->not->toContain($message['id']);
    expect($bootstrapIds)->not->toContain($template['id']);
    $pulled = pullOps($credentialB['token'])->assertOk()->getContent();
    expect($pulled)->not->toContain($message['id']);
    expect($pulled)->not->toContain($template['id']);

    // Directly, on the RLS-bound connection as org B's membership.
    $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($message, $template) {
        expect($db->table('messages')->where('id', $message['id'])->exists())->toBeFalse();
        expect($db->table('message_templates')->where('id', $template['id'])->exists())->toBeFalse();
        expect($db->table('messages')->where('id', $message['id'])->update(['marked_sent_at' => now()->toIso8601String()]))->toBe(0);
        expect($db->table('message_templates')->where('id', $template['id'])->delete())->toBe(0);
    });

    // Sanity: org A's own membership sees both.
    $this->withMembership($this->asApp(), $credentialA['membershipId'], function ($db) use ($message, $template) {
        expect($db->table('messages')->where('id', $message['id'])->exists())->toBeTrue();
        expect($db->table('message_templates')->where('id', $template['id'])->exists())->toBeTrue();
    });

    forgetMessages($credentialA['orgId']);
    forgetMessages($credentialB['orgId']);
});

test('a membership limited to listed locations does not see messages at another location', function () {
    $credential = makeAuthenticatedDevice(['role' => 'assistant', 'location_scope' => 'listed']);
    $this->makeMembershipLocation($credential['membershipId'], $credential['locationId']);
    $patientId = $this->makePatient($credential['orgId'], 'عمر جمال');
    $otherLocationId = $this->makeLocation($credential['orgId'], 'فرع تاني');

    $visible = messageRow($credential, $patientId);
    $hidden = messageRow($credential, $patientId, ['location_id' => $otherLocationId]);
    insertMessage($visible);
    insertMessage($hidden);

    $this->withMembership($this->asApp(), $credential['membershipId'], function ($db) use ($visible, $hidden) {
        expect($db->table('messages')->pluck('id')->all())->toBe([$visible['id']]);
        expect($db->table('messages')->where('id', $hidden['id'])->update(['marked_sent_at' => now()->toIso8601String()]))->toBe(0);
    });

    $bootstrapIds = collect(drainBootstrap($credential['token']))->where('entity', 'messages')->pluck('entity_id')->all();
    expect($bootstrapIds)->toBe([$visible['id']]);

    // A mark pushed for the hidden one matches nothing.
    $mark = messageOp(array_merge($hidden, ['marked_sent_at' => now()->toIso8601String()]), 'update', 1);
    pushOps($credential['token'], [$mark])->assertJson(['results' => [['status' => 'rejected', 'reason' => 'conflict_stale_rev']]]);

    // And a create there is refused by WITH CHECK, never stored.
    $create = messageRow($credential, $patientId, ['location_id' => $otherLocationId]);
    expect(pushOps($credential['token'], [messageOp($create)])->json('results.0.status'))->not->toBe('accepted');
    expect($this->fx()->table('messages')->where('id', $create['id'])->exists())->toBeFalse();

    forgetMessages($credential['orgId']);
});

// --- Pull and bootstrap ------------------------------------------------------

test('pull returns pushed messages and overrides, and bootstrap returns windowed messages and every override', function () {
    ['credential' => $credential, 'patientId' => $patientId] = messageFixture();
    $recent = messageRow($credential, $patientId);
    $template = templateRow($credential);
    pushOps($credential['token'], [messageOp($recent), templateOp($template)])
        ->assertJson(['results' => [['status' => 'accepted'], ['status' => 'accepted']]]);
    $old = messageRow($credential, $patientId, ['attempted_at' => now()->subDays(200)->toIso8601String()]);
    insertMessage($old);

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'));
    expect($pulled->firstWhere('entity_id', $recent['id'])['payload']['body'])->toBe($recent['body']);
    expect($pulled->firstWhere('entity_id', $template['id'])['entity'])->toBe('message_templates');

    $rows = collect(drainBootstrap($credential['token']));
    expect($rows->where('entity', 'messages')->pluck('entity_id')->all())->toBe([$recent['id']]);
    $templateRow = $rows->firstWhere('entity_id', $template['id']);
    expect([$templateRow['entity'], $templateRow['rev'], $templateRow['payload']['key']])
        ->toBe(['message_templates', 1, 'appointment_reminder']);

    forgetMessages($credential['orgId']);
});
