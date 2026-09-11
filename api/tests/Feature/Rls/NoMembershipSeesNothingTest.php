<?php

// clintra_app with no app.membership_id declared must see zero rows from
// every RLS-protected table — fail-safe, not fail-open (api/docs/rls.md).
// Fixture data is inserted first specifically so a table that accidentally
// returned "everything" instead of "nothing" would be caught: an empty
// table passing this test proves nothing.
test('a connection with no membership set sees zero rows everywhere, even with fixture data present', function () {
    $orgId = $this->makeOrganization();
    $locationId = $this->makeLocation($orgId);
    $userId = $this->makeUser();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $this->makeFormDefinition($specialtyId);
    $practitionerId = $this->makePractitioner($orgId, $specialtyId);
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner']);
    $this->makeMembershipLocation($membershipId, $locationId);
    $patientId = $this->makePatient($orgId);
    $this->makeVisit($orgId, $locationId, $practitionerId, $patientId, $membershipId);
    $this->makeAuditLog($orgId, $membershipId);

    foreach ($this->rlsTableNames() as $table) {
        $count = $this->asApp()->table($table)->count();

        expect($count)->toBe(0, "table \"{$table}\" returned {$count} row(s) with no membership set");
    }
});
