<?php

use Illuminate\Support\Str;

/**
 * GET /api/sync/bootstrap — see App\Support\Sync\SyncBootstrapPuller and
 * docs/sync-plan.md's Q9 addendum for the design being tested: a
 * replacement device's first sync should see today's schedule fast,
 * without waiting for the full, oldest-first ledger backfill
 * (docs/dry-run.md's scenario 17 finding).
 */
function bootstrapPull(string $token, ?string $cursor = null)
{
    $query = $cursor === null ? '' : '?cursor='.urlencode($cursor);

    return test()->withToken($token)->getJson('/api/sync/bootstrap'.$query);
}

/**
 * Drains GET /api/sync/bootstrap to completion, following has_more exactly
 * as a real client would (web/src/sync/engine.ts's runBootstrapWindow).
 *
 * @return list<array{entity: string, entity_id: string, rev: int, payload: array}>
 */
function drainBootstrap(string $token): array
{
    $rows = [];
    $cursor = null;
    $hasMore = true;
    $guard = 0;

    while ($hasMore) {
        if (++$guard > 500) {
            throw new RuntimeException('drainBootstrap: too many pages — likely an infinite loop');
        }

        $response = bootstrapPull($token, $cursor);
        $response->assertOk();
        $rows = [...$rows, ...$response->json('rows')];
        $cursor = $response->json('cursor');
        $hasMore = $response->json('has_more');
    }

    return $rows;
}

test('an in-window visit is returned; a visit far outside the 60-day window is not', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $patientId = $this->makePatient($credential['orgId']);

    $inWindowVisitId = $this->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], [
        'visit_date' => now()->toDateString(),
        'position' => 1,
    ]);
    $outOfWindowVisitId = $this->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], [
        'visit_date' => now()->subDays(120)->toDateString(),
        'position' => 1,
    ]);

    $rows = drainBootstrap($credential['token']);
    $entityIds = collect($rows)->where('entity', 'visits')->pluck('entity_id');

    expect($entityIds)->toContain($inWindowVisitId);
    expect($entityIds)->not->toContain($outOfWindowVisitId);
});

test('day_state within the window is returned; day_state outside it is not', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);

    $inWindowId = $this->makeDayState($practitionerId, $credential['locationId'], now()->toDateString());
    $outOfWindowId = $this->makeDayState($practitionerId, $credential['locationId'], now()->subDays(90)->toDateString());

    $rows = drainBootstrap($credential['token']);
    $entityIds = collect($rows)->where('entity', 'day_state')->pluck('entity_id');

    expect($entityIds)->toContain($inWindowId);
    expect($entityIds)->not->toContain($outOfWindowId);
});

test('a patient referenced by an in-window visit is included, with a current name', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $patientId = $this->makePatient($credential['orgId'], 'مريض اليوم');
    $unreferencedPatientId = $this->makePatient($credential['orgId'], 'مريض بلا زيارة قريبة');

    $this->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], [
        'visit_date' => now()->toDateString(),
        'position' => 1,
    ]);

    $rows = drainBootstrap($credential['token']);
    $patientRow = collect($rows)->where('entity', 'patients')->firstWhere('entity_id', $patientId);

    expect($patientRow)->not->toBeNull('a patient referenced by an in-window visit must be prefetched');
    expect($patientRow['payload']['full_name'])->toBe('مريض اليوم');

    // A patient with no visit inside the window at all is not this
    // endpoint's job — it arrives later, via the ordinary backfill.
    expect(collect($rows)->where('entity', 'patients')->pluck('entity_id'))->not->toContain($unreferencedPatientId);
});

test('pagination across stages: no gaps, no repeats, and an empty stage is skipped transparently', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $patientId = $this->makePatient($credential['orgId']);

    // No day_state fixtures at all in this org — stage 0 must be skipped
    // without the client ever seeing an empty page for it.
    $visitIds = [];
    for ($i = 0; $i < 210; $i++) {
        $visitIds[] = $this->makeVisit($credential['orgId'], $credential['locationId'], $practitionerId, $patientId, $credential['membershipId'], [
            'visit_date' => now()->toDateString(),
            'position' => $i + 1,
        ]);
    }

    $firstPage = bootstrapPull($credential['token']);
    $firstPage->assertOk();
    expect($firstPage->json('rows'))->toHaveCount(200);
    expect(collect($firstPage->json('rows'))->pluck('entity')->unique()->all())->toBe(['visits']);
    expect($firstPage->json('has_more'))->toBeTrue();

    $rows = drainBootstrap($credential['token']);
    $visitRows = collect($rows)->where('entity', 'visits');

    expect($visitRows)->toHaveCount(210);
    expect($visitRows->pluck('entity_id')->unique())->toHaveCount(210, 'no visit should repeat across pages');
    expect($visitRows->pluck('entity_id')->sort()->values()->all())->toBe(collect($visitIds)->sort()->values()->all());

    // Exactly one patients-stage row (the one visit-referenced patient),
    // reached only after all 210 visits — proves the loop actually
    // advances through every stage to the end, not just the first one.
    expect(collect($rows)->where('entity', 'patients')->pluck('entity_id')->all())->toBe([$patientId]);
});

