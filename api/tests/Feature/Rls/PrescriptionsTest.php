<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * prescriptions and prescription_items (docs/schema.md's v17 additions):
 * 2026_09_12_000026_create_prescriptions_tables.php, numbered per device
 * series like invoices and locked once printed by
 * App\Support\Sync\SyncOpApplier.
 */

/**
 * @return array{credential: array, practitionerId: string, patientId: string, visitId: string}
 */
function prescriptionFixture(?array $credential = null, int $position = 1): array
{
    $test = test();
    $credential ??= makeAuthenticatedDevice();
    $practitionerId = $test->makePractitioner($credential['orgId'], $test->makeSpecialtyTemplate(null));
    $patientId = $test->makePatient($credential['orgId']);

    return [
        'credential' => $credential,
        'practitionerId' => $practitionerId,
        'patientId' => $patientId,
        'visitId' => $test->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], [
            'status' => 'in_room',
            'position' => $position,
        ]),
    ];
}

function prescriptionOp(array $credential, array $fixture, ?int $series, int $number, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();
    $action = $overrides['action'] ?? 'create';
    $payload = [
        'id' => $entityId,
        'org_id' => $credential['orgId'],
        'location_id' => $credential['locationId'],
        'visit_id' => $fixture['visitId'],
        'patient_id' => $fixture['patientId'],
        'practitioner_id' => $fixture['practitionerId'],
        'series' => $series,
        'issued_year' => 2026,
        'number' => $number,
        'diagnosis' => null,
        'printed_at' => null,
        'created_by' => $credential['membershipId'],
        'created_at' => now()->toIso8601String(),
    ];

    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => 'prescriptions',
        'entity_id' => $entityId,
        'action' => $action,
        'payload' => $action === 'delete' ? null : array_merge($payload, $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ], $overrides);
}

function prescriptionItemOp(string $prescriptionId, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();
    $action = $overrides['action'] ?? 'create';

    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => 'prescription_items',
        'entity_id' => $entityId,
        'action' => $action,
        'payload' => $action === 'delete' ? null : array_merge([
            'id' => $entityId,
            'prescription_id' => $prescriptionId,
            'name' => 'Diclofenac 50mg',
            'form' => 'Tablet',
            'instructions' => 'قرص × 2 يومياً · بعد الأكل',
            'duration' => '7 أيام',
            'note' => null,
            'position' => 1,
        ], $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ], $overrides);
}

/**
 * An update carrying the whole row as created with printed_at and
 * diagnosis set — the shape the web's print write pushes (mutate() sends
 * the full row).
 */
function printOp(array $create, int $baseRev, ?string $printedAt, ?string $diagnosis): array
{
    return [
        'op_id' => (string) Str::uuid(),
        'entity' => 'prescriptions',
        'entity_id' => $create['entity_id'],
        'action' => 'update',
        'payload' => array_merge($create['payload'], ['printed_at' => $printedAt, 'diagnosis' => $diagnosis]),
        'created_at' => now()->toIso8601String(),
        'base_rev' => $baseRev,
    ];
}

function acceptedResult(array $op): array
{
    return ['op_id' => $op['op_id'], 'status' => 'accepted'];
}

