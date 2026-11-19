<?php

use App\Models\Device;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Clinical corrections after completion (docs/design-clinical-corrections.md,
 * docs/schema.md's v28 additions):
 * 2026_09_12_000040_create_visit_form_revisions_table.php — the table, its
 * policies, grants and visit_form_revision_check() — and
 * 2026_09_12_000041_add_visit_form_data_completed_guard.php. Read and
 * written directly through clintra_app, and through the push, pull and
 * bootstrap endpoints (SyncOpApplier's correction rule).
 */
const STORED_FORM = ['complaint' => 'ألم في الركبة', 'diagnosis' => 'التهاب وتر'];
const CORRECTED_FORM = ['complaint' => 'ألم في الركبة', 'diagnosis' => 'التهاب وتر الرضفة'];

/**
 * An organization with a completed visit of one doctor and its stored form
 * (rev 1), the owner's device token, the doctor's, another doctor's and an
 * assistant's memberships.
 *
 * @return array<string, mixed>
 */
function correctionFixture(): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();
    $orgId = $credential['orgId'];
    $templateId = $test->makeSpecialtyTemplate(null);
    $practitionerId = $test->makePractitioner($orgId, $templateId, 'doctor');
    $otherPractitionerId = $test->makePractitioner($orgId, $templateId, 'other doctor');
    $patientId = $test->makePatient($orgId);
    // The form is written while the visit is in the room, then the visit is
    // completed: the guard holds every writer, the fixtures' included.
    $visitId = $test->makeVisit($orgId, $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], ['status' => 'in_room']);
    $formDefinitionId = $test->makeFormDefinition($templateId);
    $formId = (string) Str::uuid();
    $test->fx()->table('visit_form_data')->insert([
        'id' => $formId,
        'visit_id' => $visitId,
        'form_definition_id' => $formDefinitionId,
        'data' => json_encode(STORED_FORM),
    ]);
    $test->fx()->table('visits')->where('id', $visitId)->update(['status' => 'completed']);

    return [
        'credential' => $credential,
        'orgId' => $orgId,
        'ownerId' => $credential['membershipId'],
        'doctorId' => $test->makeMembership($test->makeUser('doctor'), $orgId, ['role' => 'practitioner', 'practitioner_id' => $practitionerId]),
        'otherDoctorId' => $test->makeMembership($test->makeUser('other'), $orgId, ['role' => 'practitioner', 'practitioner_id' => $otherPractitionerId]),
        'assistantId' => $test->makeMembership($test->makeUser('assistant'), $orgId, ['role' => 'assistant']),
        'practitionerId' => $practitionerId,
        'otherPractitionerId' => $otherPractitionerId,
        'patientId' => $patientId,
        'visitId' => $visitId,
        'formDefinitionId' => $formDefinitionId,
        'formId' => $formId,
    ];
}

/** Removes every row a test wrote for this organization that the fixtures' own cleanup does not know, children first. */
function forgetCorrectionRows(string $orgId): void
{
    $fx = test()->fx();
    $visitIds = $fx->table('visits')->where('org_id', $orgId)->pluck('id')->all();
    $invoiceIds = $fx->table('invoices')->where('org_id', $orgId)->pluck('id')->all();

    $fx->table('audit_log')->where('org_id', $orgId)->delete();
    $fx->table('sync_ledger')->where('org_id', $orgId)->delete();
    $fx->table('visit_form_revisions')->where('org_id', $orgId)->delete();
    $fx->table('visit_form_data')->whereIn('visit_id', $visitIds)->delete();
    $fx->table('payments')->whereIn('invoice_id', $invoiceIds)->delete();
    $fx->table('invoices')->whereIn('id', $invoiceIds)->delete();
}

/** Runs `$body` with a fresh fixture, then removes what it wrote even when an assertion fails. */
function withCorrectionFixture(Closure $body): void
{
    $fixture = correctionFixture();

    try {
        $body($fixture);
    } finally {
        forgetCorrectionRows($fixture['orgId']);
    }
}

/** A revision row for a direct insert through clintra_app. */
function revisionRow(array $fixture, array $overrides = []): array
{
    return array_merge([
        'id' => (string) Str::uuid(),
        'org_id' => $fixture['orgId'],
        'visit_id' => $fixture['visitId'],
        'visit_form_data_id' => $fixture['formId'],
        'revision_no' => 1,
        'replaced_rev' => 1,
        'previous_data' => json_encode(STORED_FORM),
        'new_data' => json_encode(CORRECTED_FORM),
        'reason' => 'خطأ في كتابة التشخيص',
        'corrected_by' => $fixture['doctorId'],
        'corrected_at' => now()->toIso8601String(),
        'device_id' => $fixture['credential']['deviceId'],
    ], $overrides);
}

/** Runs `$write` through clintra_app as `$membershipId`; the refusal's SQLSTATE and message, or null when it went through. */
function asAppRefusal(string $membershipId, Closure $write): ?array
{
    try {
        test()->withMembership(test()->asApp(), $membershipId, $write);
    } catch (QueryException $e) {
        return [$e->getCode(), $e->getPrevious()?->getMessage() ?? $e->getMessage()];
    }

    return null;
}

