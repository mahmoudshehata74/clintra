<?php

// A membership in org A must see org A's own organization/patients/visits
// and none of org B's, even though both orgs' rows sit in the same tables
// under the same clintra_app connection.
test('a membership sees only its own org\'s organization, patients, and visits', function () {
    $orgA = $this->makeOrganization('org-a');
    $locationA = $this->makeLocation($orgA);
    $userA = $this->makeUser('user-a');
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerA = $this->makePractitioner($orgA, $specialtyId);
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);
    $patientA = $this->makePatient($orgA, 'patient-a');
    $visitA = $this->makeVisit($orgA, $locationA, $practitionerA, $patientA, $membershipA);

    $orgB = $this->makeOrganization('org-b');
    $locationB = $this->makeLocation($orgB);
    $userB = $this->makeUser('user-b');
    $practitionerB = $this->makePractitioner($orgB, $specialtyId);
    $membershipB = $this->makeMembership($userB, $orgB, ['role' => 'owner']);
    $patientB = $this->makePatient($orgB, 'patient-b');
    $visitB = $this->makeVisit($orgB, $locationB, $practitionerB, $patientB, $membershipB);

    $this->withMembership($this->asApp(), $membershipA, function ($db) use ($orgA, $patientA, $patientB, $visitA, $visitB) {
        $orgIds = $db->table('organizations')->pluck('id')->all();
        expect($orgIds)->toBe([$orgA]);

        $patientIds = $db->table('patients')->pluck('id')->all();
        expect($patientIds)->toContain($patientA);
        expect($patientIds)->not->toContain($patientB);

        $visitIds = $db->table('visits')->pluck('id')->all();
        expect($visitIds)->toContain($visitA);
        expect($visitIds)->not->toContain($visitB);
    });
});
