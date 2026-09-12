<?php

use Illuminate\Support\Collection;

/**
 * Structural guard for the provisioning role split
 * (2026_09_12_000009_split_provisioning_roles.php, api/docs/rls.md's "One
 * role per provisioning function"). register_device is reachable from an
 * unauthenticated public endpoint and runs SECURITY DEFINER as
 * clintra_register — a flaw in that function inherits whatever
 * clintra_register can do, so its privileges must never silently widen
 * past what the current function body actually touches. This test reads
 * information_schema directly (the same source of truth the grants audit
 * in api/docs/rls.md was built from) rather than trusting the migration's
 * intent — it must fail the moment a future migration grants clintra_register
 * or clintra_mint anything beyond their allowlist below, even if that
 * migration's own comment claims otherwise.
 */
function tableGrants(string $role): Collection
{
    $rows = test()->asOwner()->select(<<<'SQL'
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = ?
        ORDER BY table_name, privilege_type
    SQL, [$role]);

    return collect($rows)->groupBy('table_name')->map(
        fn ($rows) => $rows->pluck('privilege_type')->sort()->values()->all()
    );
}

function columnGrants(string $role, string $table, string $privilege): array
{
    $rows = test()->asOwner()->select(<<<'SQL'
        SELECT column_name
        FROM information_schema.role_column_grants
        WHERE grantee = ? AND table_name = ? AND privilege_type = ?
        ORDER BY column_name
    SQL, [$role, $table, $privilege]);

    return collect($rows)->pluck('column_name')->all();
}

test('clintra_register holds no write of any kind outside its allowlist, and no privilege at all on clinical or org-identity tables', function () {
    $grants = tableGrants('clintra_register');

    // Every table clintra_register has ANY grant on — this is the
    // allowlist itself; anything not named here is a hole by definition.
    expect($grants->keys()->sort()->values()->all())->toBe([
        'activation_codes', 'audit_log', 'device', 'locations',
        'memberships', 'organizations', 'practitioners', 'users',
    ]);

    // Read-only on everything except the two tables register_device
    // actually creates rows in.
    foreach (['organizations', 'locations', 'practitioners', 'memberships', 'users'] as $table) {
        expect($grants[$table])->toBe(['SELECT']);
    }

    // role_table_grants only surfaces whole-table privileges — the UPDATE
    // here is column-restricted (GRANT UPDATE (col, col) ...), so it shows
    // up only in role_column_grants, never here. Confirmed against
    // pg_class.relacl directly: clintra_register's ACL entry on
    // activation_codes is `r` (SELECT) only, with the UPDATE bit living in
    // pg_attribute.attacl for the two named columns instead.
    expect($grants['activation_codes'])->toBe(['SELECT']);
    expect(columnGrants('clintra_register', 'activation_codes', 'UPDATE'))
        ->toBe(['used_at', 'used_by_device_id']);

    // No column anywhere on activation_codes grants UPDATE except those
    // two — this is what actually proves the allowlist is column-exact,
    // not just table-exact.
    $allUpdateColumns = $this->asOwner()->select(<<<'SQL'
        SELECT column_name
        FROM information_schema.role_column_grants
        WHERE grantee = 'clintra_register' AND table_name = 'activation_codes' AND privilege_type = 'UPDATE'
        ORDER BY column_name
    SQL);
    expect(collect($allUpdateColumns)->pluck('column_name')->all())->toBe(['used_at', 'used_by_device_id']);

    expect($grants['device'])->toBe(['INSERT']);

    // audit_log.seq is a Postgres identity column now
    // (2026_09_12_000010_sequence_backed_audit_seq.php) — SELECT MAX(seq)
    // was the only reason this role ever needed SELECT here, and an
    // identity column's underlying sequence needs no separate grant for a
    // role that already has INSERT on the table. INSERT-only, never
    // SELECT/UPDATE/DELETE, on an otherwise append-only table.
    expect($grants['audit_log'])->toBe(['INSERT']);

    // The specific hole this whole exercise was checking for: zero
    // privileges of any kind on clinical data or the tables that would let
    // a flaw here forge an org, a location, or a membership wholesale.
    $mustNeverAppear = [
        'patients', 'visits', 'invoices', 'payments',
        'practitioner_locations', 'specialty_templates', 'form_definitions',
    ];
    foreach ($mustNeverAppear as $table) {
        expect($grants->has($table))->toBeFalse("clintra_register must hold no privileges on {$table}");
    }
});

