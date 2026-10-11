<?php

use App\Support\ActivationCode;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Per-device number series (docs/schema.md's v16 additions):
 * register_device(jsonb) hands every device at a location its own series,
 * and the push endpoint holds invoices and payments to it.
 * 2026_09_12_000024_add_device_number_series.php,
 * 2026_09_12_000025_assign_device_series_at_registration.php,
 * App\Support\Sync\SyncOpApplier.
 */
beforeEach(function () {
    RateLimiter::clear('device-register:ip:127.0.0.1');
});

function registerThroughEndpoint(string $phone, string $plainCode, ?string $deviceId = null)
{
    return test()->postJson('/api/devices/register', [
        'phone' => $phone,
        'activation_code' => $plainCode,
        'device_id' => $deviceId ?? (string) Str::uuid(),
    ]);
}

/** Deletes devices a registration created (register_device writes them, not a fixture helper, so afterEach's tracked cleanup never sees them). */
function forgetRegisteredDevices(string $orgId): void
{
    $test = test();
    $test->fx()->table('activation_codes')->where('org_id', $orgId)->update(['used_by_device_id' => null]);
    $test->fx()->table('device')->where('org_id', $orgId)->delete();
    $test->fx()->table('audit_log')->where('org_id', $orgId)->delete();
}

/**
 * @return array{practitionerId: string, patientId: string}
 */
function invoiceReferences(string $orgId): array
{
    $test = test();
    $specialtyId = $test->makeSpecialtyTemplate(null);

    return [
        'practitionerId' => $test->makePractitioner($orgId, $specialtyId),
        'patientId' => $test->makePatient($orgId),
    ];
}

function invoiceOp(array $credential, array $refs, ?int $series, int $number, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();
    $payload = [
        'id' => $entityId,
        'org_id' => $credential['orgId'],
        'location_id' => $credential['locationId'],
        'number' => $number,
        'issued_year' => 2026,
        'series' => $series,
        'patient_id' => $refs['patientId'],
        'practitioner_id' => $refs['practitionerId'],
        'visit_id' => null,
        'total' => 40000,
        'paid' => 0,
        'status' => 'unpaid',
        'issued_at' => now()->toIso8601String(),
    ];

    if ($series === null) {
        unset($payload['series']);
    }

    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => 'invoices',
        'entity_id' => $entityId,
        'action' => $overrides['action'] ?? 'create',
        'payload' => array_merge($payload, $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ], $overrides);
}

/** A create carries no base_rev at all (PushSyncOpsRequest rejects a null one); an update or delete carries the given one. */
function withBaseRev(array $op, array $overrides): array
{
    if ($op['action'] !== 'create') {
        $op['base_rev'] = $overrides['base_rev'] ?? 1;
    }

    return $op;
}

function paymentOp(array $credential, string $invoiceId, int $series, string $receiptNumber, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();

    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => 'payments',
        'entity_id' => $entityId,
        'action' => $overrides['action'] ?? 'create',
        'payload' => array_merge([
            'id' => $entityId,
            'invoice_id' => $invoiceId,
            'location_id' => $credential['locationId'],
            'amount' => 10000,
            'method' => 'cash',
            'receipt_number' => $receiptNumber,
            'series' => $series,
            'note' => null,
            'after_close' => false,
            'created_by' => $credential['membershipId'],
            'created_at' => now()->toIso8601String(),
        ], $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ], $overrides);
}

function deviceSeriesOf(string $deviceId): ?int
{
    $series = test()->fx()->table('device')->where('id', $deviceId)->value('series');

    return $series === null ? null : (int) $series;
}

/** Removes every invoice/payment (and its ledger and audit rows) a test pushed for this org. */
function forgetNumberedRows(string $orgId): void
{
    $test = test();
    $invoiceIds = $test->fx()->table('invoices')->where('org_id', $orgId)->pluck('id')->all();
    $paymentIds = $test->fx()->table('payments')->whereIn('invoice_id', $invoiceIds)->pluck('id')->all();
    $entityIds = [...$invoiceIds, ...$paymentIds];

    $test->fx()->table('audit_log')->whereIn('entity_id', $entityIds)->delete();
    $test->fx()->table('sync_ledger')->whereIn('entity_id', $entityIds)->delete();
    $test->fx()->table('payments')->whereIn('id', $paymentIds)->delete();
    $test->fx()->table('invoices')->whereIn('id', $invoiceIds)->delete();
}

