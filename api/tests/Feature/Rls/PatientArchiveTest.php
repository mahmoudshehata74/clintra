<?php

use Illuminate\Support\Str;

/**
 * patients.archived_at (docs/schema.md's v25 additions,
 * 2026_09_12_000037_add_archived_at_to_patients.php): a nullable
 * timestamptz, synced with the rest of the row, inside the patients
 * policy like every other column.
 */
function archiveOp(string $patientId, string $orgId, ?string $archivedAt, int $baseRev = 1): array
{
    return [
        'op_id' => (string) Str::uuid(),
        'entity' => 'patients',
        'entity_id' => $patientId,
        'action' => 'update',
        'base_rev' => $baseRev,
        'payload' => [
            'id' => $patientId,
            'org_id' => $orgId,
            'full_name' => 'patient',
            'archived_at' => $archivedAt,
            'created_at' => now()->toIso8601String(),
        ],
        'created_at' => now()->toIso8601String(),
    ];
}

function forgetPatientOps(array $opIds, string $patientId): void
{
    $fx = test()->fx();
    $fx->table('audit_log')->where('entity_id', $patientId)->delete();
    $fx->table('sync_ledger')->whereIn('op_id', $opIds)->delete();
}

test('archived_at is a nullable timestamptz with no default', function () {
    $column = $this->asOwner()->selectOne(<<<'SQL'
        SELECT data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'patients' AND column_name = 'archived_at'
    SQL);

    expect($column->data_type)->toBe('timestamp with time zone');
    expect($column->is_nullable)->toBe('YES');
    expect($column->column_default)->toBeNull();
});

test('a patient made before archiving existed reads not archived', function () {
    $orgId = $this->makeOrganization('archive-existing');
    $patientId = $this->makePatient($orgId);

    expect($this->fx()->table('patients')->where('id', $patientId)->value('archived_at'))->toBeNull();
});

test('archiving and restoring round-trip through push and pull', function () {
    $credential = makeAuthenticatedDevice();
    $patientId = $this->makePatient($credential['orgId']);
    $archivedAt = '2026-11-18T10:15:00.000Z';

    $archive = archiveOp($patientId, $credential['orgId'], $archivedAt);
    pushOps($credential['token'], [$archive])->assertOk()
        ->assertJson(['results' => [['op_id' => $archive['op_id'], 'status' => 'accepted', 'rev' => 2]]]);

    $pulled = collect(pullOps($credential['token'])->assertOk()->json('rows'))
        ->where('entity_id', $patientId)->last();
    expect($pulled['payload']['archived_at'])->toBe($archivedAt);

    $restore = archiveOp($patientId, $credential['orgId'], null, baseRev: 2);
    pushOps($credential['token'], [$restore])->assertOk()
        ->assertJson(['results' => [['op_id' => $restore['op_id'], 'status' => 'accepted', 'rev' => 3]]]);
    expect($this->fx()->table('patients')->where('id', $patientId)->value('archived_at'))->toBeNull();

    forgetPatientOps([$archive['op_id'], $restore['op_id']], $patientId);
});

test('an update that leaves archived_at out keeps it', function () {
    $credential = makeAuthenticatedDevice();
    $patientId = $this->makePatient($credential['orgId']);
    $archive = archiveOp($patientId, $credential['orgId'], '2026-11-18T10:15:00.000Z');
    pushOps($credential['token'], [$archive])->assertOk();

    // A device not yet updated sends the row without the column.
    $rename = archiveOp($patientId, $credential['orgId'], null, baseRev: 2);
    unset($rename['payload']['archived_at']);
    $rename['payload']['full_name'] = 'renamed';
    pushOps($credential['token'], [$rename])->assertOk()
        ->assertJson(['results' => [['op_id' => $rename['op_id'], 'status' => 'accepted']]]);

    expect($this->fx()->table('patients')->where('id', $patientId)->value('archived_at'))->not->toBeNull();

    forgetPatientOps([$archive['op_id'], $rename['op_id']], $patientId);
});

test('another organization cannot archive a patient, and never sees the mark', function () {
    $credentialA = makeAuthenticatedDevice();
    $credentialB = makeAuthenticatedDevice();
    $patientId = $this->makePatient($credentialA['orgId']);

    // B names its own organization: the row is invisible to B, so nothing matches.
    $asOwnOrg = archiveOp($patientId, $credentialB['orgId'], '2026-11-18T10:15:00.000Z');
    // B names A's organization: refused before anything is written.
    $asOtherOrg = archiveOp($patientId, $credentialA['orgId'], '2026-11-18T10:15:00.000Z');
    $results = pushOps($credentialB['token'], [$asOwnOrg])->assertOk()->json('results');
    $results = [...$results, ...pushOps($credentialB['token'], [$asOtherOrg])->assertOk()->json('results')];

    expect(collect($results)->pluck('status')->all())->not->toContain('accepted');
    expect($this->fx()->table('patients')->where('id', $patientId)->value('archived_at'))->toBeNull();
    expect($this->fx()->table('patients')->where('id', $patientId)->value('rev'))->toBe(1);
    expect($this->fx()->table('sync_ledger')->whereIn('op_id', [$asOwnOrg['op_id'], $asOtherOrg['op_id']])->exists())->toBeFalse();

    // A archives it; B's pull never carries it.
    $archive = archiveOp($patientId, $credentialA['orgId'], '2026-11-18T10:15:00.000Z');
    pushOps($credentialA['token'], [$archive])->assertOk();
    expect(pullOps($credentialB['token'])->assertOk()->getContent())->not->toContain($patientId);

    forgetPatientOps([$archive['op_id']], $patientId);
});
