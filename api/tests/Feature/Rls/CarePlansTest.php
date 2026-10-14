<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * care_plans and care_plan_items (docs/schema.md's v20 additions):
 * 2026_09_12_000030_make_care_plans_syncable.php, and SyncOpApplier's care
 * plan rule.
 */

/**
 * A plan's world: an authenticated device, a practitioner, a patient, a
 * service, the general template, and one booked visit of that patient
 * with that practitioner.
 *
 * @return array{credential: array, practitionerId: string, patientId: string, serviceId: string, templateId: string, visitId: string}
 */
function carePlanFixture(?array $credential = null): array
{
    $test = test();
    $credential ??= makeAuthenticatedDevice();
    $templateId = $test->makeSpecialtyTemplate(null);
    $practitionerId = $test->makePractitioner($credential['orgId'], $templateId);
    $patientId = $test->makePatient($credential['orgId'], 'كريم فتحي');
    $serviceId = (string) Str::uuid();
    $test->fx()->table('services')->insert([
        'id' => $serviceId,
        'org_id' => $credential['orgId'],
        'name' => 'علاج طبيعي',
        'duration_minutes' => 30,
        'default_price' => 25000,
        'is_active' => true,
    ]);

    return [
        'credential' => $credential,
        'practitionerId' => $practitionerId,
        'patientId' => $patientId,
        'serviceId' => $serviceId,
        'templateId' => $templateId,
        'visitId' => $test->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId']),
    ];
}

/** The whole plan row, as the device writes it. */
function carePlanRow(array $fixture, array $overrides = []): array
{
    $now = now()->toIso8601String();

    return array_merge([
        'id' => (string) Str::uuid(),
        'org_id' => $fixture['credential']['orgId'],
        'location_id' => $fixture['credential']['locationId'],
        'template_id' => $fixture['templateId'],
        'patient_id' => $fixture['patientId'],
        'practitioner_id' => $fixture['practitionerId'],
        'goal' => 'استعادة كامل حركة الركبة اليمنى',
        'diagnosis' => 'التهاب وتر الرضفة',
        'planned_count' => 2,
        'total_price' => 50000,
        'paid' => 0,
        'status' => 'active',
        'started_at' => $now,
        'expected_end' => $now,
    ], $overrides);
}

/** The whole session row, as the device writes it. */
function carePlanItemRow(array $fixture, string $carePlanId, int $sequence, array $overrides = []): array
{
    return array_merge([
        'id' => (string) Str::uuid(),
        'care_plan_id' => $carePlanId,
        'service_id' => $fixture['serviceId'],
        'sequence' => $sequence,
        'visit_id' => null,
        'min_gap_days' => $sequence === 1 ? 0 : 7,
        'depends_on_item_id' => null,
        'price' => 25000,
        'status' => 'planned',
    ], $overrides);
}

function carePlanOp(string $entity, array $row, string $action = 'create', int $baseRev = 1): array
{
    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => $entity,
        'entity_id' => $row['id'],
        'action' => $action,
        'payload' => $action === 'delete' ? null : $row,
        'created_at' => now()->toIso8601String(),
    ], ['base_rev' => $baseRev]);
}

/**
 * Pushes a plan with two sessions and asserts all three are accepted.
 *
 * @return array{plan: array, first: array, second: array}
 */
function pushCarePlan(array $fixture): array
{
    $plan = carePlanRow($fixture);
    $first = carePlanItemRow($fixture, $plan['id'], 1);
    $second = carePlanItemRow($fixture, $plan['id'], 2);

    pushOps($fixture['credential']['token'], [
        carePlanOp('care_plans', $plan),
        carePlanOp('care_plan_items', $first),
        carePlanOp('care_plan_items', $second),
    ])->assertOk()->assertJson(['results' => [
        ['status' => 'accepted', 'rev' => 1],
        ['status' => 'accepted', 'rev' => 1],
        ['status' => 'accepted', 'rev' => 1],
    ]]);

    return ['plan' => $plan, 'first' => $first, 'second' => $second];
}