// --- Registration assigns the series -------------------------------------

test('two devices registered at one location get series 1 and 2, through register_device itself', function () {
    $fixture = makeRegistrationFixture();
    $secondCode = ActivationCode::generate();
    $this->makeActivationCode($fixture['orgId'], $fixture['locationId'], $secondCode);
    $deviceA = (string) Str::uuid();
    $deviceB = (string) Str::uuid();

    $first = registerThroughEndpoint($fixture['phone'], $fixture['plainCode'], $deviceA);
    $second = registerThroughEndpoint($fixture['phone'], $secondCode, $deviceB);

    $first->assertOk();
    $second->assertOk();
    expect($first->json('series'))->toBe(1);
    expect($second->json('series'))->toBe(2);
    expect(deviceSeriesOf($deviceA))->toBe(1);
    expect(deviceSeriesOf($deviceB))->toBe(2);

    // The device's own audit row records the series it was given.
    $audit = $this->fx()->table('audit_log')->where('entity', 'device')->where('entity_id', $deviceB)->first();
    expect(json_decode($audit->after, true)['series'])->toBe(2);

    forgetRegisteredDevices($fixture['orgId']);
});

test('a revoked device keeps its series and it is never handed out again', function () {
    $fixture = makeRegistrationFixture();
    $secondCode = ActivationCode::generate();
    $this->makeActivationCode($fixture['orgId'], $fixture['locationId'], $secondCode);
    $revokedDevice = (string) Str::uuid();

    registerThroughEndpoint($fixture['phone'], $fixture['plainCode'], $revokedDevice)->assertOk();
    $this->fx()->table('device')->where('id', $revokedDevice)->update(['revoked_at' => now()->toIso8601String()]);

    $replacement = registerThroughEndpoint($fixture['phone'], $secondCode);

    $replacement->assertOk();
    expect($replacement->json('series'))->toBe(2);
    expect(deviceSeriesOf($revokedDevice))->toBe(1);

    forgetRegisteredDevices($fixture['orgId']);
});

test('another location of the same org starts its own series at 1', function () {
    $fixture = makeRegistrationFixture();
    $otherLocationId = $this->makeLocation($fixture['orgId'], 'second-branch');
    $otherCode = ActivationCode::generate();
    $this->makeActivationCode($fixture['orgId'], $otherLocationId, $otherCode);

    registerThroughEndpoint($fixture['phone'], $fixture['plainCode'])->assertOk();
    $atOtherLocation = registerThroughEndpoint($fixture['phone'], $otherCode);

    $atOtherLocation->assertOk();
    expect($atOtherLocation->json('location_id'))->toBe($otherLocationId);
    expect($atOtherLocation->json('series'))->toBe(1);

    forgetRegisteredDevices($fixture['orgId']);
});

test('two concurrent registrations at one location never take the same series', function () {
    $fixture = makeRegistrationFixture();
    $secondCode = ActivationCode::generate();
    $this->makeActivationCode($fixture['orgId'], $fixture['locationId'], $secondCode);

    $config = config('database.connections.pgsql');
    $script = __DIR__.'/../../scripts/register_device_race.php';

    $buildCommand = function (string $plainCode) use ($config, $fixture, $script) {
        $payload = json_encode([
            'device_id' => (string) Str::uuid(),
            'phone' => $fixture['phone'],
            'code_hash' => ActivationCode::hash($plainCode),
            'audit_device_id' => (string) Str::uuid(),
            'audit_code_used_id' => (string) Str::uuid(),
        ]);

        return [
            PHP_BINARY, $script,
            $config['host'], (string) $config['port'], $config['database'],
            $config['username'], $config['password'], $payload,
        ];
    };

    // Two separate OS processes and connections, two different valid codes
    // for the same location, launched without waiting on each other — the
    // advisory lock is what has to keep them from reading the same max.
    $processA = proc_open($buildCommand($fixture['plainCode']), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesA);
    $processB = proc_open($buildCommand($secondCode), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesB);

    $outputA = stream_get_contents($pipesA[1]);
    $outputB = stream_get_contents($pipesB[1]);
    foreach ([...$pipesA, ...$pipesB] as $pipe) {
        fclose($pipe);
    }
    proc_close($processA);
    proc_close($processB);

    expect([trim($outputA), trim($outputB)])->toBe(['OK', 'OK']);

    $series = $this->fx()->table('device')->where('location_id', $fixture['locationId'])->orderBy('series')->pluck('series')->all();
    expect($series)->toBe([1, 2]);

    forgetRegisteredDevices($fixture['orgId']);
});

