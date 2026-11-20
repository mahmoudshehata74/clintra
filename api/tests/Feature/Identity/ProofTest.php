<?php

use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\IdentityHarness;
use Tests\Support\TestKey;

/**
 * Proofs once an organization is enforced (docs/design-identity-permissions.md,
 * 3.4 to 3.6): the device proof on every request, the person proof on every
 * op and device audit row, and the op applied as the person who proved it.
 * Until an organization is enforced none of it is read.
 */

/** @return array<string, mixed> a patient create, or an update when $baseRev is given */
function provenPatientOp(array $org, array $overrides = [], ?int $baseRev = null): array
{
    $id = $overrides['entity_id'] ?? (string) Str::uuid();
    $op = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'patients',
        'entity_id' => $id,
        'action' => $baseRev === null ? 'create' : 'update',
        'payload' => ['id' => $id, 'org_id' => $org['orgId'], 'full_name' => 'مريض موقّع', 'created_at' => '2026-11-19T08:00:00.000Z'],
        'created_at' => '2026-11-19T08:00:00.000Z',
    ];
    if ($baseRev !== null) {
        $op['base_rev'] = $baseRev;
    }

    return array_replace($op, $overrides);
}

function pushSigned(array $org, array $ops): TestResponse
{
    return IdentityHarness::send($org, 'POST', '/api/sync/push', ['ops' => $ops]);
}

function enforcedPatient(array $org): string
{
    $id = test()->makePatient($org['orgId'], 'patient');

    return $id;
}

test('an enforced organization answers only a request with a fresh, unreplayed device proof of the device key', function () {
    $org = IdentityHarness::org(enforced: true);
    $uri = '/api/sync/pull';
    $get = fn (array $headers) => IdentityHarness::send($org, 'GET', $uri, [], headers: $headers);

    $get(['X-Clintra-Device-Proof' => ''])->assertStatus(401)->assertExactJson(['error' => 'unauthenticated', 'message' => 'يجب تسجيل الدخول']);
    $get(['X-Clintra-Device-Proof' => 'v1.garbage'])->assertStatus(401);
    $get(['X-Clintra-Device-Proof' => IdentityHarness::deviceProof($org['deviceKey'], 'GET', $uri, '[]', now()->getTimestampMs() - 301000)])->assertStatus(401);
    $get(['X-Clintra-Device-Proof' => IdentityHarness::deviceProof($org['deviceKey'], 'GET', $uri, '[]', now()->getTimestampMs() + 301000)])->assertStatus(401);
    $get(['X-Clintra-Device-Proof' => IdentityHarness::deviceProof(TestKey::make(), 'GET', $uri, '[]')])->assertStatus(401);
    $get(['X-Clintra-Device-Proof' => IdentityHarness::deviceProof($org['deviceKey'], 'GET', '/api/sync/pull?cursor=0', '[]')])->assertStatus(401);
    $get(['X-Clintra-Device-Proof' => IdentityHarness::deviceProof($org['deviceKey'], 'POST', $uri, '[]')])->assertStatus(401);

    $proof = IdentityHarness::deviceProof($org['deviceKey'], 'GET', $uri, '[]', now()->getTimestampMs() - 290000);
    $get(['X-Clintra-Device-Proof' => $proof])->assertOk();
    // The same nonce again within ten minutes: a replay.
    $get(['X-Clintra-Device-Proof' => $proof])->assertStatus(401);
});

test('an enforced organization refuses a device with no bound key, and a body other than the one signed', function () {
    $unbound = IdentityHarness::org(enforced: true, bindDeviceKey: false);
    IdentityHarness::send($unbound, 'GET', '/api/sync/pull', headers: [
        'X-Clintra-Device-Proof' => IdentityHarness::deviceProof(TestKey::make(), 'GET', '/api/sync/pull', '[]'),
    ])->assertStatus(401);

    $org = IdentityHarness::org(enforced: true);
    $signedOver = json_encode(['ops' => []]);
    IdentityHarness::send($org, 'POST', '/api/sync/push', ['ops' => [provenPatientOp($org)]], headers: [
        'X-Clintra-Device-Proof' => IdentityHarness::deviceProof($org['deviceKey'], 'POST', '/api/sync/push', $signedOver),
    ])->assertStatus(401);
});

test('until an organization is enforced, no proof header is read and unsigned ops apply as before', function () {
    $org = IdentityHarness::org();
    $op = provenPatientOp($org, ['credential_id' => 'not-a-uuid', 'proof' => 'garbage']);

    IdentityHarness::send($org, 'GET', '/api/sync/pull', headers: ['X-Clintra-Device-Proof' => 'v1.garbage'])->assertOk();
    $response = IdentityHarness::send($org, 'POST', '/api/sync/push', ['ops' => [$op]], headers: ['X-Clintra-Device-Proof' => 'v1.garbage']);

    expect($response->assertOk()->json('results.0.status'))->toBe('accepted');
    $ledger = $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->first();
    expect([$ledger->actor_membership_id, $ledger->credential_id, $ledger->proof])->toBe([$org['ownerId'], null, null]);
});

