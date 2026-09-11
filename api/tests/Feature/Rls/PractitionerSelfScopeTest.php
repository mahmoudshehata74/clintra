<?php

// practitioner_scope = 'self' must see only that one practitioner's own
// visits — not every practitioner at a location it can otherwise see.
test('practitioner_scope self sees only its own practitioner\'s visits', function () {
    $orgId = $this->makeOrganization();
    $locationId = $this->makeLocation($orgId);
    $specialtyId = $this->makeSpecialtyTemplate(null);

    $selfUserId = $this->makeUser('self-user');
    $selfPractitionerId = $this->makePractitioner($orgId, $specialtyId, 'self-practitioner');

    $otherPractitionerId = $this->makePractitioner($orgId, $specialtyId, 'other-practitioner');

    $membershipId = $this->makeMembership($selfUserId, $orgId, [
        'role' => 'practitioner',
        'location_scope' => 'all',
        'practitioner_scope' => 'self',
        'practitioner_id' => $selfPractitionerId,
    ]);

    $patientId = $this->makePatient($orgId);
    $ownVisit = $this->makeVisit($orgId, $locationId, $selfPractitionerId, $patientId, $membershipId, ['position' => 1]);
    $otherVisit = $this->makeVisit($orgId, $locationId, $otherPractitionerId, $patientId, $membershipId, ['position' => 2]);

    $this->withMembership($this->asApp(), $membershipId, function ($db) use ($ownVisit, $otherVisit) {
        $visitIds = $db->table('visits')->pluck('id')->all();

        expect($visitIds)->toBe([$ownVisit]);
        expect($visitIds)->not->toContain($otherVisit);
    });
});
