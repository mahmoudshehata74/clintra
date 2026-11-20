<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Identity phase A1, schema (docs/design-identity-permissions.md, 6.2 and
 * "A1 decisions"): usernames and permissions on memberships, the password,
 * credential and login-attempt tables, the device's own key, the evidence
 * columns beside the ledger and the device audit log, the per-organization
 * enforcement switch, and what an activation code is for.
 *
 * Differences from the design's 6.2, each from the A1 decisions:
 * - usernames are 3 to 32 characters of [a-z0-9._-], stored lowercase, unique
 *   per organization on lower(username) (decision 1);
 * - login_attempts records the person an attempt resolved to
 *   (membership_id, null for an unknown username) and whether it is a
 *   sign-in or a step-up (kind), so auth_attempt_succeeded can mark only the
 *   attempt's own credential or person (decision 3).
 *
 * Nothing here is visible to a device of an organization whose
 * identity_enforced_at is null: the pull leaves username and permissions out
 * (decision 4), and nothing reads the new columns on those paths.
 *
 * No grant to clintra_app on member_passwords or login_attempts: only
 * clintra_auth's functions touch them (2026_09_12_000044). clintra_app gets
 * SELECT on member_credentials, scoped to its organization by policy, to
 * check a pushed op's credential.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE memberships ADD COLUMN username varchar(32) NULL');
        DB::statement(<<<'SQL'
            ALTER TABLE memberships ADD CONSTRAINT memberships_username_format
                CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,32}$')
        SQL);
        DB::statement('CREATE UNIQUE INDEX memberships_org_username_unique ON memberships (org_id, lower(username)) WHERE username IS NOT NULL');
        DB::statement("ALTER TABLE memberships ADD COLUMN permissions text[] NOT NULL DEFAULT '{}'::text[]");
        DB::statement(<<<'SQL'
            ALTER TABLE memberships ADD CONSTRAINT memberships_permissions_catalogue
                CHECK (permissions <@ ARRAY['reports.view', 'services.manage', 'invoices.edit_items', 'invoices.void', 'cash.close',
                                            'staff.manage', 'schedules.manage', 'clinical.view', 'patients.archive', 'messages.send']::text[])
        SQL);

        DB::statement(<<<'SQL'
            CREATE TABLE member_passwords (
                membership_id uuid PRIMARY KEY REFERENCES memberships(id) ON DELETE RESTRICT,
                org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
                password_hash text NOT NULL,
                must_change boolean NOT NULL DEFAULT true,
                set_at timestamptz NOT NULL,
                set_by_membership_id uuid NULL REFERENCES memberships(id) ON DELETE RESTRICT
            )
        SQL);
        DB::statement('ALTER TABLE member_passwords ENABLE ROW LEVEL SECURITY');
        DB::statement('ALTER TABLE member_passwords FORCE ROW LEVEL SECURITY');
        DB::statement('REVOKE ALL ON member_passwords FROM PUBLIC');

        DB::statement(<<<'SQL'
            CREATE TABLE member_credentials (
                id uuid PRIMARY KEY,
                org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
                membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
                device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
                public_key jsonb NOT NULL,
                algorithm text NOT NULL DEFAULT 'ES256' CHECK (algorithm = 'ES256'),
                created_at timestamptz NOT NULL,
                last_used_at timestamptz NULL,
                revoked_at timestamptz NULL,
                revoked_by_membership_id uuid NULL REFERENCES memberships(id) ON DELETE RESTRICT,
                revoke_reason text NULL CHECK (revoke_reason IN ('owner_revoked', 'password_reset', 'device_revoked', 'replaced')),
                CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX member_credentials_one_live ON member_credentials (membership_id, device_id) WHERE revoked_at IS NULL');
        DB::statement('CREATE INDEX member_credentials_device ON member_credentials (device_id)');
        DB::statement('ALTER TABLE member_credentials ENABLE ROW LEVEL SECURITY');
        DB::statement('ALTER TABLE member_credentials FORCE ROW LEVEL SECURITY');
        DB::statement('REVOKE ALL ON member_credentials FROM PUBLIC');
        DB::statement('GRANT SELECT ON member_credentials TO clintra_app');
        DB::statement('CREATE POLICY member_credentials_select ON member_credentials FOR SELECT USING (org_id = current_org())');

        DB::statement('ALTER TABLE device ADD COLUMN public_key jsonb NULL');
        DB::statement('ALTER TABLE device ADD COLUMN public_key_bound_at timestamptz NULL');

        DB::statement(<<<'SQL'
            CREATE TABLE login_attempts (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
                device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
                username varchar(64) NOT NULL,
                membership_id uuid NULL REFERENCES memberships(id) ON DELETE RESTRICT,
                kind text NOT NULL DEFAULT 'login' CHECK (kind IN ('login', 'step_up')),
                succeeded boolean NOT NULL DEFAULT false,
                at timestamptz NOT NULL DEFAULT now()
            )
        SQL);
        DB::statement('CREATE INDEX login_attempts_user_recent ON login_attempts (org_id, username, at)');
        DB::statement('CREATE INDEX login_attempts_device_recent ON login_attempts (device_id, at)');
        DB::statement('ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY');
        DB::statement('ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY');
        DB::statement('REVOKE ALL ON login_attempts FROM PUBLIC');

        DB::statement('ALTER TABLE sync_ledger ADD COLUMN credential_id uuid NULL REFERENCES member_credentials(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE sync_ledger ADD COLUMN proof text NULL');
        DB::statement('ALTER TABLE device_audit_log ADD COLUMN credential_id uuid NULL REFERENCES member_credentials(id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE device_audit_log ADD COLUMN proof text NULL');

        DB::statement('ALTER TABLE organizations ADD COLUMN identity_enforced_at timestamptz NULL');

        DB::statement(<<<'SQL'
            ALTER TABLE activation_codes ADD COLUMN purpose text NOT NULL DEFAULT 'device'
                CHECK (purpose IN ('device', 'owner_recovery'))
        SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE activation_codes DROP COLUMN purpose');
        DB::statement('ALTER TABLE organizations DROP COLUMN identity_enforced_at');
        DB::statement('ALTER TABLE device_audit_log DROP COLUMN proof');
        DB::statement('ALTER TABLE device_audit_log DROP COLUMN credential_id');
        DB::statement('ALTER TABLE sync_ledger DROP COLUMN proof');
        DB::statement('ALTER TABLE sync_ledger DROP COLUMN credential_id');
        DB::statement('DROP TABLE login_attempts');
        DB::statement('ALTER TABLE device DROP COLUMN public_key_bound_at');
        DB::statement('ALTER TABLE device DROP COLUMN public_key');
        DB::statement('DROP TABLE member_credentials');
        DB::statement('DROP TABLE member_passwords');
        DB::statement('ALTER TABLE memberships DROP CONSTRAINT memberships_permissions_catalogue');
        DB::statement('ALTER TABLE memberships DROP COLUMN permissions');
        DB::statement('DROP INDEX memberships_org_username_unique');
        DB::statement('ALTER TABLE memberships DROP CONSTRAINT memberships_username_format');
        DB::statement('ALTER TABLE memberships DROP COLUMN username');
    }
};