test('an enforced pull carries each membership\'s username and permissions', function () {
    $org = IdentityHarness::org(enforced: true);
    $memberId = IdentityHarness::member($org, 'assistant', ['reports.view', 'cash.close'], 'mona');
    $this->makeSyncLedgerRow($org['orgId'], $org['ownerId'], $org['deviceId'], ['entity' => 'memberships', 'entity_id' => $memberId]);

    $row = collect(IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk()->json('rows'))->firstWhere('entity_id', $memberId);

    expect($row['payload'])->toMatchArray(['username' => 'mona', 'permissions' => ['reports.view', 'cash.close']]);
});

test('a proven op applies as its person: the ledger keeps the credential and proof, the audit log names the person', function () {
    $org = IdentityHarness::org(enforced: true);
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona');
    $credential = IdentityHarness::credential($org, $memberId);
    $op = IdentityHarness::signOp($org, provenPatientOp($org), $credential);

    $response = pushSigned($org, [$op]);

    expect($response->assertOk()->json('results.0'))->toMatchArray(['status' => 'accepted', 'rev' => 1]);
    $ledger = $this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->first();
    expect([$ledger->actor_membership_id, $ledger->credential_id, $ledger->proof, $ledger->device_id])
        ->toBe([$memberId, $credential['id'], $op['proof'], $org['deviceId']]);
    expect($this->fx()->table('audit_log')->where('entity_id', $op['entity_id'])->value('actor_membership_id'))->toBe($memberId);

    // The same op again is the op already applied.
    expect(pushSigned($org, [$op])->json('results.0.status'))->toBe('duplicate');
});