/** Removes every care plan, session and service (and their ledger and audit rows) this org has. */
function forgetCarePlans(string $orgId): void
{
    $fx = test()->fx();
    $planIds = $fx->table('care_plans')->where('org_id', $orgId)->pluck('id')->all();
    $entities = ['care_plans', 'care_plan_items'];

    $fx->table('audit_log')->where('org_id', $orgId)->whereIn('entity', $entities)->delete();
    $fx->table('sync_ledger')->where('org_id', $orgId)->whereIn('entity', $entities)->delete();
    $fx->table('care_plan_items')->whereIn('care_plan_id', $planIds)->delete();
    $fx->table('care_plans')->whereIn('id', $planIds)->delete();
    $fx->table('services')->where('org_id', $orgId)->delete();
}

// --- Structure ---------------------------------------------------------------

test('both tables are forced under RLS, granted to clintra_app, and carry rev with the shared trigger', function () {
    foreach (['care_plans', 'care_plan_items'] as $table) {
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

test('care_plans copies the visits policy and care_plan_items embeds it through its plan, both with USING and WITH CHECK', function () {
    $policy = fn (string $table) => collect($this->fx()->select(
        'SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = ? ORDER BY policyname',
        [$table]
    ))->map(fn ($p) => [$p->policyname, $p->cmd, $p->qual, $p->with_check])->all();

    [[, , $visitsQual]] = $policy('visits');
    expect($policy('care_plans'))->toBe([['care_plans_scope', 'ALL', $visitsQual, $visitsQual]]);

    // prescription_items embeds the same expression through prescriptions:
    // the same text with the parent's name swapped is care_plan_items'.
    [[, , $prescriptionItemsQual]] = $policy('prescription_items');
    $expected = str_replace(['prescription_id', 'prescriptions'], ['care_plan_id', 'care_plans'], $prescriptionItemsQual);
    expect($policy('care_plan_items'))->toBe([['care_plan_items_scope', 'ALL', $expected, $expected]]);
});

test('care_plan_items.visit_id is nullable and indexed, and no foreign key cascades', function () {
    $visitId = $this->asOwner()->selectOne(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'care_plan_items' AND column_name = 'visit_id'"
    );
    expect($visitId->is_nullable)->toBe('YES');

    $indexes = collect($this->fx()->select("SELECT indexname FROM pg_indexes WHERE tablename IN ('care_plans', 'care_plan_items')"))
        ->pluck('indexname')->sort()->values()->all();
    expect($indexes)->toBe([
        'care_plan_items_care_plan_id_index',
        'care_plan_items_pkey',
        'care_plan_items_visit_id_index',
        'care_plans_org_id_index',
        'care_plans_pkey',
    ]);

    $foreignKeys = collect($this->fx()->select(
        "SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def, confdeltype FROM pg_constraint
         WHERE conrelid IN ('care_plans'::regclass, 'care_plan_items'::regclass) AND contype = 'f'"
    ));
    expect($foreignKeys->pluck('confdeltype')->unique()->values()->all())->toBe(['r']);
    expect($foreignKeys->pluck('def')->all())->toContain('FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE RESTRICT');
});

test('the migration refuses to change the policies while either table holds a row nobody can see', function (bool $withItem) {
    $migration = require database_path('migrations/2026_09_12_000030_make_care_plans_syncable.php');
    $fixture = carePlanFixture();
    $plan = carePlanRow($fixture);
    $this->fx()->table('care_plans')->insert($plan);
    if ($withItem) {
        $this->fx()->table('care_plan_items')->insert(carePlanItemRow($fixture, $plan['id'], 1));
    }

    // clintra_owner, which the migration runs as, sees neither row.
    expect($this->asOwner()->table('care_plans')->where('id', $plan['id'])->exists())->toBeFalse();

    $before = $this->fx()->select("SELECT tablename, qual FROM pg_policies WHERE tablename IN ('care_plans', 'care_plan_items') ORDER BY tablename");
    $previousDefault = DB::getDefaultConnection();
    DB::setDefaultConnection('pgsql_owner');
    try {
        expect(fn () => $this->asOwner()->transaction(fn () => $migration->up()))
            ->toThrow(QueryException::class, ($withItem ? 'care_plan_items' : 'care_plans').' is not empty');
    } finally {
        DB::setDefaultConnection($previousDefault);
    }

    // Nothing changed: the same policies, and no guard constraint left behind.
    expect($this->fx()->select("SELECT tablename, qual FROM pg_policies WHERE tablename IN ('care_plans', 'care_plan_items') ORDER BY tablename"))
        ->toEqual($before);
    expect($this->fx()->selectOne("SELECT count(*) AS n FROM pg_constraint WHERE conname LIKE '%_empty_guard'")->n)->toBe(0);

    forgetCarePlans($fixture['credential']['orgId']);
})->with(['a plan' => [false], 'a plan with a session' => [true]]);

// --- Create, link, unlink ----------------------------------------------------

test('a plan and its sessions are created at rev 1, then a session is linked to a visit and unlinked again', function () {
    $fixture = carePlanFixture();
    $credential = $fixture['credential'];
    ['plan' => $plan, 'first' => $first] = pushCarePlan($fixture);

    $stored = $this->fx()->table('care_plans')->where('id', $plan['id'])->first();
    expect([$stored->paid, $stored->status, $stored->planned_count, $stored->total_price])->toBe([0, 'active', 2, 50000]);
    expect($this->fx()->table('care_plan_items')->where('care_plan_id', $plan['id'])->orderBy('sequence')->pluck('visit_id')->all())
        ->toBe([null, null]);

    $link = carePlanOp('care_plan_items', array_merge($first, ['visit_id' => $fixture['visitId']]), 'update', 1);
    pushOps($credential['token'], [$link])->assertJson(['results' => [['status' => 'accepted', 'rev' => 2]]]);
    expect($this->fx()->table('care_plan_items')->where('id', $first['id'])->value('visit_id'))->toBe($fixture['visitId']);

    $unlink = carePlanOp('care_plan_items', $first, 'update', 2);
    pushOps($credential['token'], [$unlink])->assertJson(['results' => [['status' => 'accepted', 'rev' => 3]]]);
    expect($this->fx()->table('care_plan_items')->where('id', $first['id'])->value('visit_id'))->toBeNull();

    // Skip, stop and edit are plain updates within the stored sets.
    $skip = carePlanOp('care_plan_items', array_merge($first, ['status' => 'skipped']), 'update', 3);
    $stop = carePlanOp('care_plans', array_merge($plan, ['status' => 'stopped', 'goal' => 'هدف جديد', 'planned_count' => 1]), 'update', 1);
    pushOps($credential['token'], [$skip, $stop])->assertJson(['results' => [
        ['status' => 'accepted', 'rev' => 4],
        ['status' => 'accepted', 'rev' => 2],
    ]]);

    // The ledger carries every accepted write, so pull returns them.
    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'));
    expect($pulled->where('entity', 'care_plans')->pluck('entity_id')->unique()->values()->all())->toBe([$plan['id']]);
    expect($pulled->firstWhere('entity_id', $first['id'])['payload']['status'])->toBe('skipped');

    forgetCarePlans($credential['orgId']);
});

// --- Rules -------------------------------------------------------------------

test('a delete of a plan or a session is refused as care_plan_immutable and the row stays', function (string $entity) {
    $fixture = carePlanFixture();
    $rows = pushCarePlan($fixture);
    $row = $entity === 'care_plans' ? $rows['plan'] : $rows['first'];
    $delete = carePlanOp($entity, $row, 'delete', 1);

    pushOps($fixture['credential']['token'], [$delete])
        ->assertJson(['results' => [['op_id' => $delete['op_id'], 'status' => 'rejected', 'reason' => 'care_plan_immutable']]]);
    expect($this->fx()->table($entity)->where('id', $row['id'])->value('rev'))->toBe(1);
    expect($this->fx()->table('sync_ledger')->where('op_id', $delete['op_id'])->exists())->toBeFalse();

    forgetCarePlans($fixture['credential']['orgId']);
})->with(['care_plans', 'care_plan_items']);

test('a session update may not move it to another plan, service or place', function (string $column) {
    $fixture = carePlanFixture();
    ['plan' => $plan, 'first' => $first] = pushCarePlan($fixture);

    $value = match ($column) {
        'care_plan_id' => (function () use ($fixture) {
            $other = carePlanRow($fixture);
            pushOps($fixture['credential']['token'], [carePlanOp('care_plans', $other)])->assertJson(['results' => [['status' => 'accepted']]]);

            return $other['id'];
        })(),
        'service_id' => (function () use ($fixture) {
            $serviceId = (string) Str::uuid();
            $this->fx()->table('services')->insert([
                'id' => $serviceId, 'org_id' => $fixture['credential']['orgId'], 'name' => 'متابعة',
                'duration_minutes' => 15, 'default_price' => 10000, 'is_active' => true,
            ]);

            return $serviceId;
        })(),
        'sequence' => 5,
    };
    $op = carePlanOp('care_plan_items', array_merge($first, [$column => $value]), 'update', 1);

    pushOps($fixture['credential']['token'], [$op])
        ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'care_plan_immutable']]]);
    $stored = $this->fx()->table('care_plan_items')->where('id', $first['id'])->first();
    expect([$stored->rev, $stored->care_plan_id, $stored->service_id, $stored->sequence])
        ->toBe([1, $plan['id'], $fixture['serviceId'], 1]);

    forgetCarePlans($fixture['credential']['orgId']);
})->with(['care_plan_id', 'service_id', 'sequence']);

