<?php

use Illuminate\Support\Str;

/**
 * POST /api/sync/push — see App\Http\Controllers\SyncPushController and
 * App\Support\Sync\SyncOpApplier for the implementation, and
 * docs/sync-plan.md's decisions for the rules being tested.
 */
function pushOps(string $token, array $ops)
{
    return test()->withToken($token)->postJson('/api/sync/push', ['ops' => $ops]);
}

/**
 * @return array{op_id: string, entity: string, entity_id: string, action: string, payload: ?array, created_at: string, base_rev?: int}
 */
function patientOp(string $orgId, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();
    $action = $overrides['action'] ?? 'create';

    $op = [
        'op_id' => $overrides['op_id'] ?? (string) Str::uuid(),
        'entity' => 'patients',
        'entity_id' => $entityId,
        'action' => $action,
        'payload' => $overrides['payload'] ?? [
            'id' => $entityId,
            'org_id' => $orgId,
            'full_name' => 'مريض اختبار',
            'created_at' => now()->toIso8601String(),
        ],
        'created_at' => $overrides['created_at'] ?? now()->toIso8601String(),
    ];

    if ($action !== 'create') {
        $op['base_rev'] = $overrides['base_rev'] ?? 1;
    }

    return $op;
}

/**
 * @return array{op_id: string, entity: string, entity_id: string, action: string, payload: ?array, created_at: string}
 */
function dayStateOp(string $practitionerId, string $locationId, string $date, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();

    return [
        'op_id' => $overrides['op_id'] ?? (string) Str::uuid(),
        'entity' => 'day_state',
        'entity_id' => $entityId,
        'action' => 'create',
        'payload' => $overrides['payload'] ?? [
            'id' => $entityId,
            'practitioner_id' => $practitionerId,
            'location_id' => $locationId,
            'date' => $date,
            'delay_minutes' => $overrides['delay_minutes'] ?? 0,
            'is_closed' => false,
        ],
        'created_at' => $overrides['created_at'] ?? now()->toIso8601String(),
    ];
}

test('an accepted op bumps rev and writes a ledger row and an audit row', function () {
    $credential = makeAuthenticatedDevice();
    $op = patientOp($credential['orgId']);

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => 1]]]);

    $ledgerRow = $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->first();
    expect($ledgerRow)->not->toBeNull();
    expect($ledgerRow->rev)->toBe(1);
    expect($ledgerRow->entity)->toBe('patients');
    expect($ledgerRow->entity_id)->toBe($op['entity_id']);
    expect($ledgerRow->actor_membership_id)->toBe($credential['membershipId']);
    expect($ledgerRow->device_id)->toBe($credential['deviceId']);

    $auditRow = $this->fx()->table('audit_log')->where('entity_id', $op['entity_id'])->first();
    expect($auditRow)->not->toBeNull();
    expect($auditRow->entity)->toBe('patients');
    expect($auditRow->action)->toBe('create');
    expect($auditRow->actor_membership_id)->toBe($credential['membershipId']);

    $patientRow = $this->fx()->table('patients')->where('id', $op['entity_id'])->first();
    expect($patientRow->rev)->toBe(1);

    $this->fx()->table('audit_log')->where('entity_id', $op['entity_id'])->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->delete();
    $this->fx()->table('patients')->where('id', $op['entity_id'])->delete();
});

test('a replayed op_id returns duplicate and does not double-apply', function () {
    $credential = makeAuthenticatedDevice();
    $op = patientOp($credential['orgId']);

    pushOps($credential['token'], [$op])->assertOk();
    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'duplicate']]]);

    expect($this->fx()->table('patients')->where('id', $op['entity_id'])->count())->toBe(1);
    expect($this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->count())->toBe(1);

    $this->fx()->table('audit_log')->where('entity_id', $op['entity_id'])->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->delete();
    $this->fx()->table('patients')->where('id', $op['entity_id'])->delete();
});

