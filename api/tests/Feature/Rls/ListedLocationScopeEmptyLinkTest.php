<?php

// The empty-link-table trap (api/docs/rls.md): location_scope = 'listed'
// with no rows in membership_locations must mean zero locations, not every
// location. allowed_locations() has to branch on the scope column itself,
// never infer "all" from an empty join.
test('location_scope listed with an empty membership_locations table sees zero visits', function () {
    $orgId = $this->makeOrganization();
    $locationId = $this->makeLocation($orgId);
    $userId = $this->makeUser();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($orgId, $specialtyId);

    $membershipId = $this->makeMembership($userId, $orgId, [
        'role' => 'assistant',
        'location_scope' => 'listed',
        'practitioner_scope' => 'all',
    ]);
    // Deliberately no makeMembershipLocation() call — the link table stays
    // empty for this membership.

    $patientId = $this->makePatient($orgId);
    $this->makeVisit($orgId, $locationId, $practitionerId, $patientId, $membershipId);

    $this->withMembership($this->asApp(), $membershipId, function ($db) {
        expect($db->table('visits')->count())->toBe(0);
    });
});
