<?php

use App\Models\Device;
use Illuminate\Support\Str;

/**
 * GET /api/sync/pull — see App\Http\Controllers\SyncPullController and
 * App\Support\Sync\SyncPuller for the implementation, and
 * docs/sync-plan.md's Q8/Q9 for the decisions being tested.
 */
function pullOps(string $token, ?int $cursor = null)
{
    $query = $cursor === null ? '' : '?cursor='.$cursor;

    return test()->withToken($token)->getJson('/api/sync/pull'.$query);
}

/**
 * A second real, authenticated device — a different user, membership,
 * and device row, but bound to an *existing* org+location rather than
 * generating its own (makeAuthenticatedDevice()'s own behavior). Needed
 * for the same-org, two-device scenario a slot conflict is actually
 * about — two devices racing inside one org, not two different orgs.
 *
 * @return array{token: string, membershipId: string, deviceId: string, userId: string}
 */
function makeSecondAuthenticatedDeviceInSameOrg(string $orgId, string $locationId): array
{
    $test = test();
    $userId = $test->makeUser('auth-user-'.Str::random(6));
    $membershipId = $test->makeMembership($userId, $orgId, ['role' => 'assistant']);
    $deviceId = $test->makeDevice($orgId, $locationId, $membershipId);

    $device = new Device(['id' => $deviceId]);
    $newToken = $device->createToken('test-device', ['membership:'.$membershipId]);

    return [
        'token' => $newToken->plainTextToken,
        'membershipId' => $membershipId,
        'deviceId' => $deviceId,
        'userId' => $userId,
    ];
}

test('a first sync (no cursor) returns every row the org has and a usable cursor', function () {
    $credential = makeAuthenticatedDevice();
    $op = patientOp($credential['orgId']);
    pushOps($credential['token'], [$op])->assertOk();

    $response = pullOps($credential['token']);

    $response->assertOk();
    $rows = $response->json('rows');
    // seq is a single global identity column shared across every org
    // (the same design as audit_log.seq), never reset per org — a brand
    // new org's first row can legitimately have any seq value, not
    // literally 1, once other orgs have pushed anything in this database.
    expect($rows)->toHaveCount(1);
    expect($rows[0]['entity'])->toBe('patients');
    expect($rows[0]['entity_id'])->toBe($op['entity_id']);
    expect($rows[0]['rev'])->toBe(1);
    expect($rows[0]['payload']['full_name'])->toBe('مريض اختبار');
    expect($response->json('has_more'))->toBeFalse();
    expect($response->json('cursor'))->toBe((string) $rows[0]['seq']);

    $this->fx()->table('audit_log')->where('entity_id', $op['entity_id'])->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->delete();
    $this->fx()->table('patients')->where('id', $op['entity_id'])->delete();
});

test('a second call with the returned cursor returns nothing new', function () {
    $credential = makeAuthenticatedDevice();
    $op = patientOp($credential['orgId']);
    pushOps($credential['token'], [$op])->assertOk();

    $first = pullOps($credential['token']);
    $cursor = (int) $first->json('cursor');

    $second = pullOps($credential['token'], $cursor);

    $second->assertOk();
    $second->assertJson(['rows' => [], 'has_more' => false, 'cursor' => (string) $cursor]);

    $this->fx()->table('audit_log')->where('entity_id', $op['entity_id'])->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->delete();
    $this->fx()->table('patients')->where('id', $op['entity_id'])->delete();
});

test('org isolation through the HTTP layer: a token from org A never sees org B rows, including with a forged cursor', function () {
    $credentialA = makeAuthenticatedDevice();
    $opA = patientOp($credentialA['orgId']);
    pushOps($credentialA['token'], [$opA])->assertOk();

    $credentialB = makeAuthenticatedDevice();
    $opB = patientOp($credentialB['orgId']);
    pushOps($credentialB['token'], [$opB])->assertOk();

    // A's own pull sees only A's row.
    $responseA = pullOps($credentialA['token']);
    $responseA->assertOk();
    $rowsA = collect($responseA->json('rows'));
    expect($rowsA->pluck('entity_id')->all())->toBe([$opA['entity_id']]);

    // B's cursor is a real seq — just not one A has any business reading
    // past. currentMaxSeq() is itself RLS-scoped to the caller, so A's own
    // visible max can legitimately sit *below* B's cursor once B has
    // pushed later than A — the controller then correctly refuses it as
    // invalid (422) rather than silently answering "nothing new". Either
    // a 422 or a 200-with-no-rows is an acceptable shape here; what must
    // never happen, under either shape, is B's row reaching A's response.
    $cursorFromB = (int) pullOps($credentialB['token'])->json('cursor');
    $responseWithBorrowedCursor = pullOps($credentialA['token'], $cursorFromB);
    expect($responseWithBorrowedCursor->status())->toBeIn([200, 422]);
    if ($responseWithBorrowedCursor->status() === 200) {
        expect($responseWithBorrowedCursor->json('rows'))->toBe([]);
    }
    expect($responseWithBorrowedCursor->getContent())->not->toContain($opB['entity_id']);

    $this->fx()->table('audit_log')->whereIn('entity_id', [$opA['entity_id'], $opB['entity_id']])->delete();
    $this->fx()->table('sync_ledger')->whereIn('op_id', [$opA['op_id'], $opB['op_id']])->delete();
    $this->fx()->table('patients')->whereIn('id', [$opA['entity_id'], $opB['entity_id']])->delete();
});

test('a cursor from the future is rejected with a clean 422, never a 500', function () {
    $credential = makeAuthenticatedDevice();

    $response = pullOps($credential['token'], 999999999);

    $response->assertStatus(422);
    $response->assertJson(['error' => 'invalid_cursor']);
});