test('a status outside its set or a paid amount other than 0 is refused as care_plan_invalid', function (string $entity, string $action, array $changes) {
    $fixture = carePlanFixture();
    $credential = $fixture['credential'];

    if ($action === 'create') {
        $plan = carePlanRow($fixture, $entity === 'care_plans' ? $changes : []);
        $ops = [carePlanOp('care_plans', $plan)];
        $row = $plan;
        if ($entity === 'care_plan_items') {
            $row = carePlanItemRow($fixture, $plan['id'], 1, $changes);
            $ops[] = carePlanOp('care_plan_items', $row);
        }
        $op = $ops[array_key_last($ops)];
        $results = pushOps($credential['token'], $ops)->json('results');
        expect(end($results))->toBe(['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'care_plan_invalid']);
        expect($this->fx()->table($entity)->where('id', $row['id'])->exists())->toBeFalse();
    } else {
        $rows = pushCarePlan($fixture);
        $row = $entity === 'care_plans' ? $rows['plan'] : $rows['first'];
        $op = carePlanOp($entity, array_merge($row, $changes), 'update', 1);
        pushOps($credential['token'], [$op])
            ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'care_plan_invalid']]]);
        expect($this->fx()->table($entity)->where('id', $row['id'])->value('rev'))->toBe(1);
    }

    forgetCarePlans($credential['orgId']);
})->with([
    'plan created completed' => ['care_plans', 'create', ['status' => 'completed']],
    'plan created with a payment' => ['care_plans', 'create', ['paid' => 5000]],
    'plan created without paid' => ['care_plans', 'create', ['paid' => null]],
    'plan updated to an unknown status' => ['care_plans', 'update', ['status' => 'stalled']],
    'plan updated with a payment' => ['care_plans', 'update', ['paid' => 25000]],
    'session created done' => ['care_plan_items', 'create', ['status' => 'done']],
    'session updated to booked' => ['care_plan_items', 'update', ['status' => 'booked']],
    'session updated without a status' => ['care_plan_items', 'update', ['status' => null]],
]);

