<?php

use Illuminate\Support\Str;

/**
 * visits.note (2026_09_12_000023_add_note_to_visits_table.php) syncs like
 * every other visit field: SyncOpApplier merges the payload as-is and
 * SyncPuller/SyncBootstrapPuller return whole rows, so nothing in the sync
 * code names it. These tests prove that end to end, plus that the
 * existing visits policy keeps it out of another org's reach.
 *
 * @return array{op_id: string, entity: string, entity_id: string, action: string, payload: array, created_at: string, base_rev?: int}
 */
function visitNoteOp(array $credential, string $practitionerId, string $patientId, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();
    $action = $overrides['action'] ?? 'create';

    $op = [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $entityId,
        'action' => $action,
        'payload' => array_merge([
            'id' => $entityId,
            'org_id' => $credential['orgId'],
            'location_id' => $credential['locationId'],
            'practitioner_id' => $practitionerId,
            'patient_id' => $patientId,
            'visit_date' => now()->addDays(2)->toDateString(),
            'position' => 1,
            'status' => 'booked',
            'is_overbooked' => false,
            'source' => 'walkin',
            'created_by' => $credential['membershipId'],
            'created_at' => now()->toIso8601String(),
            'note' => null,
        ], $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ];

    if ($action !== 'create') {
        $op['base_rev'] = $overrides['base_rev'] ?? 1;
    }

    return $op;
}

/**
 * @return array{credential: array, practitionerId: string, patientId: string}
 */
function visitNoteFixture(): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();
    $specialtyId = $test->makeSpecialtyTemplate(null);

    return [
        'credential' => $credential,
        'practitionerId' => $test->makePractitioner($credential['orgId'], $specialtyId),
        'patientId' => $test->makePatient($credential['orgId']),
    ];
}

function cleanupVisitNoteOps(string $visitId, array $opIds): void
{
    $fx = test()->fx();
    $fx->table('audit_log')->where('entity_id', $visitId)->delete();
    $fx->table('sync_ledger')->whereIn('op_id', $opIds)->delete();
    $fx->table('visits')->where('id', $visitId)->delete();
}

test('a pushed visit create carrying a note is accepted and stored', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'patientId' => $patientId] = visitNoteFixture();
    $op = visitNoteOp($credential, $practitionerId, $patientId, ['payload' => ['note' => 'ضغط مرتفع، متابعة بعد أسبوع']]);

    $response = pushOps($credential['token'], [$op]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => 1]]]);
    $row = $this->fx()->table('visits')->where('id', $op['entity_id'])->first();
    expect($row->note)->toBe('ضغط مرتفع، متابعة بعد أسبوع');

    cleanupVisitNoteOps($op['entity_id'], [$op['op_id']]);
});

test('an update that only changes the note is accepted and bumps rev', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'patientId' => $patientId] = visitNoteFixture();
    $create = visitNoteOp($credential, $practitionerId, $patientId);
    pushOps($credential['token'], [$create])->assertJson(['results' => [['status' => 'accepted', 'rev' => 1]]]);

    $update = visitNoteOp($credential, $practitionerId, $patientId, [
        'entity_id' => $create['entity_id'],
        'action' => 'update',
        'base_rev' => 1,
        'payload' => array_merge($create['payload'], ['note' => 'تحليل دم قبل الزيارة الجاية']),
    ]);

    $response = pushOps($credential['token'], [$update]);

    $response->assertOk();
    $response->assertJson(['results' => [['op_id' => $update['op_id'], 'status' => 'accepted', 'rev' => 2]]]);
    $row = $this->fx()->table('visits')->where('id', $create['entity_id'])->first();
    expect($row->note)->toBe('تحليل دم قبل الزيارة الجاية');
    expect($row->rev)->toBe(2);
    // Nothing else about the visit moved.
    expect($row->status)->toBe('booked');
    expect($row->position)->toBe(1);

    cleanupVisitNoteOps($create['entity_id'], [$create['op_id'], $update['op_id']]);
});

test('pull and bootstrap both return the note', function () {
    ['credential' => $credential, 'practitionerId' => $practitionerId, 'patientId' => $patientId] = visitNoteFixture();
    $op = visitNoteOp($credential, $practitionerId, $patientId, ['payload' => ['note' => 'حساسية بنسلين']]);
    pushOps($credential['token'], [$op])->assertJson(['results' => [['status' => 'accepted']]]);

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'))->firstWhere('entity_id', $op['entity_id']);
    expect($pulled)->not->toBeNull();
    expect($pulled['payload']['note'])->toBe('حساسية بنسلين');

    $bootstrapped = collect(drainBootstrap($credential['token']))->firstWhere('entity_id', $op['entity_id']);
    expect($bootstrapped)->not->toBeNull();
    expect($bootstrapped['payload']['note'])->toBe('حساسية بنسلين');

    cleanupVisitNoteOps($op['entity_id'], [$op['op_id']]);
});

test('a second org\'s membership cannot read the note', function () {
    ['credential' => $credentialA, 'practitionerId' => $practitionerId, 'patientId' => $patientId] = visitNoteFixture();
    $note = 'ملاحظة خاصة بالعيادة أ';
    $op = visitNoteOp($credentialA, $practitionerId, $patientId, ['payload' => ['note' => $note]]);
    pushOps($credentialA['token'], [$op])->assertJson(['results' => [['status' => 'accepted']]]);

    $credentialB = makeAuthenticatedDevice();

    // Through the sync endpoints: neither pull nor bootstrap ever carries it.
    $pullB = pullOps($credentialB['token'])->assertOk();
    expect($pullB->getContent())->not->toContain($op['entity_id']);
    expect($pullB->getContent())->not->toContain($note);
    $bootstrapB = collect(drainBootstrap($credentialB['token']));
    expect($bootstrapB->firstWhere('entity_id', $op['entity_id']))->toBeNull();

    // And directly against the table, as org B's membership on the ordinary
    // RLS-bound connection: the row, and so its note, does not exist for it.
    $this->withMembership($this->asApp(), $credentialB['membershipId'], function ($db) use ($op) {
        expect($db->table('visits')->where('id', $op['entity_id'])->value('note'))->toBeNull();
        expect($db->table('visits')->where('id', $op['entity_id'])->exists())->toBeFalse();
    });

    // Sanity: the same read as org A's own membership does see it.
    $this->withMembership($this->asApp(), $credentialA['membershipId'], function ($db) use ($op, $note) {
        expect($db->table('visits')->where('id', $op['entity_id'])->value('note'))->toBe($note);
    });

    cleanupVisitNoteOps($op['entity_id'], [$op['op_id']]);
});