test('a proof is over every field: a changed byte anywhere is proof_invalid, and nothing is written', function () {
    $org = IdentityHarness::org(enforced: true);
    $credential = IdentityHarness::credential($org, $org['ownerId']);
    $patientId = enforcedPatient($org);

    $create = IdentityHarness::signOp($org, provenPatientOp($org), $credential);
    $update = IdentityHarness::signOp($org, provenPatientOp($org, ['entity_id' => $patientId, 'payload' => [
        'id' => $patientId, 'org_id' => $org['orgId'], 'full_name' => 'renamed', 'created_at' => '2026-11-19T08:00:00.000Z',
    ]], 1), $credential);

    $tampered = [
        'payload' => [...$create, 'payload' => [...$create['payload'], 'full_name' => 'مريض موقّع.']],
        'op_id' => [...$create, 'op_id' => (string) Str::uuid()],
        'entity_id' => [...$create, 'entity_id' => (string) Str::uuid()],
        'created_at' => [...$create, 'created_at' => '2026-11-19T08:00:00.001Z'],
        'base_rev' => [...$update, 'base_rev' => 2],
        'group_id' => [...$update, 'group_id' => (string) Str::uuid()],
        'credential_id' => [...$create, 'credential_id' => IdentityHarness::credential($org, IdentityHarness::member($org))['id']],
    ];

    foreach ($tampered as $field => $op) {
        $result = pushSigned($org, [$op])->assertOk()->json('results.0');
        expect($result)->toBe(['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'proof_invalid'], $field);
        expect($this->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->exists())->toBeFalse($field);
    }
    expect($this->fx()->table('patients')->where('id', $patientId)->value('full_name'))->toBe('patient');
});

test('no proof is proof_missing; another device\'s, a revoked or another organization\'s credential is proof_invalid', function () {
    $org = IdentityHarness::org(enforced: true);
    $other = IdentityHarness::org(enforced: true);
    $elsewhere = $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);
    $foreignDevice = IdentityHarness::credential($org, $org['ownerId'], $elsewhere);
    $revoked = IdentityHarness::credential($org, IdentityHarness::member($org));
    $this->fx()->table('member_credentials')->where('id', $revoked['id'])->update(['revoked_at' => now()->toIso8601String(), 'revoke_reason' => 'owner_revoked']);
    $otherOrg = IdentityHarness::credential($other, $other['ownerId']);

    expect(pushSigned($org, [provenPatientOp($org)])->json('results.0.reason'))->toBe('proof_missing');
    expect(pushSigned($org, [[...provenPatientOp($org), 'credential_id' => $revoked['id']]])->json('results.0.reason'))->toBe('proof_missing');
    foreach (['another device' => $foreignDevice, 'revoked' => $revoked, 'another organization' => $otherOrg] as $case => $credential) {
        $op = IdentityHarness::signOp($org, provenPatientOp($org), $credential);
        expect(pushSigned($org, [$op])->json('results.0.reason'))->toBe('proof_invalid', $case);
    }
    expect($this->fx()->table('patients')->where('org_id', $org['orgId'])->count())->toBe(0);
});

test('a person deactivated before their queued ops arrive: actor_deactivated, later ops on the entity blocked', function () {
    $org = IdentityHarness::org(enforced: true);
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona');
    $mona = IdentityHarness::credential($org, $memberId);
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $create = IdentityHarness::signOp($org, provenPatientOp($org), $mona);
    $update = IdentityHarness::signOp($org, provenPatientOp($org, ['entity_id' => $create['entity_id']], 1), $mona);
    $ownerOp = IdentityHarness::signOp($org, provenPatientOp($org), $owner);

    // Signed while she was active; deactivated before the push arrives.
    $this->fx()->table('memberships')->where('id', $memberId)->update(['is_active' => false]);
    $results = pushSigned($org, [$create, $update, $ownerOp])->assertOk()->json('results');

    expect($results)->toBe([
        ['op_id' => $create['op_id'], 'status' => 'rejected', 'reason' => 'actor_deactivated'],
        ['op_id' => $update['op_id'], 'status' => 'blocked'],
        ['op_id' => $ownerOp['op_id'], 'status' => 'accepted', 'rev' => 1],
    ]);
    expect($this->fx()->table('patients')->where('id', $create['entity_id'])->exists())->toBeFalse();
});

test('an actor column naming anyone but the proven person is actor_mismatch; an empty one is filled with them', function () {
    $org = IdentityHarness::org(enforced: true);
    $memberId = IdentityHarness::member($org, 'assistant', ['cash.close'], 'mona');
    $credential = IdentityHarness::credential($org, $memberId);
    $close = function (?string $closedBy, string $date) use ($org): array {
        $id = (string) Str::uuid();

        return [
            'op_id' => (string) Str::uuid(), 'entity' => 'cash_close', 'entity_id' => $id, 'action' => 'create',
            'payload' => [
                'id' => $id, 'location_id' => $org['locationId'], 'date' => $date, 'opening_amount' => 0, 'total_expected' => 100,
                'total_collected' => 100, 'difference' => 0, 'difference_note' => null, 'closed_by' => $closedBy,
                'closed_at' => '2026-11-19T18:00:00.000Z',
            ],
            'created_at' => '2026-11-19T18:00:00.000Z',
        ];
    };

    $mismatch = IdentityHarness::signOp($org, $close($org['ownerId'], '2026-11-18'), $credential);
    expect(pushSigned($org, [$mismatch])->json('results.0.reason'))->toBe('actor_mismatch');

    $own = IdentityHarness::signOp($org, $close(null, '2026-11-19'), $credential);
    expect(pushSigned($org, [$own])->json('results.0.status'))->toBe('accepted');
    expect($this->fx()->table('cash_close')->where('id', $own['entity_id'])->value('closed_by'))->toBe($memberId);
});

test('a group is proven by one credential: signed by two, it is refused whole', function () {
    $org = IdentityHarness::org(enforced: true);
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $mona = IdentityHarness::credential($org, IdentityHarness::member($org, 'assistant', [], 'mona'));
    $groupId = (string) Str::uuid();
    $first = IdentityHarness::signOp($org, provenPatientOp($org, ['group_id' => $groupId]), $owner);
    $second = IdentityHarness::signOp($org, provenPatientOp($org, ['group_id' => $groupId]), $mona);
    $third = IdentityHarness::signOp($org, provenPatientOp($org, ['group_id' => $groupId]), $owner);

    expect(pushSigned($org, [$first, $second, $third])->json('results'))->toBe([
        ['op_id' => $first['op_id'], 'status' => 'rejected', 'reason' => 'group_rejected'],
        ['op_id' => $second['op_id'], 'status' => 'rejected', 'reason' => 'proof_invalid'],
        ['op_id' => $third['op_id'], 'status' => 'rejected', 'reason' => 'group_rejected'],
    ]);
    expect($this->fx()->table('patients')->where('org_id', $org['orgId'])->count())->toBe(0);

    // One credential: the group applies.
    $ops = array_map(fn () => IdentityHarness::signOp($org, provenPatientOp($org, ['group_id' => $groupId]), $owner), [1, 2]);
    expect(collect(pushSigned($org, $ops)->json('results'))->pluck('status')->all())->toBe(['accepted', 'accepted']);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', array_column($ops, 'op_id'))->pluck('proof')->all())
        ->toEqualCanonicalizing(array_column($ops, 'proof'));
});

test('RLS evaluates for the proven person: an assistant of one branch cannot write another from the owner\'s device', function () {
    $org = IdentityHarness::org(enforced: true);
    $branchB = $this->makeLocation($org['orgId'], 'branch B');
    $specialty = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($org['orgId'], $specialty);
    $assistantId = IdentityHarness::member($org, 'assistant', [], 'mona', overrides: ['location_scope' => 'listed']);
    $this->makeMembershipLocation($assistantId, $org['locationId']);
    $assistant = IdentityHarness::credential($org, $assistantId);
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $dayState = function () use ($practitionerId, $branchB): array {
        $id = (string) Str::uuid();

        return [
            'op_id' => (string) Str::uuid(), 'entity' => 'day_state', 'entity_id' => $id, 'action' => 'create',
            'payload' => ['id' => $id, 'practitioner_id' => $practitionerId, 'location_id' => $branchB, 'date' => now()->toDateString(),
                'delay_minutes' => 10, 'is_closed' => false, 'avg_consult_minutes' => null],
            'created_at' => now()->toIso8601String(),
        ];
    };

    $refused = IdentityHarness::signOp($org, $dayState(), $assistant);
    // RLS's WITH CHECK refusal, surfacing as every RLS refusal of a push
    // does (SyncableTables::DIRECT_ORG_ID_TABLES): the same op signed by the
    // owner below is accepted, so the person is the only difference.
    expect(pushSigned($org, [$refused])->json('results.0'))->toBe(['op_id' => $refused['op_id'], 'status' => 'failed', 'reason' => 'internal_error']);
    expect($this->fx()->table('day_state')->where('id', $refused['entity_id'])->exists())->toBeFalse();

    $accepted = IdentityHarness::signOp($org, $dayState(), $owner);
    expect(pushSigned($org, [$accepted])->json('results.0.status'))->toBe('accepted');
    $this->fx()->table('day_state')->where('id', $accepted['entity_id'])->delete();
});

test('a device audit row is proven like an op: missing, invalid, deactivated and mismatched actors refused; the evidence kept', function () {
    $org = IdentityHarness::org(enforced: true);
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona');
    $credential = IdentityHarness::credential($org, $memberId);
    $row = fn (string $actor) => [
        'id' => (string) Str::uuid(), 'org_id' => $org['orgId'], 'location_id' => null, 'practitioner_id' => null,
        'actor_membership_id' => $actor, 'entity' => 'patients', 'entity_id' => (string) Str::uuid(), 'action' => 'create',
        'before' => null, 'after' => ['full_name' => 'مريض'], 'at' => '2026-11-19T08:00:00.000Z',
    ];
    $push = fn (array $rows) => IdentityHarness::send($org, 'POST', '/api/audit/push', ['rows' => $rows])->assertOk()->json('results');

    $good = IdentityHarness::signAuditRow($org, $row($memberId), $credential);
    $tampered = [...IdentityHarness::signAuditRow($org, $row($memberId), $credential), 'after' => ['full_name' => 'غيره']];
    $mismatch = IdentityHarness::signAuditRow($org, $row($org['ownerId']), $credential);
    $missing = $row($memberId);

    expect(collect($push([$good, $tampered, $mismatch, $missing]))->map(fn ($r) => $r['reason'] ?? $r['status'])->all())
        ->toBe(['accepted', 'proof_invalid', 'actor_mismatch', 'proof_missing']);
    $stored = $this->fx()->table('device_audit_log')->where('id', $good['id'])->first();
    expect([$stored->credential_id, $stored->proof, $stored->pushed_by_membership_id])->toBe([$credential['id'], $good['proof'], $org['ownerId']]);

    $late = IdentityHarness::signAuditRow($org, $row($memberId), $credential);
    $this->fx()->table('memberships')->where('id', $memberId)->update(['is_active' => false]);
    expect($push([$late])[0]['reason'])->toBe('actor_deactivated');
});

test('an unenforced audit push stores no evidence and reads no proof', function () {
    $org = IdentityHarness::org();
    $row = [
        'id' => (string) Str::uuid(), 'org_id' => $org['orgId'], 'location_id' => null, 'practitioner_id' => null,
        'actor_membership_id' => $org['ownerId'], 'entity' => 'patients', 'entity_id' => (string) Str::uuid(), 'action' => 'create',
        'before' => null, 'after' => ['full_name' => 'مريض'], 'at' => '2026-11-19T08:00:00.000Z', 'credential_id' => 'x', 'proof' => 'y',
    ];

    expect(IdentityHarness::send($org, 'POST', '/api/audit/push', ['rows' => [$row]])->json('results.0.status'))->toBe('accepted');
    $stored = $this->fx()->table('device_audit_log')->where('id', $row['id'])->first();
    expect([$stored->credential_id, $stored->proof])->toBe([null, null]);
});