// --- Push holds invoices and payments to the pusher's series -------------

test('two devices at one location push invoices with the same number in different series, and both are accepted', function () {
    $deviceA = makeAuthenticatedDevice();
    $deviceB = makeSecondAuthenticatedDeviceInSameOrg($deviceA['orgId'], $deviceA['locationId']);
    $deviceB = [...$deviceB, 'orgId' => $deviceA['orgId'], 'locationId' => $deviceA['locationId']];
    $refs = invoiceReferences($deviceA['orgId']);

    expect(deviceSeriesOf($deviceA['deviceId']))->toBe(1);
    expect(deviceSeriesOf($deviceB['deviceId']))->toBe(2);

    $fromA = invoiceOp($deviceA, $refs, 1, 7);
    $fromB = invoiceOp($deviceB, $refs, 2, 7);

    pushOps($deviceA['token'], [$fromA])->assertJson(['results' => [['op_id' => $fromA['op_id'], 'status' => 'accepted']]]);
    pushOps($deviceB['token'], [$fromB])->assertJson(['results' => [['op_id' => $fromB['op_id'], 'status' => 'accepted']]]);

    $rows = $this->fx()->table('invoices')->whereIn('id', [$fromA['entity_id'], $fromB['entity_id']])->orderBy('series')->get();
    expect($rows->pluck('series')->all())->toBe([1, 2]);
    expect($rows->pluck('number')->all())->toBe([7, 7]);

    forgetNumberedRows($deviceA['orgId']);
});

test('two devices at one location push payments with the same receipt_number in different series, and both are accepted', function () {
    $deviceA = makeAuthenticatedDevice();
    $deviceB = makeSecondAuthenticatedDeviceInSameOrg($deviceA['orgId'], $deviceA['locationId']);
    $deviceB = [...$deviceB, 'orgId' => $deviceA['orgId'], 'locationId' => $deviceA['locationId']];
    $refs = invoiceReferences($deviceA['orgId']);

    $invoiceA = invoiceOp($deviceA, $refs, 1, 1);
    $invoiceB = invoiceOp($deviceB, $refs, 2, 1);
    pushOps($deviceA['token'], [$invoiceA])->assertJson(['results' => [['status' => 'accepted']]]);
    pushOps($deviceB['token'], [$invoiceB])->assertJson(['results' => [['status' => 'accepted']]]);

    $paymentA = paymentOp($deviceA, $invoiceA['entity_id'], 1, '1');
    $paymentB = paymentOp($deviceB, $invoiceB['entity_id'], 2, '1');

    pushOps($deviceA['token'], [$paymentA])->assertJson(['results' => [['op_id' => $paymentA['op_id'], 'status' => 'accepted']]]);
    pushOps($deviceB['token'], [$paymentB])->assertJson(['results' => [['op_id' => $paymentB['op_id'], 'status' => 'accepted']]]);

    $rows = $this->fx()->table('payments')->whereIn('id', [$paymentA['entity_id'], $paymentB['entity_id']])->orderBy('series')->get();
    expect($rows->pluck('series')->all())->toBe([1, 2]);
    expect($rows->pluck('receipt_number')->all())->toBe(['1', '1']);

    forgetNumberedRows($deviceA['orgId']);
});