/** Inserts a revision as clintra_app; null when accepted, else [SQLSTATE, message]. */
function insertRevisionAsApp(array $fixture, array $row, ?string $as = null): ?array
{
    return asAppRefusal($as ?? $fixture['ownerId'], fn ($db) => $db->table('visit_form_revisions')->insert($row));
}

/** The message a 55000 refusal carries, for matching. */
function refusedWith(?array $refusal, string $message): void
{
    expect($refusal)->not->toBeNull();
    expect($refusal[0])->toBe('55000');
    expect($refusal[1])->toContain($message);
}

/**
 * A correction as the device pushes it: [the empty create, when $withCreate],
 * the revision, then the form update — one group.
 *
 * @return array{create: ?array, revision: array, update: array, ops: list<array>}
 */
function correctionOps(array $fixture, array $overrides = []): array
{
    $groupId = $overrides['group_id'] ?? (string) Str::uuid();
    $formId = $overrides['form_id'] ?? $fixture['formId'];
    $replacedRev = $overrides['replaced_rev'] ?? 1;
    $previous = $overrides['previous_data'] ?? STORED_FORM;
    $new = $overrides['new_data'] ?? CORRECTED_FORM;
    $revisionId = (string) Str::uuid();
    $now = now()->toIso8601String();

    $create = ($overrides['with_create'] ?? false) ? [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visit_form_data',
        'entity_id' => $formId,
        'action' => 'create',
        'payload' => [
            'id' => $formId,
            'visit_id' => $overrides['visit_id'] ?? $fixture['visitId'],
            'form_definition_id' => $fixture['formDefinitionId'],
            'data' => ['complaint' => '', 'diagnosis' => ''],
        ],
        'created_at' => $now,
        'group_id' => $groupId,
    ] : null;

    $revision = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visit_form_revisions',
        'entity_id' => $revisionId,
        'action' => 'create',
        'payload' => array_merge([
            'id' => $revisionId,
            'org_id' => $fixture['orgId'],
            'visit_id' => $overrides['visit_id'] ?? $fixture['visitId'],
            'visit_form_data_id' => $formId,
            'revision_no' => $overrides['revision_no'] ?? 1,
            'replaced_rev' => $replacedRev,
            'previous_data' => $previous,
            'new_data' => $new,
            'reason' => $overrides['reason'] ?? 'خطأ في كتابة التشخيص',
            'corrected_by' => $overrides['corrected_by'] ?? $fixture['doctorId'],
            'corrected_at' => $now,
            'device_id' => $fixture['credential']['deviceId'],
        ], $overrides['revision_payload'] ?? []),
        'created_at' => $now,
        'group_id' => $groupId,
    ];

    $update = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visit_form_data',
        'entity_id' => $formId,
        'action' => 'update',
        'payload' => [
            'id' => $formId,
            'visit_id' => $overrides['visit_id'] ?? $fixture['visitId'],
            'form_definition_id' => $fixture['formDefinitionId'],
            'data' => $new,
        ],
        'created_at' => $now,
        'base_rev' => $overrides['update_base_rev'] ?? $replacedRev,
        'group_id' => $groupId,
    ];

    return [
        'create' => $create,
        'revision' => $revision,
        'update' => $update,
        'ops' => array_values(array_filter([$create, $revision, $update])),
    ];
}

/** The organization's money as it stands: every invoice, payment and cash close with its rev. */
function moneySnapshot(string $orgId, string $locationId): array
{
    $fx = test()->fx();
    $invoiceIds = $fx->table('invoices')->where('org_id', $orgId)->pluck('id')->all();
    $rows = fn ($query, array $columns) => $query->orderBy('id')->get($columns)->map(fn ($row) => (array) $row)->all();

    return [
        'invoices' => $rows($fx->table('invoices')->where('org_id', $orgId), ['id', 'rev', 'total', 'paid']),
        'invoice_items' => $rows($fx->table('invoice_items')->whereIn('invoice_id', $invoiceIds), ['id', 'rev']),
        'payments' => $rows($fx->table('payments')->whereIn('invoice_id', $invoiceIds), ['id', 'rev']),
        'cash_close' => $rows($fx->table('cash_close')->where('location_id', $locationId), ['id', 'rev']),
    ];
}

function storedForm(string $formId): array
{
    $row = test()->fx()->table('visit_form_data')->where('id', $formId)->first();

    return ['data' => json_decode($row->data, true), 'rev' => (int) $row->rev];
}

function normalizeSql(string $sql): string
{
    return trim(preg_replace('/\s+/', ' ', $sql));
}

// --- Shape ------------------------------------------------------------------