test('clintra_mint holds no write outside activation_codes and audit_log, and no privilege at all on clinical or org-identity tables', function () {
    $grants = tableGrants('clintra_mint');

    expect($grants->keys()->sort()->values()->all())->toBe([
        'activation_codes', 'audit_log', 'locations', 'memberships',
    ]);

    expect($grants['locations'])->toBe(['SELECT']);
    expect($grants['memberships'])->toBe(['SELECT']);
    expect($grants['activation_codes'])->toBe(['INSERT']);
    expect($grants['audit_log'])->toBe(['INSERT']);

    $mustNeverAppear = [
        'patients', 'visits', 'invoices', 'payments', 'organizations',
        'practitioners', 'practitioner_locations', 'users', 'device',
        'specialty_templates', 'form_definitions',
    ];
    foreach ($mustNeverAppear as $table) {
        expect($grants->has($table))->toBeFalse("clintra_mint must hold no privileges on {$table}");
    }
});

test('clintra_provision is left with exactly provision_organization\'s own footprint after the split', function () {
    $grants = tableGrants('clintra_provision');

    expect($grants->keys()->sort()->values()->all())->toBe([
        'activation_codes', 'audit_log', 'locations', 'memberships',
        'organizations', 'practitioner_locations', 'practitioners',
        'specialty_templates', 'users',
    ]);

    foreach (['organizations', 'locations', 'practitioners', 'practitioner_locations', 'memberships', 'activation_codes'] as $table) {
        expect($grants[$table])->toBe(['INSERT']);
    }
    expect($grants['audit_log'])->toBe(['INSERT']);
    expect($grants['users'])->toBe(['INSERT', 'SELECT']);
    expect($grants['specialty_templates'])->toBe(['SELECT']);

    foreach (['patients', 'visits', 'invoices', 'payments', 'device', 'form_definitions'] as $table) {
        expect($grants->has($table))->toBeFalse("clintra_provision must hold no privileges on {$table}");
    }
});

test('none of the three provisioning roles can SELECT audit_log', function () {
    // 2026_09_12_000010_sequence_backed_audit_seq.php: seq is a Postgres
    // identity column now, so SELECT MAX(seq) is gone from every
    // provisioning function — SELECT on audit_log was the only reason any
    // of the three roles ever had it. This test fails the moment a future
    // migration re-grants it for any other reason without a fresh review.
    foreach (['clintra_provision', 'clintra_mint', 'clintra_register'] as $role) {
        $rows = test()->asOwner()->select(<<<'SQL'
            SELECT privilege_type
            FROM information_schema.role_table_grants
            WHERE grantee = ? AND table_name = 'audit_log'
            ORDER BY privilege_type
        SQL, [$role]);

        expect(collect($rows)->pluck('privilege_type')->all())
            ->toBe(['INSERT'], "{$role} must hold INSERT-only on audit_log, never SELECT/UPDATE/DELETE");
    }
});

test('each of the three roles owns exactly its own function, and only that role plus its intended caller can execute it', function () {
    $rows = $this->asOwner()->select(<<<'SQL'
        SELECT routine_name, grantee, privilege_type
        FROM information_schema.role_routine_grants
        WHERE routine_name IN ('provision_organization', 'mint_activation_code', 'register_device')
        ORDER BY routine_name, grantee
    SQL);

    $executeGrants = collect($rows)->groupBy('routine_name')
        ->map(fn ($rows) => $rows->pluck('grantee')->sort()->values()->all());

    expect($executeGrants['provision_organization'])->toBe(['clintra_owner', 'clintra_provision']);
    expect($executeGrants['mint_activation_code'])->toBe(['clintra_mint', 'clintra_owner']);
    expect($executeGrants['register_device'])->toBe(['clintra_app', 'clintra_register']);

    $owners = $this->asOwner()->select(<<<'SQL'
        SELECT p.proname, r.rolname AS owner
        FROM pg_proc p
        JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname IN ('provision_organization', 'mint_activation_code', 'register_device')
    SQL);

    $ownerByName = collect($owners)->pluck('owner', 'proname');
    expect($ownerByName['provision_organization'])->toBe('clintra_provision');
    expect($ownerByName['mint_activation_code'])->toBe('clintra_mint');
    expect($ownerByName['register_device'])->toBe('clintra_register');
});
