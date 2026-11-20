<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Identity phase A1: what clintra_auth may touch (docs/design-identity-permissions.md,
 * 6.1). clintra_auth is a NOLOGIN BYPASSRLS role created outside migrations,
 * like every function-owning role (api/README.md, .github/workflows/ci.yml);
 * it owns the auth_* functions (2026_09_12_000044) and the membership
 * permission guard (2026_09_12_000045), and holds exactly what their bodies
 * read or write, column-exact where Postgres allows it.
 * ProvisioningRoleGrantsTest pins every grant below.
 *
 * Beyond the design's list, each for a function the A1 decisions add or
 * change:
 * - memberships: UPDATE (username) — auth_set_username and auth_recover_owner
 *   (decision 1);
 * - member_credentials: SELECT (created_at) — auth_attempt_succeeded checks a
 *   sign-in's credential was made after its attempt (decision 3);
 * - activation_codes: UPDATE (used_by_device_id) — auth_recover_owner records
 *   the device that used the code, as register_device does;
 * - organizations: SELECT (id, identity_enforced_at) — the permission guard
 *   applies only to an enforced organization (decision 4).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            'GRANT SELECT (id, user_id, org_id, role, is_active, username, permissions, pin_hash, pin_salt, display_name, rev) '.
            'ON memberships TO clintra_auth'
        );
        DB::statement('GRANT UPDATE (username) ON memberships TO clintra_auth');
        DB::statement('GRANT SELECT, INSERT ON member_passwords TO clintra_auth');
        DB::statement('GRANT UPDATE (password_hash, must_change, set_at, set_by_membership_id) ON member_passwords TO clintra_auth');
        DB::statement('GRANT SELECT (id, org_id, membership_id, device_id, created_at, revoked_at) ON member_credentials TO clintra_auth');
        DB::statement('GRANT INSERT ON member_credentials TO clintra_auth');
        DB::statement('GRANT UPDATE (revoked_at, revoked_by_membership_id, revoke_reason, last_used_at) ON member_credentials TO clintra_auth');
        DB::statement('GRANT SELECT (id, org_id, revoked_at, public_key) ON device TO clintra_auth');
        DB::statement('GRANT UPDATE (public_key, public_key_bound_at) ON device TO clintra_auth');
        DB::statement('GRANT SELECT, INSERT ON login_attempts TO clintra_auth');
        DB::statement('GRANT UPDATE (succeeded) ON login_attempts TO clintra_auth');
        DB::statement('GRANT SELECT (id, org_id, code_hash, expires_at, used_at, purpose) ON activation_codes TO clintra_auth');
        DB::statement('GRANT UPDATE (used_at, used_by_device_id) ON activation_codes TO clintra_auth');
        DB::statement('GRANT SELECT (id, phone) ON users TO clintra_auth');
        DB::statement('GRANT SELECT (id, identity_enforced_at) ON organizations TO clintra_auth');
        DB::statement('GRANT INSERT ON audit_log TO clintra_auth');
    }

    public function down(): void
    {
        DB::statement('REVOKE ALL ON audit_log FROM clintra_auth');
        DB::statement('REVOKE ALL ON organizations FROM clintra_auth');
        DB::statement('REVOKE ALL ON users FROM clintra_auth');
        DB::statement('REVOKE ALL ON activation_codes FROM clintra_auth');
        DB::statement('REVOKE ALL ON login_attempts FROM clintra_auth');
        DB::statement('REVOKE ALL ON device FROM clintra_auth');
        DB::statement('REVOKE ALL ON member_credentials FROM clintra_auth');
        DB::statement('REVOKE ALL ON member_passwords FROM clintra_auth');
        DB::statement('REVOKE ALL ON memberships FROM clintra_auth');
    }
};