test('visit_form_revisions has every column of the design, its checks, the unique number and the visit index', function () {
    $columns = collect($this->asOwner()->select(<<<'SQL'
        SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
        FROM information_schema.columns WHERE table_name = 'visit_form_revisions' ORDER BY ordinal_position
    SQL))->map(fn ($c) => [$c->column_name, $c->data_type, $c->is_nullable, $c->character_maximum_length, $c->column_default])->all();

    expect($columns)->toBe([
        ['id', 'uuid', 'NO', null, null],
        ['org_id', 'uuid', 'NO', null, null],
        ['visit_id', 'uuid', 'NO', null, null],
        ['visit_form_data_id', 'uuid', 'NO', null, null],
        ['revision_no', 'integer', 'NO', null, null],
        ['replaced_rev', 'integer', 'NO', null, null],
        ['previous_data', 'jsonb', 'NO', null, null],
        ['new_data', 'jsonb', 'NO', null, null],
        ['reason', 'character varying', 'NO', 500, null],
        ['corrected_by', 'uuid', 'NO', null, null],
        ['corrected_at', 'timestamp with time zone', 'NO', null, null],
        ['device_id', 'uuid', 'NO', null, null],
        ['rev', 'integer', 'NO', null, '1'],
    ]);

    $constraints = collect($this->asOwner()->select(<<<'SQL'
        SELECT contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'visit_form_revisions'::regclass ORDER BY contype, pg_get_constraintdef(oid)
    SQL))->map(fn ($c) => $c->contype.' '.$c->def)->all();

    expect($constraints)->toBe([
        'c CHECK (((char_length(btrim((reason)::text)) >= 3) AND ((reason)::text = btrim((reason)::text))))',
        'c CHECK ((new_data IS DISTINCT FROM previous_data))',
        'c CHECK ((replaced_rev >= 1))',
        'c CHECK ((revision_no >= 1))',
        'f FOREIGN KEY (corrected_by) REFERENCES memberships(id) ON DELETE RESTRICT',
        'f FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE RESTRICT',
        'f FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT',
        'f FOREIGN KEY (visit_form_data_id) REFERENCES visit_form_data(id) ON DELETE RESTRICT',
        'f FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE RESTRICT',
        'p PRIMARY KEY (id)',
        'u UNIQUE (visit_form_data_id, revision_no)',
    ]);
    expect($this->asOwner()->table('pg_constraint')->where('conname', 'visit_form_revisions_number_unique')->exists())->toBeTrue();

    $index = $this->asOwner()->selectOne("SELECT indexdef FROM pg_indexes WHERE indexname = 'visit_form_revisions_visit'");
    expect($index->indexdef)->toBe('CREATE INDEX visit_form_revisions_visit ON public.visit_form_revisions USING btree (visit_id)');
});

test('the table is forced under RLS; clintra_app holds exactly SELECT and INSERT; no other role holds anything', function () {
    $flags = $this->fx()->selectOne("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'visit_form_revisions'");
    expect([$flags->relrowsecurity, $flags->relforcerowsecurity])->toBe([true, true]);

    $grants = fn (string $role) => collect($this->asOwner()->select(
        "SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'visit_form_revisions' AND grantee = ? ORDER BY privilege_type",
        [$role]
    ))->pluck('privilege_type')->all();

    expect($grants('clintra_app'))->toBe(['INSERT', 'SELECT']);
    expect($grants('PUBLIC'))->toBe([]);
    foreach (['clintra_rls', 'clintra_provision', 'clintra_mint', 'clintra_register', 'clintra_staff'] as $role) {
        expect($grants($role))->toBe([], "{$role} must hold nothing on visit_form_revisions");
    }
});

test('the policies are the design\'s SELECT and INSERT, as Postgres deparses them, and nothing else', function () {
    $policies = collect($this->asOwner()->select(<<<'SQL'
        SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS with_check
        FROM pg_policy WHERE polrelid = 'visit_form_revisions'::regclass ORDER BY polname
    SQL));

    $visitScope = '(visit_id IN ( SELECT visits.id FROM visits WHERE ((visits.org_id = current_org())'
        .' AND (visits.location_id IN ( SELECT allowed_locations.allowed_locations FROM allowed_locations() allowed_locations(allowed_locations)))'
        .' AND (visits.practitioner_id IN ( SELECT allowed_practitioners.allowed_practitioners FROM allowed_practitioners() allowed_practitioners(allowed_practitioners))))))';

    expect($policies->map(fn ($p) => [$p->polname, $p->polcmd])->all())->toBe([
        ['visit_form_revisions_insert', 'a'],
        ['visit_form_revisions_select', 'r'],
    ]);
    $select = $policies->firstWhere('polname', 'visit_form_revisions_select');
    expect(normalizeSql($select->qual))->toBe("((org_id = current_org()) AND {$visitScope})");
    expect($select->with_check)->toBeNull();

    $insert = $policies->firstWhere('polname', 'visit_form_revisions_insert');
    expect($insert->qual)->toBeNull();
    expect(normalizeSql($insert->with_check))->toBe(
        "((org_id = current_org()) AND {$visitScope}"
        .' AND (corrected_by IN ( SELECT memberships.id FROM memberships WHERE (memberships.org_id = current_org())))'
        .' AND (device_id IN ( SELECT device.id FROM device WHERE (device.org_id = current_org()))))'
    );
});