test('a stale base_rev is rejected and the row is unchanged', function () {
    $credential = makeAuthenticatedDevice();
    $createOp = patientOp($credential['orgId']);
    pushOps($credential['token'], [$createOp])->assertOk();

    $staleUpdate = patientOp($credential['orgId'], [
        'entity_id' => $createOp['entity_id'],
        'action' => 'update',
        'base_rev' => 99,
        'payload' => ['id' => $createOp['entity_id'], 'org_id' => $credential['orgId'], 'full_name' => 'اسم معدل', 'created_at' => now()->toIso8601String()],
    ]);

    $response = pushOps($credential['token'], [$staleUpdate]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $staleUpdate['op_id'], 'status' => 'rejected', 'reason' => 'conflict_stale_rev']]]);

    $row = $this->fx()->table('patients')->where('id', $createOp['entity_id'])->first();
    expect($row->full_name)->toBe('مريض اختبار');
    expect($row->rev)->toBe(1);

    $this->fx()->table('audit_log')->where('entity_id', $createOp['entity_id'])->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $createOp['op_id'])->delete();
    $this->fx()->table('patients')->where('id', $createOp['entity_id'])->delete();
});

test('two ops for the same slot: the chronologically older wins, proven with arrival order reversed', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $date = now()->addDays(5)->toDateString();

    $older = now()->subMinutes(10)->toIso8601String();
    $newer = now()->subMinute()->toIso8601String();

    $newerOp = dayStateOp($practitionerId, $credential['locationId'], $date, ['created_at' => $newer, 'delay_minutes' => 15]);
    $olderOp = dayStateOp($practitionerId, $credential['locationId'], $date, ['created_at' => $older, 'delay_minutes' => 5]);

    // Reversed arrival: the newer op is pushed FIRST, in its own request,
    // and succeeds (the slot is free). The older op arrives SECOND, in a
    // separate request, and must still win per the brief's rule.
    pushOps($credential['token'], [$newerOp])->assertOk();
    $secondResponse = pushOps($credential['token'], [$olderOp]);

    $secondResponse->assertOk();
    $secondResponse->assertJson(['results' => [['op_id' => $olderOp['op_id'], 'status' => 'accepted']]]);

    // The older op's row now holds the slot, with its own data.
    $winner = $this->fx()->table('day_state')
        ->where('practitioner_id', $practitionerId)
        ->where('location_id', $credential['locationId'])
        ->where('date', $date)
        ->first();
    expect($winner)->not->toBeNull();
    expect($winner->id)->toBe($olderOp['entity_id']);
    expect($winner->delay_minutes)->toBe(5);

    // The newer op's original row is gone — day_state has no "displaced
    // but intact" concept of its own (see SyncOpApplier::evictSlotLoser).
    expect($this->fx()->table('day_state')->where('id', $newerOp['entity_id'])->exists())->toBeFalse();

    $this->fx()->table('audit_log')->whereIn('entity_id', [$newerOp['entity_id'], $olderOp['entity_id']])->delete();
    $this->fx()->table('sync_ledger')->whereIn('op_id', [$newerOp['op_id'], $olderOp['op_id']])->delete();
    $this->fx()->table('day_state')->where('id', $olderOp['entity_id'])->delete();
});

/**
 * The device whose visit gets evicted (SyncOpApplier::evictSlotLoser)
 * already received `accepted` for its own push, truthfully, before the
 * eviction happened in a *later*, unrelated request. That response can't
 * be un-sent. The only mechanism that could tell this device its own row
 * changed is a pull — GET /api/sync/pull does not exist yet
 * (docs/sync-plan.md's Q9 explicitly scopes it out of this step) — so as
 * of today, an evicted device has no way to discover this at all through
 * the API surface. This test exists to keep that gap visible and
 * testable, not to assert it's acceptable. Skipped, not silently omitted:
 * un-skip once GET /api/sync/pull exists, and assert the evicted visit
 * (with its bumped rev, is_overbooked=true, and reassigned position)
 * appears in that device's pull results.
 */
