<?php

// current_org()/current_membership() both filter on memberships.is_active —
// a deactivated membership id must resolve to no scope at all, not the scope
// it had while active.
test('an inactive membership sees zero rows', function () {
    $orgId = $this->makeOrganization();
    $locationId = $this->makeLocation($orgId);
    $userId = $this->makeUser();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($orgId, $specialtyId);

    $membershipId = $this->makeMembership($userId, $orgId, [
        'role' => 'owner',
        'is_active' => false,
    ]);

    $patientId = $this->makePatient($orgId);
    $this->makeVisit($orgId, $locationId, $practitionerId, $patientId, $membershipId);

    $this->withMembership($this->asApp(), $membershipId, function ($db) {
        expect($db->table('organizations')->count())->toBe(0);
        expect($db->table('patients')->count())->toBe(0);
        expect($db->table('visits')->count())->toBe(0);
    });
});