test('both triggers and the rev trigger are attached, the guard firing before visit_form_data\'s own rev trigger', function () {
    $triggers = fn (string $table) => collect($this->asOwner()->select(<<<'SQL'
        SELECT t.tgname, p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = ?::regclass AND NOT t.tgisinternal ORDER BY t.tgname
    SQL, [$table]))->map(fn ($t) => "{$t->tgname}:{$t->proname}")->all();

    expect($triggers('visit_form_revisions'))->toBe([
        'visit_form_revisions_check:visit_form_revision_check',
        'visit_form_revisions_enforce_rev:enforce_row_rev',
    ]);
    expect($triggers('visit_form_data'))->toBe([
        'visit_form_data_completed_guard:visit_form_data_completed_guard',
        'visit_form_data_enforce_rev:enforce_row_rev',
    ]);
});

// --- Triggers, through clintra_app with a membership set -----------------------

test('a revision describing the stored row of a completed visit is accepted from its doctor and from the owner', function () {
    withCorrectionFixture(function (array $fixture) {
        expect(insertRevisionAsApp($fixture, revisionRow($fixture), $fixture['doctorId']))->toBeNull();

        $owners = revisionRow($fixture, [
            'revision_no' => 2,
            'previous_data' => json_encode(STORED_FORM),
            'new_data' => json_encode(['complaint' => 'ألم', 'diagnosis' => 'التهاب']),
            'corrected_by' => $fixture['ownerId'],
        ]);
        expect(insertRevisionAsApp($fixture, $owners))->toBeNull();
        expect($this->fx()->table('visit_form_revisions')->where('visit_form_data_id', $fixture['formId'])->pluck('revision_no')->sort()->values()->all())->toBe([1, 2]);
        expect($this->fx()->table('visit_form_revisions')->where('id', $owners['id'])->value('rev'))->toBe(1);
    });
});

test('the revision trigger refuses a wrong previous text, a stale rev, a skipped number and a visit not completed', function () {
    withCorrectionFixture(function (array $fixture) {
        refusedWith(insertRevisionAsApp($fixture, revisionRow($fixture, ['previous_data' => json_encode(['complaint' => 'نص مزيف', 'diagnosis' => 'التهاب وتر'])])), 'correction_invalid');
        refusedWith(insertRevisionAsApp($fixture, revisionRow($fixture, ['replaced_rev' => 2])), 'correction_invalid');
        refusedWith(insertRevisionAsApp($fixture, revisionRow($fixture, ['revision_no' => 2])), 'correction_invalid');

        $this->fx()->table('visits')->where('id', $fixture['visitId'])->update(['status' => 'in_room']);
        refusedWith(insertRevisionAsApp($fixture, revisionRow($fixture)), 'correction_invalid');

        expect($this->fx()->table('visit_form_revisions')->where('org_id', $fixture['orgId'])->exists())->toBeFalse();
    });
});

test('the revision trigger refuses another doctor and an assistant', function () {
    withCorrectionFixture(function (array $fixture) {
        refusedWith(insertRevisionAsApp($fixture, revisionRow($fixture, ['corrected_by' => $fixture['otherDoctorId']])), 'correction_not_allowed');
        refusedWith(insertRevisionAsApp($fixture, revisionRow($fixture, ['corrected_by' => $fixture['assistantId']])), 'correction_not_allowed');
        expect($this->fx()->table('visit_form_revisions')->where('org_id', $fixture['orgId'])->exists())->toBeFalse();
    });
});

test('the guard refuses a direct edit of a completed visit\'s form, and lets the edit through with its revision', function () {
    withCorrectionFixture(function (array $fixture) {
        $edit = fn ($db) => $db->table('visit_form_data')->where('id', $fixture['formId'])->update(['data' => json_encode(CORRECTED_FORM)]);

        refusedWith(asAppRefusal($fixture['ownerId'], $edit), 'correction_required');
        expect(storedForm($fixture['formId']))->toBe(['data' => STORED_FORM, 'rev' => 1]);

        // A change that leaves data as it is needs no revision.
        expect(asAppRefusal($fixture['ownerId'], fn ($db) => $db->table('visit_form_data')->where('id', $fixture['formId'])->update(['data' => json_encode(STORED_FORM)])))->toBeNull();
        expect(storedForm($fixture['formId'])['rev'])->toBe(2);

        $revision = revisionRow($fixture, ['replaced_rev' => 2]);
        expect(asAppRefusal($fixture['ownerId'], function ($db) use ($revision, $edit) {
            $db->table('visit_form_revisions')->insert($revision);
            $edit($db);
        }))->toBeNull();
        expect(storedForm($fixture['formId']))->toBe(['data' => CORRECTED_FORM, 'rev' => 3]);
    });
});

test('the guard accepts an empty form created on a completed visit and refuses one with text', function () {
    withCorrectionFixture(function (array $fixture) {
        $visitId = $this->makeVisit($fixture['orgId'], $fixture['credential']['locationId'], $fixture['practitionerId'], $fixture['patientId'], $fixture['ownerId'], ['status' => 'completed', 'position' => 2]);
        $row = fn (array $data) => [
            'id' => (string) Str::uuid(),
            'visit_id' => $visitId,
            'form_definition_id' => $fixture['formDefinitionId'],
            'data' => json_encode($data),
        ];

        refusedWith(asAppRefusal($fixture['ownerId'], fn ($db) => $db->table('visit_form_data')->insert($row(['complaint' => 'نص', 'diagnosis' => '']))), 'correction_required');
        expect(asAppRefusal($fixture['ownerId'], fn ($db) => $db->table('visit_form_data')->insert($row(['complaint' => '', 'diagnosis' => '']))))->toBeNull();
    });
});