test('a create in a series that is not the pushing device\'s own is rejected as series_mismatch and writes nothing', function () {
    $deviceA = makeAuthenticatedDevice();
    $refs = invoiceReferences($deviceA['orgId']);

    $otherSeries = invoiceOp($deviceA, $refs, 2, 1);
    $noSeries = invoiceOp($deviceA, $refs, null, 2);

    $response = pushOps($deviceA['token'], [$otherSeries, $noSeries]);

    $response->assertJson(['results' => [
        ['op_id' => $otherSeries['op_id'], 'status' => 'rejected', 'reason' => 'series_mismatch'],
        ['op_id' => $noSeries['op_id'], 'status' => 'rejected', 'reason' => 'series_mismatch'],
    ]]);
    expect($this->fx()->table('invoices')->whereIn('id', [$otherSeries['entity_id'], $noSeries['entity_id']])->count())->toBe(0);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', [$otherSeries['op_id'], $noSeries['op_id']])->count())->toBe(0);

    // Same rule for payments.
    $invoice = invoiceOp($deviceA, $refs, 1, 3);
    pushOps($deviceA['token'], [$invoice])->assertJson(['results' => [['status' => 'accepted']]]);
    $payment = paymentOp($deviceA, $invoice['entity_id'], 5, '1');
    pushOps($deviceA['token'], [$payment])->assertJson(['results' => [
        ['op_id' => $payment['op_id'], 'status' => 'rejected', 'reason' => 'series_mismatch'],
    ]]);

    forgetNumberedRows($deviceA['orgId']);
});