test('org isolation: a token from org A never sees org B\'s bootstrap rows', function () {
    $credentialA = makeAuthenticatedDevice();
    $specialtyIdA = $this->makeSpecialtyTemplate(null);
    $practitionerIdA = $this->makePractitioner($credentialA['orgId'], $specialtyIdA);
    $patientIdA = $this->makePatient($credentialA['orgId']);
    $visitIdA = $this->makeVisit($credentialA['orgId'], $credentialA['locationId'], $practitionerIdA, $patientIdA, $credentialA['membershipId'], [
        'visit_date' => now()->toDateString(),
        'position' => 1,
    ]);

    $credentialB = makeAuthenticatedDevice();
    $specialtyIdB = $this->makeSpecialtyTemplate(null);
    $practitionerIdB = $this->makePractitioner($credentialB['orgId'], $specialtyIdB);
    $patientIdB = $this->makePatient($credentialB['orgId']);
    $visitIdB = $this->makeVisit($credentialB['orgId'], $credentialB['locationId'], $practitionerIdB, $patientIdB, $credentialB['membershipId'], [
        'visit_date' => now()->toDateString(),
        'position' => 1,
    ]);

    $rowsA = collect(drainBootstrap($credentialA['token']))->pluck('entity_id');
    expect($rowsA)->toContain($visitIdA);
    expect($rowsA)->not->toContain($visitIdB);

    $rowsB = collect(drainBootstrap($credentialB['token']))->pluck('entity_id');
    expect($rowsB)->toContain($visitIdB);
    expect($rowsB)->not->toContain($visitIdA);
});

test('a malformed cursor is rejected with a clean 422, never a 500', function () {
    $credential = makeAuthenticatedDevice();

    $response = $this->withToken($credential['token'])->getJson('/api/sync/bootstrap?cursor=not-a-real-cursor');

    $response->assertStatus(422);
});

test('completeness: after bootstrap drains, the ordinary pull still delivers the out-of-window row it skipped', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $patientId = $this->makePatient($credential['orgId']);

    // A push, not a fixture — this is the only way to get a real
    // sync_ledger row (bootstrap never touches the ledger at all), so the
    // ordinary pull path below has something to actually walk. created_at
    // is now() (not 120 days ago): SyncOpApplier's own clock-skew check
    // (SyncWindow::DAYS, unrelated to this endpoint) rejects a slot op
    // whose *created_at* is outside that window — this test's concern is
    // visit_date, a different field, modelling a record entered today for
    // a visit_date long past the bootstrap window.
    $oldVisitId = (string) Str::uuid();
    $oldVisitOp = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $oldVisitId,
        'action' => 'create',
        'payload' => [
            'id' => $oldVisitId,
            'org_id' => $credential['orgId'],
            'location_id' => $credential['locationId'],
            'practitioner_id' => $practitionerId,
            'patient_id' => $patientId,
            'visit_date' => now()->subDays(120)->toDateString(),
            'position' => 1,
            'status' => 'booked',
            'is_overbooked' => false,
            'source' => 'walkin',
            'created_by' => $credential['membershipId'],
            'created_at' => now()->toIso8601String(),
        ],
        'created_at' => now()->toIso8601String(),
    ];
    test()->withToken($credential['token'])->postJson('/api/sync/push', ['ops' => [$oldVisitOp]])
        ->assertJson(['results' => [['op_id' => $oldVisitOp['op_id'], 'status' => 'accepted']]]);

    $bootstrapRows = drainBootstrap($credential['token']);
    // Bootstrap must not have this row — it's outside the date window.
    expect(collect($bootstrapRows)->pluck('entity_id'))->not->toContain($oldVisitId);

    $pullResponse = test()->withToken($credential['token'])->getJson('/api/sync/pull');
    $pullResponse->assertOk();
    // The ordinary pull must still reach the row bootstrap skipped.
    expect(collect($pullResponse->json('rows'))->pluck('entity_id'))->toContain($oldVisitId);

    $this->fx()->table('audit_log')->where('entity_id', $oldVisitId)->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $oldVisitOp['op_id'])->delete();
    $this->fx()->table('visits')->where('id', $oldVisitId)->delete();
});