test('a revision can be neither updated nor deleted by clintra_app: the grant refuses it (42501)', function () {
    withCorrectionFixture(function (array $fixture) {
        $row = revisionRow($fixture);
        expect(insertRevisionAsApp($fixture, $row))->toBeNull();

        $update = asAppRefusal($fixture['ownerId'], fn ($db) => $db->table('visit_form_revisions')->where('id', $row['id'])->update(['reason' => 'سبب تاني']));
        $delete = asAppRefusal($fixture['ownerId'], fn ($db) => $db->table('visit_form_revisions')->where('id', $row['id'])->delete());

        expect($update[0])->toBe('42501');
        expect($delete[0])->toBe('42501');
        expect($this->fx()->table('visit_form_revisions')->where('id', $row['id'])->value('reason'))->toBe('خطأ في كتابة التشخيص');
    });
});

// --- Push, pull and bootstrap -----------------------------------------------------

test('a two-op correction is accepted whole and pulled with its revision; nothing financial changes', function () {
    withCorrectionFixture(function (array $fixture) {
        $credential = $fixture['credential'];
        $money = moneySnapshot($fixture['orgId'], $credential['locationId']);
        $correction = correctionOps($fixture);

        pushOps($credential['token'], $correction['ops'])->assertOk()->assertJson(['results' => [
            ['op_id' => $correction['revision']['op_id'], 'status' => 'accepted', 'rev' => 1],
            ['op_id' => $correction['update']['op_id'], 'status' => 'accepted', 'rev' => 2],
        ]]);
        expect(storedForm($fixture['formId']))->toBe(['data' => CORRECTED_FORM, 'rev' => 2]);

        $rows = collect(pullOps($credential['token'])->assertOk()->json('rows'))->keyBy('entity_id');
        $revision = $rows[$correction['revision']['entity_id']];
        expect($revision['entity'])->toBe('visit_form_revisions');
        expect($revision['payload'])->toMatchArray([
            'visit_id' => $fixture['visitId'],
            'visit_form_data_id' => $fixture['formId'],
            'revision_no' => 1,
            'replaced_rev' => 1,
            'previous_data' => STORED_FORM,
            'new_data' => CORRECTED_FORM,
            'reason' => 'خطأ في كتابة التشخيص',
            'corrected_by' => $fixture['doctorId'],
            'device_id' => $credential['deviceId'],
            'rev' => 1,
        ]);
        expect($rows[$fixture['formId']]['payload']['data'])->toBe(CORRECTED_FORM);
        expect(moneySnapshot($fixture['orgId'], $credential['locationId']))->toBe($money);
    });
});

test('a three-op correction of a completed visit with no form yet is accepted whole', function () {
    withCorrectionFixture(function (array $fixture) {
        $visitId = $this->makeVisit($fixture['orgId'], $fixture['credential']['locationId'], $fixture['practitionerId'], $fixture['patientId'], $fixture['ownerId'], ['status' => 'completed', 'position' => 2]);
        $formId = (string) Str::uuid();
        $correction = correctionOps($fixture, [
            'with_create' => true,
            'visit_id' => $visitId,
            'form_id' => $formId,
            'previous_data' => ['complaint' => '', 'diagnosis' => ''],
        ]);

        $results = pushOps($fixture['credential']['token'], $correction['ops'])->assertOk()->json('results');
        expect(array_column($results, 'status'))->toBe(['accepted', 'accepted', 'accepted']);
        expect(storedForm($formId))->toBe(['data' => CORRECTED_FORM, 'rev' => 2]);
        // A pushed "" arrives as null (ConvertEmptyStringsToNull): the revision keeps what the server stored.
        expect(json_decode($this->fx()->table('visit_form_revisions')->where('id', $correction['revision']['entity_id'])->value('previous_data'), true))
            ->toBe(['complaint' => null, 'diagnosis' => null]);
    });
});

test('a correction group carrying an invoice or a payment is refused whole: nothing is written', function (string $carried) {
    withCorrectionFixture(function (array $fixture) use ($carried) {
        $credential = $fixture['credential'];
        $refs = ['practitionerId' => $fixture['practitionerId'], 'patientId' => $fixture['patientId']];
        $invoice = invoiceOp($credential, $refs, 1, 1);

        if ($carried === 'payment') {
            pushOps($credential['token'], [$invoice])->assertJson(['results' => [['status' => 'accepted']]]);
        }

        $money = moneySnapshot($fixture['orgId'], $credential['locationId']);
        $correction = correctionOps($fixture);
        $extra = $carried === 'invoice' ? $invoice : paymentOp($credential, $invoice['entity_id'], 1, '1');
        $extra['group_id'] = $correction['revision']['group_id'];

        $results = pushOps($credential['token'], [...$correction['ops'], $extra])->assertOk()->json('results');

        expect($results[0])->toBe(['op_id' => $correction['revision']['op_id'], 'status' => 'rejected', 'reason' => 'correction_invalid']);
        expect(array_column(array_slice($results, 1), 'reason'))->toBe(['group_rejected', 'group_rejected']);
        expect(storedForm($fixture['formId']))->toBe(['data' => STORED_FORM, 'rev' => 1]);
        expect($this->fx()->table('visit_form_revisions')->where('org_id', $fixture['orgId'])->exists())->toBeFalse();
        expect($this->fx()->table('sync_ledger')->whereIn('op_id', array_column($results, 'op_id'))->exists())->toBeFalse();
        expect(moneySnapshot($fixture['orgId'], $credential['locationId']))->toBe($money);
    });
})->with(['invoice', 'payment']);