test('the device whose visit was evicted can discover the change via a pull', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $patientId = $this->makePatient($credential['orgId']);
    $date = now()->addDays(5)->toDateString();

    $newerVisitId = (string) Str::uuid();
    $newerOp = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $newerVisitId,
        'action' => 'create',
        'payload' => [
            'id' => $newerVisitId,
            'org_id' => $credential['orgId'],
            'location_id' => $credential['locationId'],
            'practitioner_id' => $practitionerId,
            'patient_id' => $patientId,
            'visit_date' => $date,
            'position' => 1,
            'status' => 'booked',
            'is_overbooked' => false,
            'source' => 'walkin',
            'created_by' => $credential['membershipId'],
            'created_at' => now()->toIso8601String(),
        ],
        'created_at' => now()->subMinute()->toIso8601String(),
    ];

    $olderVisitId = (string) Str::uuid();
    $olderOp = $newerOp;
    $olderOp['op_id'] = (string) Str::uuid();
    $olderOp['entity_id'] = $olderVisitId;
    $olderOp['payload']['id'] = $olderVisitId;
    $olderOp['created_at'] = now()->subMinutes(10)->toIso8601String();

    pushOps($credential['token'], [$newerOp])->assertOk();
    pushOps($credential['token'], [$olderOp])->assertJson(['results' => [['op_id' => $olderOp['op_id'], 'status' => 'accepted']]]);

    // Confirmed, out of band, that the eviction really happened — this is
    // the fact the rest of this test is about the device NOT being able
    // to observe through the API itself.
    $evicted = $this->fx()->table('visits')->where('id', $newerVisitId)->first();
    expect($evicted->is_overbooked)->toBeTrue();
    expect($evicted->rev)->toBe(2);

    $this->fx()->table('audit_log')->whereIn('entity_id', [$newerVisitId, $olderVisitId])->delete();
    $this->fx()->table('sync_ledger')->whereIn('op_id', [$newerOp['op_id'], $olderOp['op_id']])->delete();
    $this->fx()->table('visits')->whereIn('id', [$newerVisitId, $olderVisitId])->delete();
})->skip('No GET /api/sync/pull exists yet (docs/sync-plan.md Q9) — the evicted device currently has no API-level way to discover this change at all, only a direct database query. Un-skip once the pull endpoint exists.');

test('a future-dated created_at on a slot op returns failed', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);

    $op = dayStateOp($practitionerId, $credential['locationId'], now()->addDays(5)->toDateString(), [
        'created_at' => now()->addHour()->toIso8601String(),
    ]);

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'failed', 'reason' => 'future_dated_created_at']]]);
    expect($this->fx()->table('day_state')->where('id', $op['entity_id'])->exists())->toBeFalse();
});

test('a created_at outside the 60-day window on a slot op returns failed', function () {
    $credential = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);

    $op = dayStateOp($practitionerId, $credential['locationId'], now()->addDays(5)->toDateString(), [
        'created_at' => now()->subDays(61)->toIso8601String(),
    ]);

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'failed', 'reason' => 'created_at_outside_window']]]);

    $device = $this->fx()->table('device')->where('id', $credential['deviceId'])->first();
    expect($device->clock_skew_ms)->not->toBeNull();
});

test('an op after a failed op on the same entity_id returns blocked; a different entity is still attempted', function () {
    $credential = makeAuthenticatedDevice();
    $createOp = patientOp($credential['orgId']);
    pushOps($credential['token'], [$createOp])->assertOk();

    $staleUpdate = patientOp($credential['orgId'], [
        'entity_id' => $createOp['entity_id'],
        'action' => 'update',
        'base_rev' => 99,
    ]);
    $laterSameEntity = patientOp($credential['orgId'], [
        'entity_id' => $createOp['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
    ]);
    $otherEntity = patientOp($credential['orgId']);

    $response = pushOps($credential['token'], [$staleUpdate, $laterSameEntity, $otherEntity]);

    $response->assertOk();
    $results = collect($response->json('results'))->keyBy('op_id');
    expect($results[$staleUpdate['op_id']]['status'])->toBe('rejected');
    expect($results[$laterSameEntity['op_id']]['status'])->toBe('blocked');
    expect($results[$otherEntity['op_id']]['status'])->toBe('accepted');

    $this->fx()->table('audit_log')->whereIn('entity_id', [$createOp['entity_id'], $otherEntity['entity_id']])->delete();
    $this->fx()->table('sync_ledger')->whereIn('op_id', [$createOp['op_id'], $otherEntity['op_id']])->delete();
    $this->fx()->table('patients')->whereIn('id', [$createOp['entity_id'], $otherEntity['entity_id']])->delete();
});

test('a payload naming another org is rejected and writes nothing', function () {
    $credential = makeAuthenticatedDevice();
    $otherOrgId = $this->makeOrganization('sync-push-other-org');

    $op = patientOp($credential['orgId'], [
        'payload' => [
            'id' => null, // filled below
            'org_id' => $otherOrgId,
            'full_name' => 'محاولة تسلل',
            'created_at' => now()->toIso8601String(),
        ],
    ]);
    $op['payload']['id'] = $op['entity_id'];

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'failed', 'reason' => 'org_mismatch']]]);
    expect($this->fx()->table('patients')->where('id', $op['entity_id'])->exists())->toBeFalse();
    expect($this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->exists())->toBeFalse();
});

