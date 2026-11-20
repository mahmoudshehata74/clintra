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
    $deviceId = $this->makeDevice($orgId, $locationId, $membershipId);
    $this->makeSyncLedgerRow($orgId, $membershipId, $deviceId);
    $this->makeMemberCredential($orgId, $membershipId, $deviceId, ['kty' => 'EC', 'crv' => 'P-256', 'x' => 'x', 'y' => 'y']);
    $this->fx()->table('member_passwords')->insert([
        'membership_id' => $membershipId, 'org_id' => $orgId, 'password_hash' => 'hash', 'set_at' => now()->toIso8601String(),
    ]);
    $this->fx()->table('login_attempts')->insert(['org_id' => $orgId, 'device_id' => $deviceId, 'username' => 'someone']);

    $unreadable = [];

    foreach ($this->rlsTableNames() as $table) {
        // A table clintra_app holds no SELECT on at all is unreadable with or
        // without a membership — stronger than empty. Exactly the two named
        // below may be (only clintra_auth's functions read them).
        if (! $this->asOwner()->selectOne('select has_table_privilege(?, ?, ?) as granted', ['clintra_app', $table, 'SELECT'])->granted) {
            $unreadable[] = $table;

            continue;
        }

        $count = $this->asApp()->table($table)->count();

        expect($count)->toBe(0, "table \"{$table}\" returned {$count} row(s) with no membership set");
    }

    expect($unreadable)->toBe(['login_attempts', 'member_passwords']);
});