test('an update that changes an invoice\'s number, series or year, or a payment\'s receipt_number, is rejected as number_immutable', function () {
    $device = makeAuthenticatedDevice();
    $refs = invoiceReferences($device['orgId']);
    $create = invoiceOp($device, $refs, 1, 4);
    pushOps($device['token'], [$create])->assertJson(['results' => [['status' => 'accepted']]]);

    foreach ([['number' => 5], ['series' => 2], ['issued_year' => 2027]] as $change) {
        $update = invoiceOp($device, $refs, 1, 4, [
            'entity_id' => $create['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => $change,
        ]);

        pushOps($device['token'], [$update])->assertJson(['results' => [
            ['op_id' => $update['op_id'], 'status' => 'rejected', 'reason' => 'number_immutable'],
        ]]);
    }

    $row = $this->fx()->table('invoices')->where('id', $create['entity_id'])->first();
    expect([$row->number, $row->series, $row->issued_year, $row->rev])->toBe([4, 1, 2026, 1]);

    // An ordinary update that leaves the number alone still goes through.
    $paidUpdate = invoiceOp($device, $refs, 1, 4, [
        'entity_id' => $create['entity_id'], 'action' => 'update', 'base_rev' => 1, 'payload' => ['paid' => 10000, 'status' => 'partial'],
    ]);
    pushOps($device['token'], [$paidUpdate])->assertJson(['results' => [['op_id' => $paidUpdate['op_id'], 'status' => 'accepted', 'rev' => 2]]]);

    $payment = paymentOp($device, $create['entity_id'], 1, '9');
    pushOps($device['token'], [$payment])->assertJson(['results' => [['status' => 'accepted']]]);
    $renumber = paymentOp($device, $create['entity_id'], 1, '10', [
        'entity_id' => $payment['entity_id'], 'action' => 'update', 'base_rev' => 1,
    ]);
    pushOps($device['token'], [$renumber])->assertJson(['results' => [
        ['op_id' => $renumber['op_id'], 'status' => 'rejected', 'reason' => 'number_immutable'],
    ]]);
    expect($this->fx()->table('payments')->where('id', $payment['entity_id'])->value('receipt_number'))->toBe('9');

    forgetNumberedRows($device['orgId']);
});

test('a number already taken in the pusher\'s own series is conflict_number_taken, never conflict_already_exists', function () {
    $device = makeAuthenticatedDevice();
    $refs = invoiceReferences($device['orgId']);
    $first = invoiceOp($device, $refs, 1, 12);
    pushOps($device['token'], [$first])->assertJson(['results' => [['status' => 'accepted']]]);

    // A different invoice, same series and number — only a misbehaving
    // device could mint this.
    $clash = invoiceOp($device, $refs, 1, 12);
    pushOps($device['token'], [$clash])->assertJson(['results' => [
        ['op_id' => $clash['op_id'], 'status' => 'rejected', 'reason' => 'conflict_number_taken'],
    ]]);

    // The same entity_id created twice is still the primary key's conflict.
    $sameId = invoiceOp($device, $refs, 1, 13, ['entity_id' => $first['entity_id']]);
    pushOps($device['token'], [$sameId])->assertJson(['results' => [
        ['op_id' => $sameId['op_id'], 'status' => 'rejected', 'reason' => 'conflict_already_exists'],
    ]]);

    $payment = paymentOp($device, $first['entity_id'], 1, '3');
    pushOps($device['token'], [$payment])->assertJson(['results' => [['status' => 'accepted']]]);
    $paymentClash = paymentOp($device, $first['entity_id'], 1, '3');
    pushOps($device['token'], [$paymentClash])->assertJson(['results' => [
        ['op_id' => $paymentClash['op_id'], 'status' => 'rejected', 'reason' => 'conflict_number_taken'],
    ]]);

    forgetNumberedRows($device['orgId']);
});

// --- Pull and bootstrap tell a device its series -------------------------

test('pull and bootstrap both carry the requesting device\'s own series', function () {
    $deviceA = makeAuthenticatedDevice();
    $deviceB = makeSecondAuthenticatedDeviceInSameOrg($deviceA['orgId'], $deviceA['locationId']);

    expect(pullOps($deviceA['token'])->assertOk()->json('device_series'))->toBe(1);
    expect(pullOps($deviceB['token'])->assertOk()->json('device_series'))->toBe(2);
    expect(bootstrapPull($deviceA['token'])->assertOk()->json('device_series'))->toBe(1);
    expect(bootstrapPull($deviceB['token'])->assertOk()->json('device_series'))->toBe(2);
});

test('cross-org: a device of org B never learns org A\'s device series through registration, pull, bootstrap or push', function () {
    // Org A: three devices at one location, series 1..3.
    $orgA = makeRegistrationFixture();
    foreach ([1, 2, 3] as $series) {
        $this->makeDevice($orgA['orgId'], $orgA['locationId'], $orgA['membershipId'], series: $series);
    }

    // Org B registers for real, through register_device.
    $orgB = makeRegistrationFixture();
    $registration = registerThroughEndpoint($orgB['phone'], $orgB['plainCode']);
    $registration->assertOk();
    expect($registration->json('series'))->toBe(1);
    $tokenB = $registration->json('token');
    $deviceB = $registration->json('device_id');

    $orgADeviceIds = $this->fx()->table('device')->where('org_id', $orgA['orgId'])->pluck('id')->all();

    foreach ([pullOps($tokenB), bootstrapPull($tokenB)] as $response) {
        $response->assertOk();
        expect($response->json('device_series'))->toBe(1);
        foreach ($orgADeviceIds as $id) {
            expect($response->getContent())->not->toContain($id);
        }
    }

    // B claiming org A's series 3 is judged against B's own series only.
    $credentialB = ['orgId' => $orgB['orgId'], 'locationId' => $orgB['locationId'], 'membershipId' => $orgB['membershipId']];
    $refs = invoiceReferences($orgB['orgId']);
    $op = invoiceOp($credentialB, $refs, 3, 1);
    pushOps($tokenB, [$op])->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'series_mismatch']]]);

    // And the device table itself shows B nothing of org A.
    $visibleToB = $this->withMembership($this->asApp(), $orgB['membershipId'], fn ($db) => $db->table('device')->pluck('id')->all());
    expect($visibleToB)->toBe([$deviceB]);

    forgetRegisteredDevices($orgB['orgId']);
});

// --- Schema ---------------------------------------------------------------

test('device keeps ENABLE and FORCE row level security and its one unchanged policy after the series migration', function () {
    $flags = $this->asOwner()->selectOne("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'device' AND relkind = 'r'");
    expect($flags->relrowsecurity)->toBeTrue();
    expect($flags->relforcerowsecurity)->toBeTrue();

    $policies = $this->asOwner()->select(<<<'SQL'
        SELECT policyname, permissive, roles::text AS roles, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = 'public' AND tablename = 'device'
    SQL);
    expect(array_map(fn ($row) => (array) $row, $policies))->toBe([[
        'policyname' => 'device_scope',
        'permissive' => 'PERMISSIVE',
        'roles' => '{public}',
        'cmd' => 'ALL',
        'qual' => '(org_id = current_org())',
        'with_check' => '(org_id = current_org())',
    ]]);
});