test('a session may only be linked to a visit of the plan\'s own patient and practitioner', function (string $mismatch) {
    $fixture = carePlanFixture();
    $credential = $fixture['credential'];
    ['first' => $first] = pushCarePlan($fixture);

    $visitId = match ($mismatch) {
        'another patient' => $this->makeVisit($credential['orgId'], $credential['locationId'], $fixture['practitionerId'],
            $this->makePatient($credential['orgId'], 'ياسمين توفيق'), $credential['membershipId'], ['position' => 2]),
        'another practitioner' => $this->makeVisit($credential['orgId'], $credential['locationId'],
            $this->makePractitioner($credential['orgId'], $fixture['templateId'], 'other'), $fixture['patientId'], $credential['membershipId']),
        'a visit that does not exist' => (string) Str::uuid(),
    };

    $link = carePlanOp('care_plan_items', array_merge($first, ['visit_id' => $visitId]), 'update', 1);
    pushOps($credential['token'], [$link])
        ->assertJson(['results' => [['op_id' => $link['op_id'], 'status' => 'rejected', 'reason' => 'care_plan_invalid']]]);
    expect($this->fx()->table('care_plan_items')->where('id', $first['id'])->value('visit_id'))->toBeNull();

    // The same rule holds for a session created already linked.
    $plan = carePlanRow($fixture);
    $linked = carePlanItemRow($fixture, $plan['id'], 1, ['visit_id' => $visitId]);
    $create = carePlanOp('care_plan_items', $linked);
    pushOps($credential['token'], [carePlanOp('care_plans', $plan), $create])->assertJson(['results' => [
        ['status' => 'accepted'],
        ['op_id' => $create['op_id'], 'status' => 'rejected', 'reason' => 'care_plan_invalid'],
    ]]);

    forgetCarePlans($credential['orgId']);
})->with(['another patient', 'another practitioner', 'a visit that does not exist']);

