<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Opens the one door that lets the very first organization exist at all.
 * organizations' policy is `id = current_org()`, and current_org() can
 * never resolve without an active membership — but a membership needs an
 * org to belong to. Neither clintra_app nor clintra_owner (both fully
 * RLS-bound) can break that cycle; see api/docs/rls.md's "Provisioning: the
 * one door into an empty database" section for the full reasoning behind
 * this design over the alternatives (granting BYPASSRLS to clintra_app,
 * SET ROLE from PHP, or a bootstrap membership row).
 *
 * clintra_provision (NOLOGIN, BYPASSRLS — created outside this migration,
 * same as clintra_rls/clintra_fixtures; see api/README.md) owns exactly one
 * SECURITY DEFINER function, provision_organization(jsonb), that creates an
 * organization, its first location, the owner's user row (or reuses an
 * existing one by phone), a practitioner, its practitioner_locations link,
 * the owner membership, and an audit_log row for every created row — all in
 * one transaction. Every id is supplied by the caller; the function never
 * calls gen_random_uuid() itself (App\Console\Commands\ProvisionOrganization
 * generates them, as "the install tool acting as a client").
 *
 * EXECUTE is revoked from PUBLIC and granted only to clintra_owner —
 * PostgreSQL grants EXECUTE to PUBLIC on every new function by default,
 * which would otherwise let clintra_app call this SECURITY DEFINER
 * function directly and bypass RLS on all seven tables it touches. Never
 * granted to clintra_app.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Table-level grants: exactly what the function's body touches.
        // INSERT on every table it creates rows in; SELECT only where the
        // function actually needs to read (the phone-reuse check on users,
        // and MAX(seq) on audit_log) — not on the other five, since
        // RETURNING captures every row the function itself just inserted
        // without needing separate SELECT privilege.
        DB::statement('GRANT INSERT ON organizations, locations, users, practitioners, practitioner_locations, memberships, audit_log TO clintra_provision');
        DB::statement('GRANT SELECT ON users, audit_log TO clintra_provision');

        // Created while acting as clintra_provision (clintra_owner is a
        // granted member — see api/README.md), so clintra_provision owns
        // the function directly. SECURITY DEFINER is what makes it actually
        // RUN as clintra_provision for any caller with EXECUTE — see the
        // REVOKE/GRANT below.
        DB::statement('SET ROLE clintra_provision');

        DB::statement('DROP FUNCTION IF EXISTS provision_organization(jsonb)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION provision_organization(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_org_id uuid := (payload->>'org_id')::uuid;
                v_org_name text := payload->>'org_name';
                v_plan_tier text := payload->>'plan_tier';
                v_location_id uuid := (payload->>'location_id')::uuid;
                v_location_name text := payload->>'location_name';
                v_location_address text := payload->>'location_address';
                v_location_phone text := payload->>'location_phone';
                v_user_id uuid;
                v_user_full_name text := payload->>'user_full_name';
                v_user_phone text := payload->>'user_phone';
                v_user_is_new boolean := true;
                v_existing_user_id uuid;
                v_practitioner_id uuid := (payload->>'practitioner_id')::uuid;
                v_practitioner_title text := payload->>'practitioner_title';
                v_specialty_id uuid := (payload->>'specialty_id')::uuid;
                v_practitioner_location_id uuid := (payload->>'practitioner_location_id')::uuid;
                v_membership_id uuid := (payload->>'membership_id')::uuid;
                v_pin_hash text := payload->>'pin_hash';
                v_pin_salt text := payload->>'pin_salt';
                v_seq bigint;
                v_now timestamptz := now();
            BEGIN
                -- No `RETURNING` anywhere below: every value inserted is
                -- already known from payload (or a fixed constant), and
                -- `INSERT ... RETURNING` requires SELECT privilege on the
                -- target table in addition to INSERT — confirmed empirically
                -- (an earlier version of this function used RETURNING and
                -- failed "permission denied for table organizations" despite
                -- clintra_provision having INSERT). Building each audit
                -- "after" snapshot from the same known values keeps the
                -- grants above exactly SELECT-where-actually-needed: users
                -- (the phone-reuse check) and audit_log (MAX(seq)), nothing
                -- broader.
                INSERT INTO organizations (id, name, plan_tier, created_at)
                VALUES (v_org_id, v_org_name, v_plan_tier, v_now);

                INSERT INTO locations (id, org_id, name, address, phone, is_active)
                VALUES (v_location_id, v_org_id, v_location_name, v_location_address, v_location_phone, true);

                -- A user can hold memberships in several orgs (docs/schema.md) —
                -- reuse the existing row by phone rather than creating a
                -- second identity for the same real person.
                SELECT id INTO v_existing_user_id FROM users WHERE phone = v_user_phone;
                IF FOUND THEN
                    v_user_id := v_existing_user_id;
                    v_user_is_new := false;
                ELSE
                    v_user_id := (payload->>'user_id')::uuid;
                    INSERT INTO users (id, full_name, phone, email, is_active)
                    VALUES (v_user_id, v_user_full_name, v_user_phone, NULL, true);
                END IF;

                INSERT INTO practitioners (id, org_id, user_id, full_name, specialty_id, title, is_active)
                VALUES (v_practitioner_id, v_org_id, v_user_id, v_user_full_name, v_specialty_id, v_practitioner_title, true);

                INSERT INTO practitioner_locations (id, practitioner_id, location_id, is_active)
                VALUES (v_practitioner_location_id, v_practitioner_id, v_location_id, true);

                -- practitioner_scope 'all', not 'self': the owner manages every
                -- practitioner at the org from day one, not just themselves —
                -- practitioner_id stays null (required only when scope is 'self',
                -- per docs/schema.md).
                INSERT INTO memberships (
                    id, user_id, org_id, role, location_scope, practitioner_scope,
                    practitioner_id, pin_hash, pin_salt, is_active
                )
                VALUES (
                    v_membership_id, v_user_id, v_org_id,
                    'owner', 'all', 'all', NULL,
                    v_pin_hash, v_pin_salt, true
                );

                -- audit_log.seq: "assigned by application code inside the same
                -- transaction as the row itself" (docs/schema.md) — this
                -- function IS that application code for every row it creates.
                SELECT COALESCE(MAX(seq), 0) INTO v_seq FROM audit_log;

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_organization_id')::uuid, v_org_id, v_membership_id, 'organizations', v_org_id, 'create', NULL,
                    jsonb_build_object('id', v_org_id, 'name', v_org_name, 'plan_tier', v_plan_tier, 'created_at', v_now),
                    v_now, v_seq
                );

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_location_id')::uuid, v_org_id, v_membership_id, 'locations', v_location_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_location_id, 'org_id', v_org_id, 'name', v_location_name,
                        'address', v_location_address, 'phone', v_location_phone, 'is_active', true
                    ),
                    v_now, v_seq
                );

                IF v_user_is_new THEN
                    v_seq := v_seq + 1;
                    INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                    VALUES (
                        (payload->>'audit_user_id')::uuid, v_org_id, v_membership_id, 'users', v_user_id, 'create', NULL,
                        jsonb_build_object('id', v_user_id, 'full_name', v_user_full_name, 'phone', v_user_phone, 'email', NULL, 'is_active', true),
                        v_now, v_seq
                    );
                END IF;

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_practitioner_id')::uuid, v_org_id, v_membership_id, 'practitioners', v_practitioner_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_practitioner_id, 'org_id', v_org_id, 'user_id', v_user_id, 'full_name', v_user_full_name,
                        'specialty_id', v_specialty_id, 'title', v_practitioner_title, 'is_active', true
                    ),
                    v_now, v_seq
                );

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_practitioner_location_id')::uuid, v_org_id, v_membership_id, 'practitioner_locations', v_practitioner_location_id, 'create', NULL,
                    jsonb_build_object('id', v_practitioner_location_id, 'practitioner_id', v_practitioner_id, 'location_id', v_location_id, 'is_active', true),
                    v_now, v_seq
                );

                -- pin_hash/pin_salt deliberately excluded from this snapshot —
                -- audit_log rows are org-readable (see its SELECT policy), and
                -- a PIN's hash has no business being visible to every staff
                -- member who can open the audit sheet, hashed or not.
                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_membership_id')::uuid, v_org_id, v_membership_id, 'memberships', v_membership_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_membership_id, 'user_id', v_user_id, 'org_id', v_org_id, 'role', 'owner',
                        'location_scope', 'all', 'practitioner_scope', 'all', 'practitioner_id', NULL, 'is_active', true
                    ),
                    v_now, v_seq
                );

                RETURN jsonb_build_object(
                    'organization_id', v_org_id,
                    'location_id', v_location_id,
                    'user_id', v_user_id,
                    'user_is_new', v_user_is_new,
                    'practitioner_id', v_practitioner_id,
                    'practitioner_location_id', v_practitioner_location_id,
                    'membership_id', v_membership_id
                );
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION provision_organization(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION provision_organization(jsonb) TO clintra_owner');

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('SET ROLE clintra_provision');
        DB::statement('DROP FUNCTION IF EXISTS provision_organization(jsonb)');
        DB::statement('RESET ROLE');

        DB::statement('REVOKE INSERT ON organizations, locations, users, practitioners, practitioner_locations, memberships, audit_log FROM clintra_provision');
        DB::statement('REVOKE SELECT ON users, audit_log FROM clintra_provision');
    }
};