test('audit rows are attributed to the token\'s membership even when the payload claims another', function () {
    $credential = makeAuthenticatedDevice();
    $otherUserId = $this->makeUser();
    $otherMembershipId = $this->makeMembership($otherUserId, $credential['orgId'], ['role' => 'assistant']);

    // patients has no actor column of its own, so use visits' created_by —
    // wired through membership_locations isn't needed here, only that the
    // payload's claimed actor differs from the token's real one.
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $patientId = $this->makePatient($credential['orgId']);
    $visitId = (string) Str::uuid();

    $op = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $visitId,
        'action' => 'create',
        'payload' => [
            'id' => $visitId,
            'org_id' => $credential['orgId'],
            'location_id' => $credential['locationId'],
            'practitioner_id' => $practitionerId,
            'patient_id' => $patientId,
            'visit_date' => now()->addDay()->toDateString(),
            'position' => 1,
            'status' => 'booked',
            'is_overbooked' => false,
            'source' => 'walkin',
            'created_by' => $otherMembershipId,
            'created_at' => now()->toIso8601String(),
        ],
        'created_at' => now()->toIso8601String(),
    ];

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'accepted']]]);

    $visitRow = $this->fx()->table('visits')->where('id', $visitId)->first();
    expect($visitRow->created_by)->toBe($credential['membershipId']);
    expect($visitRow->created_by)->not->toBe($otherMembershipId);

    $auditRow = $this->fx()->table('audit_log')->where('entity_id', $visitId)->first();
    expect($auditRow->actor_membership_id)->toBe($credential['membershipId']);

    $this->fx()->table('audit_log')->where('entity_id', $visitId)->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->delete();
    $this->fx()->table('visits')->where('id', $visitId)->delete();
});

test('no token is 401', function () {
    $op = patientOp((string) Str::uuid());

    $response = $this->postJson('/api/sync/push', ['ops' => [$op]]);

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);
});

test('a malformed batch is 422', function () {
    $credential = makeAuthenticatedDevice();

    $response = $this->withToken($credential['token'])->postJson('/api/sync/push', [
        'ops' => [['entity' => 'not_a_real_table', 'action' => 'sideways']],
    ]);

    $response->assertStatus(422);
});

test('no response body ever contains a SQLSTATE or query text for a clean conflict', function () {
    $credential = makeAuthenticatedDevice();

    // An update with no matching row at all (never created) — the
    // conflict path, resolved without an exception at all.
    $op = patientOp($credential['orgId'], ['action' => 'update', 'base_rev' => 1]);

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $body = $response->getContent();
    expect($body)->not->toMatch('/SQLSTATE/');
    expect($body)->not->toContain('pgsql');
});

test('no response body ever contains a SQLSTATE or query text for a genuine database error', function () {
    $credential = makeAuthenticatedDevice();

    // A visit naming a patient_id that does not exist — a real foreign
    // key violation, an actual QueryException on the actual write, not
    // just a clean "0 rows affected." This is the scenario that used to
    // leak query text before ApplyMembership's own hardening pass found
    // the same failure mode for authentication (api/docs/rls.md).
    $visitId = (string) Str::uuid();
    $op = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $visitId,
        'action' => 'create',
        'payload' => [
            'id' => $visitId,
            'org_id' => $credential['orgId'],
            'location_id' => $credential['locationId'],
            'practitioner_id' => (string) Str::uuid(),
            'patient_id' => (string) Str::uuid(),
            'visit_date' => now()->addDay()->toDateString(),
            'position' => 1,
            'status' => 'booked',
            'is_overbooked' => false,
            'source' => 'walkin',
            'created_by' => $credential['membershipId'],
            'created_at' => now()->toIso8601String(),
        ],
        'created_at' => now()->toIso8601String(),
    ];

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'failed', 'reason' => 'internal_error']]]);

    $body = $response->getContent();
    expect($body)->not->toMatch('/SQLSTATE/');
    expect($body)->not->toMatch('/violates foreign key/i');
    expect($body)->not->toContain('pgsql');
    expect($body)->not->toContain('insert into');

    expect($this->fx()->table('visits')->where('id', $visitId)->exists())->toBeFalse();
});