test('a revision outside its correction group, or with an update that does not match it, is correction_invalid', function () {
    withCorrectionFixture(function (array $fixture) {
        $token = $fixture['credential']['token'];
        $alone = correctionOps($fixture)['revision'];
        unset($alone['group_id']);
        pushOps($token, [$alone])->assertJson(['results' => [['status' => 'rejected', 'reason' => 'correction_invalid']]]);

        $mismatch = correctionOps($fixture);
        $mismatch['update']['payload']['data'] = ['complaint' => 'غير', 'diagnosis' => 'كده'];
        $results = pushOps($token, [$mismatch['revision'], $mismatch['update']])->json('results');
        expect($results[0]['reason'])->toBe('correction_invalid');

        $tooShort = correctionOps($fixture, ['reason' => 'لا']);
        expect(pushOps($token, $tooShort['ops'])->json('results.0.reason'))->toBe('correction_invalid');

        expect(storedForm($fixture['formId']))->toBe(['data' => STORED_FORM, 'rev' => 1]);
    });
});

test('a revision update or delete is revision_immutable', function () {
    withCorrectionFixture(function (array $fixture) {
        $token = $fixture['credential']['token'];
        $correction = correctionOps($fixture);
        pushOps($token, $correction['ops'])->assertOk();
        $revisionId = $correction['revision']['entity_id'];

        $update = ['op_id' => (string) Str::uuid(), 'entity' => 'visit_form_revisions', 'entity_id' => $revisionId, 'action' => 'update',
            'payload' => ['reason' => 'سبب أحسن'], 'created_at' => now()->toIso8601String(), 'base_rev' => 1];
        $delete = ['op_id' => (string) Str::uuid(), 'entity' => 'visit_form_revisions', 'entity_id' => (string) Str::uuid(), 'action' => 'delete',
            'payload' => null, 'created_at' => now()->toIso8601String(), 'base_rev' => 1];

        pushOps($token, [$update, $delete])->assertJson(['results' => [
            ['status' => 'rejected', 'reason' => 'revision_immutable'],
            ['status' => 'rejected', 'reason' => 'revision_immutable'],
        ]]);
        expect($this->fx()->table('visit_form_revisions')->where('id', $revisionId)->value('reason'))->toBe('خطأ في كتابة التشخيص');
    });
});

