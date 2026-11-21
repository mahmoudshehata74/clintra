<?php

use Illuminate\Database\QueryException;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

test('the admin log trigger refuses mutation even when the caller is temporarily granted that privilege', function (string $role, string $operation) {
    $owner = $this->asOwner();
    $id = $this->platformId();
    $sql = match ($operation) {
        'UPDATE' => "UPDATE platform.admin_log SET reason='changed' WHERE id=?::uuid",
        'DELETE' => 'DELETE FROM platform.admin_log WHERE id=?::uuid',
        'TRUNCATE' => 'TRUNCATE platform.admin_log',
    };
    $bindings = $operation === 'TRUNCATE' ? [] : [$id];
    if ($role === 'clintra_fixtures') {
        // This independent login is not a member of the owner. Grant only for
        // this probe, then restore its original zero platform privileges.
        expect($owner->selectOne("SELECT has_schema_privilege('clintra_fixtures','platform','USAGE') AS allowed")->allowed)->toBeFalse();
        $owner->statement('GRANT USAGE ON SCHEMA platform TO clintra_fixtures');
        $owner->statement('GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON platform.admin_log TO clintra_fixtures');
        $db = $this->fx();
        $db->beginTransaction();
    } else {
        $db = $owner;
        $db->beginTransaction();
        $db->statement('GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON platform.admin_log TO '.$role);
        $db->statement('GRANT USAGE ON SCHEMA platform TO '.$role);
        $db->statement('SET LOCAL ROLE '.$role);
    }
    try {
        $db->insert("INSERT INTO platform.admin_log(id,action,succeeded) VALUES (?::uuid,'admin.login',false)", [$id]);
        $caught = null;
        try {
            $db->transaction(fn () => $db->statement($sql, $bindings));
        } catch (QueryException $e) {
            $caught = $e;
        }
        expect($caught)->not->toBeNull();
        expect($caught->getCode())->toBe('55000');
        expect($caught->getMessage())->toContain('admin_log is append-only');
        expect($db->table('platform.admin_log')->where('id', $id)->value('reason'))->toBeNull();
    } finally {
        if ($role !== 'clintra_fixtures') {
            $db->statement('RESET ROLE');
        }
        $db->rollBack();
        if ($role === 'clintra_fixtures') {
            $owner->statement('REVOKE ALL ON platform.admin_log FROM clintra_fixtures');
            $owner->statement('REVOKE USAGE ON SCHEMA platform FROM clintra_fixtures');
        }
    }
})->with([
    'clintra_owner', 'clintra_fixtures', 'clintra_rls', 'clintra_provision', 'clintra_mint', 'clintra_register', 'clintra_staff', 'clintra_auth',
    'clintra_admin_auth', 'clintra_admin_provision', 'clintra_admin_mint', 'clintra_admin_device', 'clintra_admin_org',
    'clintra_admin_stats', 'clintra_admin_support', 'clintra_support',
])->with(['UPDATE', 'DELETE', 'TRUNCATE']);
