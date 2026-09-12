<?php

use Illuminate\Database\QueryException;

// audit_log has no UPDATE/DELETE policy at all, and (since
// 2026_09_12_000015_revoke_inert_write_grants.php) clintra_app holds no
// UPDATE/DELETE grant on it either — two independent layers, not one
// covering for the other. The grant layer is what actually stops the
// statement now: it never reaches the (still-absent) policy check at
// all, failing loudly with a permission error instead of silently
// affecting zero rows. History is immutable by construction, not just by
// convention, and now fails loudly rather than quietly if that's ever
// probed.
test('audit_log rows cannot be updated or deleted through clintra_app', function () {
    $orgId = $this->makeOrganization();
    $userId = $this->makeUser();
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner']);
    $auditId = $this->makeAuditLog($orgId, $membershipId);

    $updateCaught = null;
    $deleteCaught = null;

    $this->withMembership($this->asApp(), $membershipId, function ($db) use ($auditId, &$updateCaught) {
        try {
            $db->table('audit_log')->where('id', $auditId)->update(['action' => 'update']);
        } catch (QueryException $e) {
            $updateCaught = $e;
        }
    });

    $this->withMembership($this->asApp(), $membershipId, function ($db) use ($auditId, &$deleteCaught) {
        try {
            $db->table('audit_log')->where('id', $auditId)->delete();
        } catch (QueryException $e) {
            $deleteCaught = $e;
        }
    });

    expect($updateCaught)->not->toBeNull('UPDATE must be rejected by the grant, not silently no-op');
    expect($updateCaught->getCode())->toBe('42501');
    expect($deleteCaught)->not->toBeNull('DELETE must be rejected by the grant, not silently no-op');
    expect($deleteCaught->getCode())->toBe('42501');

    // The row is still there, untouched — this wasn't a "not found", it was
    // "not permitted."
    expect($this->fx()->table('audit_log')->where('id', $auditId)->where('action', 'create')->exists())->toBeTrue();
});