test('two devices correcting one form: the first wins, the second is conflict_stale_rev and leaves nothing', function () {
    withCorrectionFixture(function (array $fixture) {
        $secondDevice = $this->makeDevice($fixture['orgId'], $fixture['credential']['locationId'], $fixture['ownerId']);
        $secondToken = (new Device(['id' => $secondDevice]))->createToken('second', ['membership:'.$fixture['ownerId']])->plainTextToken;

        $first = correctionOps($fixture);
        $second = correctionOps($fixture, ['new_data' => ['complaint' => 'ألم شديد', 'diagnosis' => 'التهاب وتر'], 'corrected_by' => $fixture['ownerId']]);

        pushOps($fixture['credential']['token'], $first['ops'])->assertJson(['results' => [['status' => 'accepted'], ['status' => 'accepted']]]);
        $results = pushOps($secondToken, $second['ops'])->assertOk()->json('results');

        expect($results)->toBe([
            ['op_id' => $second['revision']['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev'],
            ['op_id' => $second['update']['op_id'], 'status' => 'rejected', 'reason' => 'group_rejected'],
        ]);
        expect(storedForm($fixture['formId']))->toBe(['data' => CORRECTED_FORM, 'rev' => 2]);
        expect($this->fx()->table('visit_form_revisions')->where('visit_form_data_id', $fixture['formId'])->pluck('id')->all())
            ->toBe([$first['revision']['entity_id']]);
        expect($this->fx()->table('audit_log')->where('entity_id', $second['revision']['entity_id'])->exists())->toBeFalse();
    });
});

test('a late autosave of a completed visit\'s form, a delete, and a create with text are correction_required', function () {
    withCorrectionFixture(function (array $fixture) {
        $token = $fixture['credential']['token'];
        $now = now()->toIso8601String();
        $late = ['op_id' => (string) Str::uuid(), 'entity' => 'visit_form_data', 'entity_id' => $fixture['formId'], 'action' => 'update',
            'payload' => ['id' => $fixture['formId'], 'visit_id' => $fixture['visitId'], 'form_definition_id' => $fixture['formDefinitionId'], 'data' => CORRECTED_FORM],
            'created_at' => $now, 'base_rev' => 1];
        $delete = ['op_id' => (string) Str::uuid(), 'entity' => 'visit_form_data', 'entity_id' => $fixture['formId'], 'action' => 'delete',
            'payload' => null, 'created_at' => $now, 'base_rev' => 1];

        pushOps($token, [$late])->assertJson(['results' => [['status' => 'rejected', 'reason' => 'correction_required']]]);
        pushOps($token, [$delete])->assertJson(['results' => [['status' => 'rejected', 'reason' => 'correction_required']]]);

        $visitId = $this->makeVisit($fixture['orgId'], $fixture['credential']['locationId'], $fixture['practitionerId'], $fixture['patientId'], $fixture['ownerId'], ['status' => 'completed', 'position' => 2]);
        $formId = (string) Str::uuid();
        $create = ['op_id' => (string) Str::uuid(), 'entity' => 'visit_form_data', 'entity_id' => $formId, 'action' => 'create',
            'payload' => ['id' => $formId, 'visit_id' => $visitId, 'form_definition_id' => $fixture['formDefinitionId'], 'data' => ['complaint' => 'نص', 'diagnosis' => '']],
            'created_at' => $now];
        pushOps($token, [$create])->assertJson(['results' => [['status' => 'rejected', 'reason' => 'correction_required']]]);

        expect(storedForm($fixture['formId']))->toBe(['data' => STORED_FORM, 'rev' => 1]);
        expect($this->fx()->table('visit_form_data')->where('id', $formId)->exists())->toBeFalse();
    });
});

test('before the guard\'s migration a late autosave is still accepted; with it, it is correction_required', function () {
    $guard = require database_path('migrations/2026_09_12_000041_add_visit_form_data_completed_guard.php');
    // The migration runs as clintra_owner, as migrate does (CarePlansTest's pattern).
    $asOwner = function (Closure $step) {
        $previousDefault = DB::getDefaultConnection();
        DB::setDefaultConnection('pgsql_owner');
        try {
            $this->asOwner()->transaction($step);
        } finally {
            DB::setDefaultConnection($previousDefault);
        }
    };

    withCorrectionFixture(function (array $fixture) use ($guard, $asOwner) {
        $late = fn (int $baseRev, array $data) => ['op_id' => (string) Str::uuid(), 'entity' => 'visit_form_data', 'entity_id' => $fixture['formId'],
            'action' => 'update', 'payload' => ['data' => $data], 'created_at' => now()->toIso8601String(), 'base_rev' => $baseRev];

        $asOwner(fn () => $guard->down());
        try {
            pushOps($fixture['credential']['token'], [$late(1, CORRECTED_FORM)])->assertJson(['results' => [['status' => 'accepted', 'rev' => 2]]]);
        } finally {
            $asOwner(fn () => $guard->up());
        }

        pushOps($fixture['credential']['token'], [$late(2, STORED_FORM)])->assertJson(['results' => [['status' => 'rejected', 'reason' => 'correction_required']]]);
        expect(storedForm($fixture['formId']))->toBe(['data' => CORRECTED_FORM, 'rev' => 2]);
    });
});

test('only the visit\'s doctor or an owner may correct: another doctor and an assistant are correction_not_allowed', function (string $who) {
    withCorrectionFixture(function (array $fixture) use ($who) {
        $correction = correctionOps($fixture, ['corrected_by' => $fixture[$who]]);
        $results = pushOps($fixture['credential']['token'], $correction['ops'])->assertOk()->json('results');

        expect($results[0]['reason'])->toBe('correction_not_allowed');
        expect(storedForm($fixture['formId']))->toBe(['data' => STORED_FORM, 'rev' => 1]);
    });
})->with(['otherDoctorId', 'assistantId']);

test('the owner corrects another doctor\'s visit', function () {
    withCorrectionFixture(function (array $fixture) {
        $correction = correctionOps($fixture, ['corrected_by' => $fixture['ownerId']]);
        $results = pushOps($fixture['credential']['token'], $correction['ops'])->assertOk()->json('results');
        expect(array_column($results, 'status'))->toBe(['accepted', 'accepted']);
    });
});

test('corrected_by: a claim of the organization is kept, another organization\'s is actor_not_in_org, an absent one is the token\'s', function () {
    withCorrectionFixture(function (array $fixture) {
        $token = $fixture['credential']['token'];
        $kept = correctionOps($fixture);
        pushOps($token, $kept['ops'])->assertJson(['results' => [['status' => 'accepted'], ['status' => 'accepted']]]);
        expect($this->fx()->table('visit_form_revisions')->where('id', $kept['revision']['entity_id'])->value('corrected_by'))->toBe($fixture['doctorId']);
        expect($this->fx()->table('sync_ledger')->where('op_id', $kept['revision']['op_id'])->value('actor_membership_id'))->toBe($fixture['ownerId']);

        $outsider = makeAuthenticatedDevice()['membershipId'];
        $foreign = correctionOps($fixture, ['replaced_rev' => 2, 'revision_no' => 2, 'previous_data' => CORRECTED_FORM, 'new_data' => STORED_FORM, 'corrected_by' => $outsider]);
        expect(pushOps($token, $foreign['ops'])->json('results.0'))
            ->toBe(['op_id' => $foreign['revision']['op_id'], 'status' => 'rejected', 'reason' => 'actor_not_in_org']);

        $absent = correctionOps($fixture, ['replaced_rev' => 2, 'revision_no' => 2, 'previous_data' => CORRECTED_FORM, 'new_data' => STORED_FORM]);
        unset($absent['ops'][0]['payload']['corrected_by']);
        pushOps($token, $absent['ops'])->assertJson(['results' => [['status' => 'accepted'], ['status' => 'accepted']]]);
        expect($this->fx()->table('visit_form_revisions')->where('id', $absent['revision']['entity_id'])->value('corrected_by'))->toBe($fixture['ownerId']);
    });
});

test('a revision\'s device is the token\'s, whatever the payload says', function () {
    withCorrectionFixture(function (array $fixture) {
        $otherDevice = $this->makeDevice($fixture['orgId'], $fixture['credential']['locationId'], $fixture['ownerId']);
        $correction = correctionOps($fixture, ['revision_payload' => ['device_id' => $otherDevice]]);
        pushOps($fixture['credential']['token'], $correction['ops'])->assertJson(['results' => [['status' => 'accepted'], ['status' => 'accepted']]]);

        expect($this->fx()->table('visit_form_revisions')->where('id', $correction['revision']['entity_id'])->value('device_id'))
            ->toBe($fixture['credential']['deviceId']);
    });
});

test('a fresh device\'s bootstrap carries the revisions of the visits in its window', function () {
    withCorrectionFixture(function (array $fixture) {
        $credential = $fixture['credential'];
        $correction = correctionOps($fixture);
        pushOps($credential['token'], $correction['ops'])->assertOk();

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

        $pulled = collect($rows)->firstWhere('entity_id', $correction['revision']['entity_id']);
        expect($pulled['entity'])->toBe('visit_form_revisions');
        expect($pulled['payload']['new_data'])->toBe(CORRECTED_FORM);
    });
});

// --- Cross-organization and scope -------------------------------------------------

test('another organization can neither insert nor read a revision of this organization\'s visit, by push or directly', function () {
    withCorrectionFixture(function (array $fixture) {
        $correction = correctionOps($fixture);
        pushOps($fixture['credential']['token'], $correction['ops'])->assertOk();

        $other = makeAuthenticatedDevice();
        $foreign = correctionOps($fixture, ['replaced_rev' => 2, 'revision_no' => 2, 'previous_data' => CORRECTED_FORM, 'new_data' => STORED_FORM, 'corrected_by' => $other['membershipId']]);
        $foreign['revision']['payload']['org_id'] = $other['orgId'];
        $results = pushOps($other['token'], $foreign['ops'])->assertOk()->json('results');
        expect(array_column($results, 'status'))->not->toContain('accepted');

        $direct = revisionRow($fixture, [
            'org_id' => $other['orgId'], 'revision_no' => 2, 'replaced_rev' => 2,
            'previous_data' => json_encode(CORRECTED_FORM), 'new_data' => json_encode(STORED_FORM),
            'corrected_by' => $other['membershipId'], 'device_id' => $other['deviceId'],
        ]);
        // The revision trigger runs first, reading the form through B's own
        // RLS: it sees no such row, so the insert is refused before the policy.
        refusedWith(asAppRefusal($other['membershipId'], fn ($db) => $db->table('visit_form_revisions')->insert($direct)), 'correction_invalid');

        expect($this->withMembership($this->asApp(), $other['membershipId'], fn ($db) => $db->table('visit_form_revisions')->count()))->toBe(0);
        expect(collect(pullOps($other['token'])->assertOk()->json('rows'))->where('entity', 'visit_form_revisions'))->toBeEmpty();
        expect($this->fx()->table('visit_form_revisions')->where('visit_form_data_id', $fixture['formId'])->count())->toBe(1);
        expect(storedForm($fixture['formId']))->toBe(['data' => CORRECTED_FORM, 'rev' => 2]);
    });
});

test('the insert policy refuses a revision naming another organization\'s device, which the trigger does not check (42501)', function () {
    withCorrectionFixture(function (array $fixture) {
        $foreignDevice = makeAuthenticatedDevice()['deviceId'];

        expect(insertRevisionAsApp($fixture, revisionRow($fixture, ['device_id' => $foreignDevice]))[0])->toBe('42501');
        expect($this->fx()->table('visit_form_revisions')->where('org_id', $fixture['orgId'])->exists())->toBeFalse();
    });
});

test('a member listed for another location reads no revision of this location\'s visit', function () {
    withCorrectionFixture(function (array $fixture) {
        pushOps($fixture['credential']['token'], correctionOps($fixture)['ops'])->assertOk();

        $otherLocation = $this->makeLocation($fixture['orgId'], 'other branch');
        $listed = $this->makeMembership($this->makeUser('branch'), $fixture['orgId'], ['role' => 'assistant', 'location_scope' => 'listed']);
        $this->makeMembershipLocation($listed, $otherLocation);

        expect($this->withMembership($this->asApp(), $listed, fn ($db) => $db->table('visit_form_revisions')->count()))->toBe(0);
        expect($this->withMembership($this->asApp(), $fixture['ownerId'], fn ($db) => $db->table('visit_form_revisions')->count()))->toBe(1);
    });
});
