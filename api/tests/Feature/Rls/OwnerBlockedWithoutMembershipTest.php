<?php

// The owner-bypass trap (api/docs/rls.md): RLS does not apply to a table's
// owner by default. FORCE ROW LEVEL SECURITY is what makes clintra_owner —
// who creates and owns every table — just as blocked as clintra_app when no
// membership is declared.
test('clintra_owner with no membership set sees zero rows', function () {
    $orgId = $this->makeOrganization();
    $locationId = $this->makeLocation($orgId);
    $userId = $this->makeUser();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($orgId, $specialtyId);
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner']);
    $patientId = $this->makePatient($orgId);
    $this->makeVisit($orgId, $locationId, $practitionerId, $patientId, $membershipId);

    expect($this->asOwner()->table('organizations')->count())->toBe(0);
    expect($this->asOwner()->table('patients')->count())->toBe(0);
    expect($this->asOwner()->table('visits')->count())->toBe(0);
});