// --- Isolation ---------------------------------------------------------------

test('org B can neither read nor write org A\'s plans and sessions', function () {
    $fixture = carePlanFixture();
    $credentialA = $fixture['credential'];
    ['plan' => $plan, 'first' => $first] = pushCarePlan($fixture);
    $credentialB = makeAuthenticatedDevice();

    // The payload names org A: refused before any write.
    $stopAsIs = carePlanOp('care_plans', array_merge($plan, ['status' => 'stopped']), 'update', 1);
    pushOps($credentialB['token'], [$stopAsIs])
        ->assertJson(['results' => [['op_id' => $stopAsIs['op_id'], 'status' => 'failed', 'reason' => 'org_mismatch']]]);

    // With org B's own org_id, or for a session (no org_id): invisible, so nothing matches.
    $stopDisguised = carePlanOp('care_plans', array_merge($plan, ['org_id' => $credentialB['orgId'], 'status' => 'stopped']), 'update', 1);
    $skip = carePlanOp('care_plan_items', array_merge($first, ['status' => 'skipped']), 'update', 1);
    pushOps($credentialB['token'], [$stopDisguised, $skip])->assertJson(['results' => [
        ['op_id' => $stopDisguised['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev'],
        ['op_id' => $skip['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev'],
    ]]);

    // A session pushed into org A's plan is refused by WITH CHECK.
    $intruder = carePlanItemRow($fixture, $plan['id'], 3);
    expect(pushOps($credentialB['token'], [carePlanOp('care_plan_items', $intruder)])->json('results.0.status'))->not->toBe('accepted');
    expect($this->fx()->table('care_plan_items')->where('id', $intruder['id'])->exists())->toBeFalse();

    expect($this->fx()->table('care_plans')->where('id', $plan['id'])->value('status'))->toBe('active');
    expect($this->fx()->table('care_plan_items')->where('id', $first['id'])->value('status'))->toBe('planned');

    // Org B's bootstrap and pull carry neither.
    $bootstrapIds = collect(drainBootstrap($credentialB['token']))->pluck('entity_id');
    expect($bootstrapIds)->not->toContain($plan['id']);
    expect($bootstrapIds)->not->toContain($first['id']);
    $pulled = pullOps($credentialB['token'])->assertOk()->getContent();
    expect($pulled)->not->toContain($plan['id']);

    $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($plan, $first) {
        expect($db->table('care_plans')->where('id', $plan['id'])->exists())->toBeFalse();
        expect($db->table('care_plan_items')->where('id', $first['id'])->exists())->toBeFalse();
        expect($db->table('care_plan_items')->where('id', $first['id'])->update(['status' => 'skipped']))->toBe(0);
    });

    $this->withMembership($this->asApp(), $credentialA['membershipId'], function ($db) use ($plan, $first) {
        expect($db->table('care_plans')->where('id', $plan['id'])->exists())->toBeTrue();
        expect($db->table('care_plan_items')->where('id', $first['id'])->exists())->toBeTrue();
    });

    forgetCarePlans($credentialA['orgId']);
});

test('a membership scoped to another practitioner or another location cannot read or write the plan', function (string $scope) {
    $fixture = carePlanFixture();
    $credential = $fixture['credential'];
    ['plan' => $plan, 'first' => $first] = pushCarePlan($fixture);

    $overrides = $scope === 'practitioner'
        ? ['practitioner_scope' => 'self', 'practitioner_id' => $this->makePractitioner($credential['orgId'], $fixture['templateId'], 'other')]
        : ['location_scope' => 'listed'];
    $scopedId = $this->makeMembership($this->makeUser('scoped'), $credential['orgId'], $overrides);
    if ($scope === 'location') {
        $this->makeMembershipLocation($scopedId, $this->makeLocation($credential['orgId'], 'فرع تاني'));
    }

    $this->withMembership($this->asApp(), $scopedId, function ($db) use ($plan, $first) {
        expect($db->table('care_plans')->where('id', $plan['id'])->exists())->toBeFalse();
        expect($db->table('care_plan_items')->where('id', $first['id'])->exists())->toBeFalse();
        expect($db->table('care_plans')->where('id', $plan['id'])->update(['status' => 'stopped']))->toBe(0);
        expect($db->table('care_plan_items')->where('id', $first['id'])->update(['status' => 'skipped']))->toBe(0);
    });

    // The org-wide owner who pushed it still sees both.
    $this->withMembership($this->asApp(), $credential['membershipId'], function ($db) use ($plan, $first) {
        expect($db->table('care_plans')->where('id', $plan['id'])->exists())->toBeTrue();
        expect($db->table('care_plan_items')->where('id', $first['id'])->exists())->toBeTrue();
    });

    forgetCarePlans($credential['orgId']);
})->with(['practitioner', 'location']);

// --- Bootstrap ---------------------------------------------------------------

test('bootstrap returns an active plan and the plan of a windowed patient, with their sessions, but not an old stopped one', function () {
    $fixture = carePlanFixture();
    $credential = $fixture['credential'];
    ['plan' => $plan, 'first' => $first, 'second' => $second] = pushCarePlan($fixture);

    // A stopped plan of a patient whose only visit is long past.
    $oldPatientId = $this->makePatient($credential['orgId'], 'مريض قديم');
    $this->makeVisit($credential['orgId'], $credential['locationId'], $fixture['practitionerId'], $oldPatientId, $credential['membershipId'], [
        'visit_date' => now()->subDays(200)->toDateString(),
    ]);
    $old = carePlanRow($fixture, ['patient_id' => $oldPatientId, 'status' => 'stopped']);
    $oldItem = carePlanItemRow($fixture, $old['id'], 1);
    // A stopped plan of a windowed patient still comes.
    $stopped = carePlanRow($fixture, ['status' => 'stopped']);
    pushOps($credential['token'], [carePlanOp('care_plans', $old), carePlanOp('care_plan_items', $oldItem), carePlanOp('care_plans', $stopped)])
        ->assertJson(['results' => [['status' => 'accepted'], ['status' => 'accepted'], ['status' => 'accepted']]]);

    $rows = collect(drainBootstrap($credential['token']));
    expect($rows->where('entity', 'care_plans')->pluck('entity_id')->sort()->values()->all())
        ->toBe(collect([$plan['id'], $stopped['id']])->sort()->values()->all());
    expect($rows->where('entity', 'care_plan_items')->pluck('entity_id')->sort()->values()->all())
        ->toBe(collect([$first['id'], $second['id']])->sort()->values()->all());
    $planRow = $rows->firstWhere('entity_id', $plan['id']);
    expect([$planRow['rev'], $planRow['payload']['goal']])->toBe([1, $plan['goal']]);

    // An old active plan comes even though its patient has no windowed visit.
    $this->fx()->table('care_plans')->where('id', $old['id'])->update(['status' => 'active']);
    expect(collect(drainBootstrap($credential['token']))->pluck('entity_id')->all())->toContain($old['id'], $oldItem['id']);

    forgetCarePlans($credential['orgId']);
});