test('series is NOT NULL with no default on device, invoices and payments, and the number constraints include it', function () {
    $columns = $this->asOwner()->select(<<<'SQL'
        SELECT table_name, is_nullable, column_default, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'series'
        ORDER BY table_name
    SQL);
    expect(array_map(fn ($row) => (array) $row, $columns))->toBe([
        ['table_name' => 'device', 'is_nullable' => 'NO', 'column_default' => null, 'data_type' => 'smallint'],
        ['table_name' => 'invoices', 'is_nullable' => 'NO', 'column_default' => null, 'data_type' => 'smallint'],
        ['table_name' => 'payments', 'is_nullable' => 'NO', 'column_default' => null, 'data_type' => 'smallint'],
    ]);

    $constraints = $this->asOwner()->select(<<<'SQL'
        SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE contype = 'u' AND conrelid::regclass::text IN ('device', 'invoices', 'payments')
        ORDER BY 1, 2
    SQL);
    expect(array_map(fn ($row) => (array) $row, $constraints))->toBe([
        ['table_name' => 'device', 'definition' => 'UNIQUE (location_id, series)'],
        ['table_name' => 'invoices', 'definition' => 'UNIQUE (location_id, issued_year, series, number)'],
        ['table_name' => 'payments', 'definition' => 'UNIQUE (location_id, series, receipt_number)'],
    ]);
});

test('the backfill numbers existing devices per location in registered_at order, then id, revoked ones included', function () {
    $migration = require database_path('migrations/2026_09_12_000024_add_device_number_series.php');
    $owner = $this->asOwner();
    $previousDefault = DB::getDefaultConnection();

    $orgId = $this->makeOrganization('backfill-org');
    $locationA = $this->makeLocation($orgId, 'a');
    $locationB = $this->makeLocation($orgId, 'b');
    $membershipId = $this->makeMembership($this->makeUser(), $orgId, ['role' => 'owner']);

    // Same ids sort deterministically: tieLow < tieHigh as uuid text.
    $tieLow = '00000000-0000-4000-8000-000000000001';
    $tieHigh = '00000000-0000-4000-8000-000000000002';
    $latest = (string) Str::uuid();
    $earliestRevoked = (string) Str::uuid();
    $otherLocation = (string) Str::uuid();
    $rows = [
        [$latest, $locationA, '2026-03-01T10:00:00+00:00', null],
        [$tieHigh, $locationA, '2026-02-01T09:00:00+00:00', null],
        [$tieLow, $locationA, '2026-02-01T09:00:00+00:00', null],
        [$earliestRevoked, $locationA, '2026-01-01T08:00:00+00:00', '2026-01-15T08:00:00+00:00'],
        [$otherLocation, $locationB, '2026-04-01T08:00:00+00:00', null],
    ];

    DB::setDefaultConnection('pgsql_owner');
    try {
        $owner->transaction(fn () => $migration->down());

        // Inserted while device has no series column at all — the shape
        // every pre-existing database has when this migration first runs.
        foreach ($rows as [$id, $locationId, $registeredAt, $revokedAt]) {
            $this->fx()->table('device')->insert([
                'id' => $id, 'org_id' => $orgId, 'location_id' => $locationId,
                'membership_id' => $membershipId, 'registered_at' => $registeredAt, 'revoked_at' => $revokedAt,
            ]);
        }
    } finally {
        $owner->transaction(fn () => $migration->up());
        DB::setDefaultConnection($previousDefault);
    }

    expect(deviceSeriesOf($earliestRevoked))->toBe(1);
    expect(deviceSeriesOf($tieLow))->toBe(2);
    expect(deviceSeriesOf($tieHigh))->toBe(3);
    expect(deviceSeriesOf($latest))->toBe(4);
    expect(deviceSeriesOf($otherLocation))->toBe(1);

    $this->fx()->table('device')->where('org_id', $orgId)->delete();
});