function rejectedResult(array $op, string $reason): array
{
    return ['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => $reason];
}

/** Removes every prescription and item (and their ledger and audit rows) a test pushed for this org. */
function forgetPrescriptions(string $orgId): void
{
    $fx = test()->fx();
    $prescriptionIds = $fx->table('prescriptions')->where('org_id', $orgId)->pluck('id')->all();
    $entities = ['prescriptions', 'prescription_items'];

    // By org and entity, not by the ids still present: an item a test
    // deleted has left ledger and audit rows behind.
    $fx->table('audit_log')->where('org_id', $orgId)->whereIn('entity', $entities)->delete();
    $fx->table('sync_ledger')->where('org_id', $orgId)->whereIn('entity', $entities)->delete();
    $fx->table('prescription_items')->whereIn('prescription_id', $prescriptionIds)->delete();
    $fx->table('prescriptions')->whereIn('id', $prescriptionIds)->delete();
}

// --- Create and numbering ----------------------------------------------------

test('a prescription created together with its first item is accepted, both at rev 1, created_by from the token', function () {
    $fixture = prescriptionFixture();
    $credential = $fixture['credential'];
    $create = prescriptionOp($credential, $fixture, 1, 1, ['payload' => ['created_by' => (string) Str::uuid()]]);
    $item = prescriptionItemOp($create['entity_id']);

    pushOps($credential['token'], [$create, $item])->assertOk()->assertJson(['results' => [
        [...acceptedResult($create), 'rev' => 1],
        [...acceptedResult($item), 'rev' => 1],
    ]]);

    $row = $this->fx()->table('prescriptions')->where('id', $create['entity_id'])->first();
    expect([$row->series, $row->issued_year, $row->number, $row->rev])->toBe([1, 2026, 1, 1]);
    expect($row->created_by)->toBe($credential['membershipId']);
    expect($row->printed_at)->toBeNull();
    $itemRow = $this->fx()->table('prescription_items')->where('id', $item['entity_id'])->first();
    expect([$itemRow->name, $itemRow->instructions, $itemRow->position, $itemRow->rev])
        ->toBe(['Diclofenac 50mg', 'قرص × 2 يومياً · بعد الأكل', 1, 1]);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', [$create['op_id'], $item['op_id']])->count())->toBe(2);

    forgetPrescriptions($credential['orgId']);
});

test('a create outside the pushing device\'s own series is rejected as series_mismatch and writes nothing', function () {
    $fixture = prescriptionFixture();
    $credential = $fixture['credential'];
    $otherSeries = prescriptionOp($credential, $fixture, 2, 1);
    $noSeries = prescriptionOp($credential, $fixture, null, 1);
    unset($noSeries['payload']['series']);

    pushOps($credential['token'], [$otherSeries, $noSeries])->assertJson(['results' => [
        rejectedResult($otherSeries, 'series_mismatch'),
        rejectedResult($noSeries, 'series_mismatch'),
    ]]);

    expect($this->fx()->table('prescriptions')->where('org_id', $credential['orgId'])->count())->toBe(0);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', [$otherSeries['op_id'], $noSeries['op_id']])->count())->toBe(0);
});

test('two devices at one location push the same RX number in different series, and both are accepted', function () {
    $deviceA = makeAuthenticatedDevice();
    $deviceB = [
        ...makeSecondAuthenticatedDeviceInSameOrg($deviceA['orgId'], $deviceA['locationId']),
        'orgId' => $deviceA['orgId'],
        'locationId' => $deviceA['locationId'],
    ];
    $visitA = prescriptionFixture($deviceA, 1);
    $visitB = prescriptionFixture($deviceA, 2);

    $fromA = prescriptionOp($deviceA, $visitA, 1, 7);
    $fromB = prescriptionOp($deviceB, $visitB, 2, 7);

    pushOps($deviceA['token'], [$fromA])->assertJson(['results' => [acceptedResult($fromA)]]);
    pushOps($deviceB['token'], [$fromB])->assertJson(['results' => [acceptedResult($fromB)]]);

    $rows = $this->fx()->table('prescriptions')->where('org_id', $deviceA['orgId'])->orderBy('series')->get();
    expect($rows->pluck('series')->all())->toBe([1, 2]);
    expect($rows->pluck('number')->all())->toBe([7, 7]);

    forgetPrescriptions($deviceA['orgId']);
});

test('an update that changes a prescription\'s number, series or year is rejected as number_immutable', function () {
    $fixture = prescriptionFixture();
    $credential = $fixture['credential'];
    $create = prescriptionOp($credential, $fixture, 1, 4);
    pushOps($credential['token'], [$create])->assertJson(['results' => [acceptedResult($create)]]);

    foreach ([['number' => 5], ['series' => 2], ['issued_year' => 2027]] as $change) {
        $update = prescriptionOp($credential, $fixture, 1, 4, [
            'entity_id' => $create['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => $change,
        ]);

        pushOps($credential['token'], [$update])->assertJson(['results' => [rejectedResult($update, 'number_immutable')]]);
    }

    $row = $this->fx()->table('prescriptions')->where('id', $create['entity_id'])->first();
    expect([$row->number, $row->series, $row->issued_year, $row->rev])->toBe([4, 1, 2026, 1]);

    forgetPrescriptions($credential['orgId']);
});

test('a number already taken in the pusher\'s own series is conflict_number_taken, never conflict_already_exists', function () {
    $credential = makeAuthenticatedDevice();
    $first = prescriptionFixture($credential, 1);
    $second = prescriptionFixture($credential, 2);
    $create = prescriptionOp($credential, $first, 1, 12);
    pushOps($credential['token'], [$create])->assertJson(['results' => [acceptedResult($create)]]);

    $clash = prescriptionOp($credential, $second, 1, 12);
    pushOps($credential['token'], [$clash])->assertJson(['results' => [rejectedResult($clash, 'conflict_number_taken')]]);

    // The same entity_id created twice is still the primary key's conflict.
    $sameId = prescriptionOp($credential, $second, 1, 13, ['entity_id' => $create['entity_id']]);
    pushOps($credential['token'], [$sameId])->assertJson(['results' => [rejectedResult($sameId, 'conflict_already_exists')]]);

    forgetPrescriptions($credential['orgId']);
});

test('a second prescription for the same visit is conflict_visit_has_prescription and writes nothing', function () {
    $deviceA = makeAuthenticatedDevice();
    $deviceB = [
        ...makeSecondAuthenticatedDeviceInSameOrg($deviceA['orgId'], $deviceA['locationId']),
        'orgId' => $deviceA['orgId'],
        'locationId' => $deviceA['locationId'],
    ];
    $fixture = prescriptionFixture($deviceA);

    $first = prescriptionOp($deviceA, $fixture, 1, 1);
    pushOps($deviceA['token'], [$first])->assertJson(['results' => [acceptedResult($first)]]);

    // Another device, its own series, its own number — only the visit is shared.
    $second = prescriptionOp($deviceB, $fixture, 2, 1);
    $secondItem = prescriptionItemOp($second['entity_id']);
    pushOps($deviceB['token'], [$second, $secondItem])->assertJson(['results' => [
        rejectedResult($second, 'conflict_visit_has_prescription'),
        ['op_id' => $secondItem['op_id'], 'status' => 'failed'],
    ]]);

    expect($this->fx()->table('prescriptions')->where('visit_id', $fixture['visitId'])->pluck('id')->all())->toBe([$first['entity_id']]);
    expect($this->fx()->table('sync_ledger')->where('op_id', $second['op_id'])->exists())->toBeFalse();

    forgetPrescriptions($deviceA['orgId']);
});

// --- The printed lock --------------------------------------------------------

test('before printing, items can be added, edited and removed', function () {
    $fixture = prescriptionFixture();
    $credential = $fixture['credential'];
    $create = prescriptionOp($credential, $fixture, 1, 1);
    $item = prescriptionItemOp($create['entity_id']);
    $second = prescriptionItemOp($create['entity_id'], ['payload' => ['name' => 'Paracetamol 500mg', 'position' => 2]]);
    pushOps($credential['token'], [$create, $item, $second])->assertJson(['results' => [
        acceptedResult($create), acceptedResult($item), acceptedResult($second),
    ]]);

    $edit = prescriptionItemOp($create['entity_id'], [
        'entity_id' => $item['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => ['duration' => '5 أيام'],
    ]);
    $remove = prescriptionItemOp($create['entity_id'], ['entity_id' => $second['entity_id'], 'action' => 'delete', 'base_rev' => 1]);

    pushOps($credential['token'], [$edit, $remove])->assertJson(['results' => [
        [...acceptedResult($edit), 'rev' => 2], acceptedResult($remove),
    ]]);
    expect($this->fx()->table('prescription_items')->where('prescription_id', $create['entity_id'])->pluck('duration', 'id')->all())
        ->toBe([$item['entity_id'] => '5 أيام']);

    forgetPrescriptions($credential['orgId']);
});

test('after the first print, every item write and every change to the prescription is prescription_printed', function () {
    $fixture = prescriptionFixture();
    $credential = $fixture['credential'];
    $create = prescriptionOp($credential, $fixture, 1, 1);
    $item = prescriptionItemOp($create['entity_id']);
    pushOps($credential['token'], [$create, $item])->assertJson(['results' => [acceptedResult($create), acceptedResult($item)]]);

    $printedAt = now()->subMinute()->toIso8601String();
    $print = printOp($create, 1, $printedAt, 'التهاب وتر الرضفة');
    pushOps($credential['token'], [$print])->assertJson(['results' => [[...acceptedResult($print), 'rev' => 2]]]);

    $refused = [
        prescriptionItemOp($create['entity_id'], ['payload' => ['position' => 2]]),
        prescriptionItemOp($create['entity_id'], [
            'entity_id' => $item['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => ['name' => 'Ibuprofen 400mg'],
        ]),
        prescriptionItemOp($create['entity_id'], ['entity_id' => $item['entity_id'], 'action' => 'delete', 'base_rev' => 1]),
        printOp($create, 2, $printedAt, 'تشخيص تاني'),
        printOp($create, 2, $printedAt, null),
        prescriptionItemOp($create['entity_id'], [
            'entity_id' => $item['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => ['prescription_id' => $create['entity_id']],
        ]),
        printOp($create, 2, now()->toIso8601String(), 'التهاب وتر الرضفة'),
        printOp($create, 2, null, 'التهاب وتر الرضفة'),
        prescriptionOp($credential, $fixture, 1, 1, ['entity_id' => $create['entity_id'], 'action' => 'delete', 'base_rev' => 2]),
    ];

    foreach ($refused as $op) {
        pushOps($credential['token'], [$op])->assertJson(['results' => [rejectedResult($op, 'prescription_printed')]]);
    }

    $row = $this->fx()->table('prescriptions')->where('id', $create['entity_id'])->first();
    expect($row->rev)->toBe(2);
    expect($row->diagnosis)->toBe('التهاب وتر الرضفة');
    expect($row->printed_at)->not->toBeNull();
    $items = $this->fx()->table('prescription_items')->where('prescription_id', $create['entity_id'])->get();
    expect($items->pluck('id')->all())->toBe([$item['entity_id']]);
    expect($items->first()->name)->toBe('Diclofenac 50mg');
    expect($items->first()->rev)->toBe(1);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', array_column($refused, 'op_id'))->count())->toBe(0);

    forgetPrescriptions($credential['orgId']);
});

test('a repeated identical print is accepted as a no-op: no rev bump, no ledger row, nothing written', function () {
    $fixture = prescriptionFixture();
    $credential = $fixture['credential'];
    $create = prescriptionOp($credential, $fixture, 1, 1);
    $item = prescriptionItemOp($create['entity_id']);
    pushOps($credential['token'], [$create, $item])->assertJson(['results' => [acceptedResult($create), acceptedResult($item)]]);

    $printedAt = now()->subMinute()->toIso8601String();
    $print = printOp($create, 1, $printedAt, 'التهاب وتر الرضفة');
    pushOps($credential['token'], [$print])->assertJson(['results' => [[...acceptedResult($print), 'rev' => 2]]]);

    // The same print again (as another device holding the pre-print row
    // would send it): a new op, the same values.
    $again = printOp($create, 1, $printedAt, 'التهاب وتر الرضفة');
    pushOps($credential['token'], [$again])->assertJson(['results' => [[...acceptedResult($again), 'rev' => 2]]]);

    expect($this->fx()->table('prescriptions')->where('id', $create['entity_id'])->value('rev'))->toBe(2);
    expect($this->fx()->table('sync_ledger')->where('op_id', $again['op_id'])->exists())->toBeFalse();
    expect($this->fx()->table('audit_log')->where('entity_id', $create['entity_id'])->count())->toBe(2);

    forgetPrescriptions($credential['orgId']);
});

// --- Pull and bootstrap ------------------------------------------------------

test('pull and bootstrap both return prescriptions and prescription_items', function () {
    $fixture = prescriptionFixture();
    $credential = $fixture['credential'];
    $create = prescriptionOp($credential, $fixture, 1, 3);
    $item = prescriptionItemOp($create['entity_id']);
    pushOps($credential['token'], [$create, $item])->assertJson(['results' => [acceptedResult($create), acceptedResult($item)]]);

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'));
    expect($pulled->firstWhere('entity_id', $create['entity_id'])['entity'])->toBe('prescriptions');
    expect($pulled->firstWhere('entity_id', $create['entity_id'])['payload']['number'])->toBe(3);
    expect($pulled->firstWhere('entity_id', $item['entity_id'])['entity'])->toBe('prescription_items');
    expect($pulled->firstWhere('entity_id', $item['entity_id'])['payload']['name'])->toBe('Diclofenac 50mg');

    $bootstrapped = collect(drainBootstrap($credential['token']));
    expect($bootstrapped->firstWhere('entity_id', $create['entity_id'])['entity'])->toBe('prescriptions');
    expect($bootstrapped->firstWhere('entity_id', $create['entity_id'])['rev'])->toBe(1);
    expect($bootstrapped->firstWhere('entity_id', $item['entity_id'])['entity'])->toBe('prescription_items');
    expect($bootstrapped->firstWhere('entity_id', $item['entity_id'])['payload']['instructions'])->toBe('قرص × 2 يومياً · بعد الأكل');

    forgetPrescriptions($credential['orgId']);
});

// --- Cross-org ---------------------------------------------------------------

test('cross-org: org B can neither read nor write org A\'s prescriptions or items', function () {
    $fixtureA = prescriptionFixture();
    $credentialA = $fixtureA['credential'];
    $create = prescriptionOp($credentialA, $fixtureA, 1, 1);
    $item = prescriptionItemOp($create['entity_id'], ['payload' => ['name' => 'Org A secret drug']]);
    pushOps($credentialA['token'], [$create, $item])->assertJson(['results' => [acceptedResult($create), acceptedResult($item)]]);

    $credentialB = makeAuthenticatedDevice();

    // Reads, through the sync endpoints.
    foreach ([pullOps($credentialB['token'])->assertOk()->getContent(), json_encode(drainBootstrap($credentialB['token']))] as $content) {
        expect($content)->not->toContain($create['entity_id']);
        expect($content)->not->toContain($item['entity_id']);
        expect($content)->not->toContain('Org A secret drug');
    }

    // Writes, through push: a create naming A's org, an item hung on A's
    // prescription, and an edit or delete of A's rows.
    $foreignCreate = prescriptionOp($credentialB, $fixtureA, 1, 99, ['payload' => ['org_id' => $credentialA['orgId']]]);
    $foreignItem = prescriptionItemOp($create['entity_id'], ['payload' => ['name' => 'injected']]);
    $foreignEdit = prescriptionItemOp($create['entity_id'], [
        'entity_id' => $item['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => ['name' => 'changed'],
    ]);
    $foreignDelete = prescriptionItemOp($create['entity_id'], ['entity_id' => $item['entity_id'], 'action' => 'delete', 'base_rev' => 1]);
    $foreignPrint = prescriptionOp($credentialB, $fixtureA, 1, 1, [
        'entity_id' => $create['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => ['diagnosis' => 'x'],
    ]);

    pushOps($credentialB['token'], [$foreignCreate, $foreignItem, $foreignEdit, $foreignDelete, $foreignPrint])->assertJson(['results' => [
        ['op_id' => $foreignCreate['op_id'], 'status' => 'failed', 'reason' => 'org_mismatch'],
        ['op_id' => $foreignItem['op_id'], 'status' => 'failed', 'reason' => 'internal_error'],
        rejectedResult($foreignEdit, 'conflict_stale_rev'),
        ['op_id' => $foreignDelete['op_id'], 'status' => 'blocked'],
        rejectedResult($foreignPrint, 'conflict_stale_rev'),
    ]]);

    // And directly, as org B's membership on the RLS-bound connection.
    $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($create, $item) {
        expect($db->table('prescriptions')->where('id', $create['entity_id'])->exists())->toBeFalse();
        expect($db->table('prescription_items')->where('id', $item['entity_id'])->exists())->toBeFalse();
        expect($db->table('prescriptions')->where('id', $create['entity_id'])->update(['diagnosis' => 'x']))->toBe(0);
        expect($db->table('prescription_items')->where('id', $item['entity_id'])->delete())->toBe(0);
    });

    $caught = null;
    try {
        $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($create) {
            $db->table('prescription_items')->insert([
                'id' => (string) Str::uuid(), 'prescription_id' => $create['entity_id'],
                'name' => 'injected', 'instructions' => 'x', 'position' => 2,
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }
    expect($caught?->getCode())->toBe('42501');

    // Nothing of A's moved.
    expect($this->fx()->table('prescriptions')->where('id', $create['entity_id'])->value('rev'))->toBe(1);
    expect($this->fx()->table('prescription_items')->where('prescription_id', $create['entity_id'])->pluck('name')->all())->toBe(['Org A secret drug']);

    // Sanity: org A's own membership does see both.
    $this->withMembership($this->asApp(), $credentialA['membershipId'], function ($db) use ($create, $item) {
        expect($db->table('prescriptions')->where('id', $create['entity_id'])->exists())->toBeTrue();
        expect($db->table('prescription_items')->where('id', $item['entity_id'])->exists())->toBeTrue();
    });

    forgetPrescriptions($credentialA['orgId']);
});

// --- Schema ------------------------------------------------------------------

test('both tables have ENABLE and FORCE row level security, one scope policy with USING and WITH CHECK, and clintra_app\'s standard grant', function () {
    foreach (['prescriptions', 'prescription_items'] as $table) {
        $flags = $this->asOwner()->selectOne('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ? AND relkind = \'r\'', [$table]);
        expect($flags->relrowsecurity)->toBeTrue("{$table} is missing ENABLE ROW LEVEL SECURITY");
        expect($flags->relforcerowsecurity)->toBeTrue("{$table} is missing FORCE ROW LEVEL SECURITY");

        $grants = collect($this->asOwner()->select(<<<'SQL'
            SELECT privilege_type FROM information_schema.role_table_grants
            WHERE grantee = 'clintra_app' AND table_name = ? ORDER BY privilege_type
        SQL, [$table]))->pluck('privilege_type')->all();
        expect($grants)->toBe(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
    }

    $policies = collect($this->asOwner()->select(<<<'SQL'
        SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('prescriptions', 'prescription_items', 'visits')
        ORDER BY tablename
    SQL))->keyBy('tablename');

    expect($policies)->toHaveCount(3);
    // prescriptions' expression is the visits policy's, verbatim.
    expect($policies['prescriptions']->policyname)->toBe('prescriptions_scope');
    expect($policies['prescriptions']->cmd)->toBe('ALL');
    expect($policies['prescriptions']->qual)->toBe($policies['visits']->qual);
    expect($policies['prescriptions']->with_check)->toBe($policies['visits']->qual);
    expect($policies['prescription_items']->policyname)->toBe('prescription_items_scope');
    expect($policies['prescription_items']->cmd)->toBe('ALL');
    expect($policies['prescription_items']->qual)->toStartWith('(prescription_id IN ( SELECT prescriptions.id');
    expect($policies['prescription_items']->with_check)->toBe($policies['prescription_items']->qual);
});

test('the unique keys are the per-series number and one prescription per visit, and no foreign key cascades', function () {
    $constraints = collect($this->asOwner()->select(<<<'SQL'
        SELECT conname, contype, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid IN ('prescriptions'::regclass, 'prescription_items'::regclass) AND contype IN ('u', 'f')
        ORDER BY conname
    SQL));

    expect($constraints->where('contype', 'u')->pluck('definition', 'conname')->all())->toBe([
        'prescriptions_location_id_issued_year_series_number_unique' => 'UNIQUE (location_id, issued_year, series, number)',
        'prescriptions_visit_id_unique' => 'UNIQUE (visit_id)',
    ]);

    $foreignKeys = $constraints->where('contype', 'f');
    expect($foreignKeys)->toHaveCount(7);
    foreach ($foreignKeys as $foreignKey) {
        expect($foreignKey->definition)->toEndWith('ON DELETE RESTRICT');
    }
});