test('a negative cursor is rejected with a clean 422', function () {
    $credential = makeAuthenticatedDevice();

    $response = $this->withToken($credential['token'])->getJson('/api/sync/pull?cursor=-1');

    $response->assertStatus(422);
});

test('a malformed cursor is rejected with a clean 422', function () {
    $credential = makeAuthenticatedDevice();

    $response = $this->withToken($credential['token'])->getJson('/api/sync/pull?cursor=not-a-number');

    $response->assertStatus(422);
});

test('pagination: more rows than the cap returns exactly the cap plus has_more, and continuing reaches the end with no gaps or repeats', function () {
    $credential = makeAuthenticatedDevice();

    $opIds = [];
    for ($i = 0; $i < 210; $i++) {
        $opIds[] = $this->makeSyncLedgerRow($credential['orgId'], $credential['membershipId'], $credential['deviceId'], [
            'entity_id' => (string) Str::uuid(),
        ]);
    }

    $firstPage = pullOps($credential['token']);
    $firstPage->assertOk();
    expect($firstPage->json('rows'))->toHaveCount(200);
    expect($firstPage->json('has_more'))->toBeTrue();

    $cursor = (int) $firstPage->json('cursor');
    $secondPage = pullOps($credential['token'], $cursor);
    $secondPage->assertOk();
    expect($secondPage->json('rows'))->toHaveCount(10);
    expect($secondPage->json('has_more'))->toBeFalse();

    $allSeqs = collect($firstPage->json('rows'))->pluck('seq')
        ->merge(collect($secondPage->json('rows'))->pluck('seq'));

    expect($allSeqs)->toHaveCount(210);
    expect($allSeqs->unique())->toHaveCount(210, 'no seq should repeat across pages');
    expect($allSeqs->min())->toBe($allSeqs->max() - 209, 'no gap across the full continuous range');

    $this->fx()->table('sync_ledger')->whereIn('op_id', $opIds)->delete();
});

/**
 * The scenario this endpoint exists for. Device A books a slot; device B
 * (offline, unaware) tries the same slot and is rejected; device B pulls
 * and receives A's visit — this is how the losing assistant actually
 * learns her booking failed, not a server-side rewrite of anyone's row
 * (api/docs/rls.md's "The sync endpoint is accept-or-reject only").
 */
test('device A books a slot, device B is rejected, device B pulls and receives A\'s visit', function () {
    $credentialA = makeAuthenticatedDevice();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credentialA['orgId'], $specialtyId);
    $patientId = $this->makePatient($credentialA['orgId']);
    $date = now()->addDays(3)->toDateString();

    $visitId = (string) Str::uuid();
    $visitOp = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $visitId,
        'action' => 'create',
        'payload' => [
            'id' => $visitId,
            'org_id' => $credentialA['orgId'],
            'location_id' => $credentialA['locationId'],
            'practitioner_id' => $practitionerId,
            'patient_id' => $patientId,
            'visit_date' => $date,
            'position' => 1,
            'status' => 'booked',
            'is_overbooked' => false,
            'source' => 'walkin',
            'created_by' => $credentialA['membershipId'],
            'created_at' => now()->toIso8601String(),
        ],
        'created_at' => now()->toIso8601String(),
    ];

    pushOps($credentialA['token'], [$visitOp])->assertJson(['results' => [['op_id' => $visitOp['op_id'], 'status' => 'accepted']]]);

    // Device B: a different device, same org, same slot — offline when A
    // booked, so it has no idea the slot is taken.
    $credentialB = makeSecondAuthenticatedDeviceInSameOrg($credentialA['orgId'], $credentialA['locationId']);
    $otherPatientId = $this->makePatient($credentialA['orgId']);

    $conflictingVisitId = (string) Str::uuid();
    $conflictingOp = $visitOp;
    $conflictingOp['op_id'] = (string) Str::uuid();
    $conflictingOp['entity_id'] = $conflictingVisitId;
    $conflictingOp['payload']['id'] = $conflictingVisitId;
    $conflictingOp['payload']['patient_id'] = $otherPatientId;
    $conflictingOp['payload']['created_by'] = $credentialB['membershipId'];

    $rejection = pushOps($credentialB['token'], [$conflictingOp]);
    $rejection->assertJson(['results' => [['op_id' => $conflictingOp['op_id'], 'status' => 'rejected', 'reason' => 'conflict_slot_taken']]]);

    // B pulls — and learns about A's visit, the one that actually holds
    // the slot. This is the discoverability the removed eviction design
    // never had: nothing was rewritten, B simply asks what changed.
    $pullResponse = pullOps($credentialB['token']);
    $pullResponse->assertOk();

    $rows = collect($pullResponse->json('rows'));
    $visitRow = $rows->firstWhere('entity_id', $visitId);
    expect($visitRow)->not->toBeNull('device B must see device A\'s accepted visit via pull');
    expect($visitRow['payload']['status'])->toBe('booked');
    expect($visitRow['payload']['patient_id'])->toBe($patientId);

    // B's own rejected attempt never became a row at all — nothing to see.
    expect($rows->firstWhere('entity_id', $conflictingVisitId))->toBeNull();

    $this->fx()->table('audit_log')->where('entity_id', $visitId)->delete();
    $this->fx()->table('sync_ledger')->where('op_id', $visitOp['op_id'])->delete();
    $this->fx()->table('visits')->where('id', $visitId)->delete();
});

test('no pull response body contains a SQLSTATE, query text, or any internal detail', function () {
    $credential = makeAuthenticatedDevice();

    $response = pullOps($credential['token'], -5);
    $body = $response->getContent();
    expect($body)->not->toMatch('/SQLSTATE/');
    expect($body)->not->toContain('pgsql');
    expect($body)->not->toContain('select ');
});
