<?php

/**
 * 2026_09_12_000015_revoke_inert_write_grants.php: audit_log and
 * sync_ledger are meant to be append-only. Before this migration,
 * clintra_app held UPDATE/DELETE on both via the standard
 * EnablesRowLevelSecurity grant — inert only because neither table has a
 * matching RLS policy for those actions. This test asserts the grant
 * itself is gone now, not just the policy — immutability no longer
 * depends on a single layer.
 */
test('clintra_app holds no UPDATE or DELETE grant on audit_log or sync_ledger', function () {
    foreach (['audit_log', 'sync_ledger'] as $table) {
        $rows = $this->asOwner()->select(<<<'SQL'
            SELECT privilege_type
            FROM information_schema.role_table_grants
            WHERE grantee = 'clintra_app' AND table_name = ?
            ORDER BY privilege_type
        SQL, [$table]);

        $privileges = collect($rows)->pluck('privilege_type')->all();

        expect($privileges)->not->toContain('UPDATE', "clintra_app must not hold UPDATE on {$table}");
        expect($privileges)->not->toContain('DELETE', "clintra_app must not hold DELETE on {$table}");

        // SELECT/INSERT are untouched — both tables are still read and
        // appended to through the ordinary connection.
        expect($privileges)->toContain('SELECT');
        expect($privileges)->toContain('INSERT');
    }
});
