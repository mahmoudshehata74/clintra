<?php

// audit_log has no UPDATE/DELETE policy at all (api/docs/rls.md) — with
// FORCE RLS and no matching policy, every UPDATE/DELETE affects zero rows.
// History is immutable by construction, not just by convention.
test('audit_log rows cannot be updated or deleted through clintra_app', function () {
    $orgId = $this->makeOrganization();
    $userId = $this->makeUser();
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner']);
    $auditId = $this->makeAuditLog($orgId, $membershipId);

    $this->withMembership($this->asApp(), $membershipId, function ($db) use ($auditId) {
        $updated = $db->table('audit_log')->where('id', $auditId)->update(['action' => 'update']);
        expect($updated)->toBe(0);

        $deleted = $db->table('audit_log')->where('id', $auditId)->delete();
        expect($deleted)->toBe(0);
    });

    // The row is still there, untouched — this wasn't a "not found", it was
    // "not permitted."
    expect($this->fx()->table('audit_log')->where('id', $auditId)->where('action', 'create')->exists())->toBeTrue();
});
