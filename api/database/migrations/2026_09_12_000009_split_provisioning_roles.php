<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * clintra_provision used to own three functions — provision_organization
 * (CLI-only, clintra_owner EXECUTE), mint_activation_code (CLI-only,
 * clintra_owner EXECUTE), and register_device (clintra_app EXECUTE, called
 * from a live, unauthenticated HTTP request). Postgres grants are per-role,
 * not per-function, so sharing one owner meant register_device — reachable
 * from the internet — ran with the union of all three functions' table
 * privileges: INSERT on organizations, locations, practitioners,
 * practitioner_locations, memberships that only provision_organization
 * ever used. A flaw in register_device would have been an
 * organization-and-membership forgery primitive, not just a device one.
 *
 * Split into three roles, sized by exposure:
 * - clintra_provision keeps provision_organization only — CLI-only, never
 *   network-reachable, unchanged from before this migration.
 * - clintra_mint (new) owns mint_activation_code — also CLI-only.
 * - clintra_register (new) owns register_device — the one that's
 *   internet-facing, and now the narrowest of the three: exactly the
 *   columns its current function body reads or writes, nothing granted on
 *   the grounds it might be needed later (that's a future migration's job,
 *   not this one's).
 *
 * Every grant below was checked directly against each function's current
 * SQL body, not assumed from what the function is "supposed to" do — see
 * api/docs/rls.md's "One role per provisioning function" section for the
 * two corrections that check turned up (both functions read audit_log via
 * SELECT MAX(seq), not just write it; mint_activation_code needs
 * memberships SELECT, not organizations SELECT).
 */
return new class extends Migration
{
    public function up(): void
    {
        // Drop both functions from their current owner (clintra_provision)
        // before recreating them under their own new role — same
        // SET ROLE / DROP FUNCTION / CREATE FUNCTION / RESET ROLE idiom
        // every other function-owning migration in this schema uses.
        DB::statement('SET ROLE clintra_provision');
        DB::statement('DROP FUNCTION IF EXISTS mint_activation_code(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS register_device(jsonb)');
        DB::statement('RESET ROLE');

        // clintra_provision no longer owns these two functions, so it no
        // longer needs any of the grants that existed solely for them.
        // What's left afterward is exactly provision_organization's own
        // original footprint (2026_09_11_170033_add_organization_provisioning.php).
        DB::statement('REVOKE SELECT ON locations, memberships FROM clintra_provision'); // was mint's
        DB::statement('REVOKE SELECT ON organizations, locations, practitioners FROM clintra_provision'); // was register's
        DB::statement('REVOKE SELECT, UPDATE ON activation_codes FROM clintra_provision'); // was register's
        DB::statement('REVOKE INSERT ON device FROM clintra_provision'); // was register's

        // --- clintra_mint: exactly what mint_activation_code's body uses ---
        // locations: verify the given location belongs to the given org.
        // memberships: find the org's active owner, to attribute the audit
        // row to. activation_codes: create the code (no SELECT — the
        // function never reads this table back, only INSERT ... no
        // RETURNING). audit_log: SELECT to compute MAX(seq), INSERT for
        // the code-creation row — append-only in the sense that nothing
        // ever UPDATEs or DELETEs it, but MAX(seq) is a genuine read.
        DB::statement('GRANT SELECT ON locations, memberships TO clintra_mint');
        DB::statement('GRANT INSERT ON activation_codes TO clintra_mint');
        DB::statement('GRANT SELECT, INSERT ON audit_log TO clintra_mint');

        DB::statement('SET ROLE clintra_mint');
        DB::statement(<<<'SQL'
            CREATE FUNCTION mint_activation_code(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY['id', 'org_id', 'location_id', 'code_hash', 'expires_at', 'audit_id'];
                v_unknown_keys text[];
                v_key text;

                v_id uuid;
                v_org_id uuid;
                v_location_id uuid;
                v_code_hash text;
                v_expires_at timestamptz;
                v_owner_membership_id uuid;
                v_seq bigint;
                v_now timestamptz := now();
            BEGIN
                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'mint_activation_code: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'mint_activation_code: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                v_org_id := (payload->>'org_id')::uuid;
                v_location_id := (payload->>'location_id')::uuid;
                v_code_hash := payload->>'code_hash';
                v_expires_at := (payload->>'expires_at')::timestamptz;

                IF v_code_hash !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'mint_activation_code: code_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF v_expires_at <= v_now THEN
                    RAISE EXCEPTION 'mint_activation_code: expires_at must be in the future' USING ERRCODE = '22023';
                END IF;

                IF NOT EXISTS (SELECT 1 FROM locations WHERE id = v_location_id AND org_id = v_org_id) THEN
                    RAISE EXCEPTION 'mint_activation_code: location_id must belong to org_id' USING ERRCODE = '22023';
                END IF;

                SELECT id INTO v_owner_membership_id
                FROM memberships
                WHERE org_id = v_org_id AND role = 'owner' AND is_active = true
                ORDER BY id
                LIMIT 1;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'mint_activation_code: org_id has no active owner membership' USING ERRCODE = '22023';
                END IF;

                v_id := (payload->>'id')::uuid;

                INSERT INTO activation_codes (id, org_id, location_id, code_hash, expires_at, used_at, used_by_device_id, created_at)
                VALUES (v_id, v_org_id, v_location_id, v_code_hash, v_expires_at, NULL, NULL, v_now);

                SELECT COALESCE(MAX(seq), 0) INTO v_seq FROM audit_log;
                v_seq := v_seq + 1;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_id')::uuid, v_org_id, v_owner_membership_id, 'activation_codes', v_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_id, 'org_id', v_org_id, 'location_id', v_location_id,
                        'expires_at', v_expires_at, 'used_at', NULL, 'used_by_device_id', NULL
                    ),
                    v_now, v_seq
                );

                RETURN jsonb_build_object('id', v_id, 'org_id', v_org_id, 'location_id', v_location_id, 'expires_at', v_expires_at);
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION mint_activation_code(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION mint_activation_code(jsonb) TO clintra_owner');
        DB::statement('RESET ROLE');

        // --- clintra_register: exactly what register_device's body uses ---
        // organizations/locations/practitioners/memberships/users: SELECT
        // only, to assemble the bootstrap payload and verify the
        // phone/code. activation_codes: SELECT to look up the code;
        // UPDATE restricted to the two columns the function actually sets
        // (used_at, used_by_device_id) — never id/org_id/location_id/
        // code_hash/expires_at/created_at, and never DELETE. device:
        // INSERT only — no SELECT, since the function never reads a device
        // row back (no RETURNING). audit_log: SELECT for MAX(seq), INSERT
        // for the two audit rows this function writes per registration.
        DB::statement('GRANT SELECT ON organizations, locations, practitioners, memberships, users TO clintra_register');
        DB::statement('GRANT SELECT ON activation_codes TO clintra_register');
        DB::statement('GRANT UPDATE (used_at, used_by_device_id) ON activation_codes TO clintra_register');
        DB::statement('GRANT INSERT ON device TO clintra_register');
        DB::statement('GRANT SELECT, INSERT ON audit_log TO clintra_register');

        DB::statement('SET ROLE clintra_register');
        DB::statement(<<<'SQL'
            CREATE FUNCTION register_device(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY['device_id', 'phone', 'code_hash', 'audit_device_id', 'audit_code_used_id'];
                v_unknown_keys text[];
                v_key text;

                v_device_id uuid;
                v_phone text;
                v_code_hash text;

                v_code_id uuid;
                v_code_org_id uuid;
                v_code_location_id uuid;
                v_code_expires_at timestamptz;
                v_code_used_at timestamptz;

                v_membership_id uuid;
                v_updated_rows int;
                v_seq bigint;
                v_now timestamptz := now();

                v_organization jsonb;
                v_locations jsonb;
                v_practitioners jsonb;
                v_memberships jsonb;
            BEGIN
                IF payload->>'device_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                    RAISE EXCEPTION 'register_device: device_id must be a well-formed uuid' USING ERRCODE = '22023';
                END IF;

                IF payload->>'phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'register_device: phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;

                IF payload->>'code_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'register_device: code_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'register_device: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'register_device: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                v_device_id := (payload->>'device_id')::uuid;
                v_phone := payload->>'phone';
                v_code_hash := payload->>'code_hash';

                -- Everything from here on is one generic failure on any
                -- mismatch — see this function's own doc comment (in
                -- 2026_09_12_000006_add_register_device_function.php) for
                -- why these are deliberately not distinguished.
                SELECT id, org_id, location_id, expires_at, used_at
                INTO v_code_id, v_code_org_id, v_code_location_id, v_code_expires_at, v_code_used_at
                FROM activation_codes
                WHERE code_hash = v_code_hash;

                IF NOT FOUND OR v_code_used_at IS NOT NULL OR v_code_expires_at <= v_now THEN
                    RAISE EXCEPTION 'register_device: registration failed';
                END IF;

                SELECT m.id INTO v_membership_id
                FROM memberships m
                JOIN users u ON u.id = m.user_id
                WHERE m.org_id = v_code_org_id
                  AND m.role = 'owner'
                  AND m.is_active = true
                  AND u.phone = v_phone
                LIMIT 1;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'register_device: registration failed';
                END IF;

                UPDATE activation_codes
                SET used_at = v_now
                WHERE id = v_code_id AND used_at IS NULL;

                GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
                IF v_updated_rows = 0 THEN
                    RAISE EXCEPTION 'register_device: registration failed';
                END IF;

                INSERT INTO device (id, org_id, location_id, membership_id, registered_at)
                VALUES (v_device_id, v_code_org_id, v_code_location_id, v_membership_id, v_now);

                UPDATE activation_codes
                SET used_by_device_id = v_device_id
                WHERE id = v_code_id;

                SELECT COALESCE(MAX(seq), 0) INTO v_seq FROM audit_log;

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_device_id')::uuid, v_code_org_id, v_membership_id, 'device', v_device_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_device_id, 'org_id', v_code_org_id, 'location_id', v_code_location_id,
                        'membership_id', v_membership_id, 'registered_at', v_now
                    ),
                    v_now, v_seq
                );

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_code_used_id')::uuid, v_code_org_id, v_membership_id, 'activation_codes', v_code_id, 'update',
                    jsonb_build_object('used_at', NULL, 'used_by_device_id', NULL),
                    jsonb_build_object('used_at', v_now, 'used_by_device_id', v_device_id),
                    v_now, v_seq
                );

                SELECT jsonb_build_object('id', id, 'name', name, 'plan_tier', plan_tier, 'created_at', created_at)
                INTO v_organization
                FROM organizations WHERE id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'org_id', org_id, 'name', name, 'address', address, 'phone', phone, 'is_active', is_active
                )), '[]'::jsonb)
                INTO v_locations
                FROM locations WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'org_id', org_id, 'user_id', user_id, 'full_name', full_name,
                    'specialty_id', specialty_id, 'title', title, 'is_active', is_active
                )), '[]'::jsonb)
                INTO v_practitioners
                FROM practitioners WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'user_id', user_id, 'org_id', org_id, 'role', role,
                    'location_scope', location_scope, 'practitioner_scope', practitioner_scope,
                    'practitioner_id', practitioner_id, 'pin_hash', pin_hash, 'pin_salt', pin_salt,
                    'is_active', is_active
                )), '[]'::jsonb)
                INTO v_memberships
                FROM memberships WHERE org_id = v_code_org_id;

                RETURN jsonb_build_object(
                    'device_id', v_device_id,
                    'org_id', v_code_org_id,
                    'location_id', v_code_location_id,
                    'membership_id', v_membership_id,
                    'organization', v_organization,
                    'locations', v_locations,
                    'practitioners', v_practitioners,
                    'memberships', v_memberships
                );
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION register_device(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION register_device(jsonb) TO clintra_app');
        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('SET ROLE clintra_mint');
        DB::statement('DROP FUNCTION IF EXISTS mint_activation_code(jsonb)');
        DB::statement('RESET ROLE');

        DB::statement('SET ROLE clintra_register');
        DB::statement('DROP FUNCTION IF EXISTS register_device(jsonb)');
        DB::statement('RESET ROLE');

        DB::statement('REVOKE SELECT ON locations, memberships FROM clintra_mint');
        DB::statement('REVOKE INSERT ON activation_codes FROM clintra_mint');
        DB::statement('REVOKE SELECT, INSERT ON audit_log FROM clintra_mint');

        DB::statement('REVOKE SELECT ON organizations, locations, practitioners, memberships, users FROM clintra_register');
        DB::statement('REVOKE SELECT ON activation_codes FROM clintra_register');
        DB::statement('REVOKE UPDATE (used_at, used_by_device_id) ON activation_codes FROM clintra_register');
        DB::statement('REVOKE INSERT ON device FROM clintra_register');
        DB::statement('REVOKE SELECT, INSERT ON audit_log FROM clintra_register');

        // Restore clintra_provision's pre-split footprint (both functions
        // move back under it) and recreate them from their previous
        // migrations' bodies — mirrors those migrations' own down()s.
        DB::statement('GRANT SELECT ON locations, memberships TO clintra_provision');
        DB::statement('GRANT SELECT ON organizations, locations, practitioners TO clintra_provision');
        DB::statement('GRANT SELECT, UPDATE ON activation_codes TO clintra_provision');
        DB::statement('GRANT INSERT ON device TO clintra_provision');

        DB::statement('SET ROLE clintra_provision');
        DB::statement(<<<'SQL'
            CREATE FUNCTION mint_activation_code(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY['id', 'org_id', 'location_id', 'code_hash', 'expires_at', 'audit_id'];
                v_unknown_keys text[];
                v_key text;

                v_id uuid;
                v_org_id uuid;
                v_location_id uuid;
                v_code_hash text;
                v_expires_at timestamptz;
                v_owner_membership_id uuid;
                v_seq bigint;
                v_now timestamptz := now();
            BEGIN
                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'mint_activation_code: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'mint_activation_code: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                v_org_id := (payload->>'org_id')::uuid;
                v_location_id := (payload->>'location_id')::uuid;
                v_code_hash := payload->>'code_hash';
                v_expires_at := (payload->>'expires_at')::timestamptz;

                IF v_code_hash !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'mint_activation_code: code_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF v_expires_at <= v_now THEN
                    RAISE EXCEPTION 'mint_activation_code: expires_at must be in the future' USING ERRCODE = '22023';
                END IF;

                IF NOT EXISTS (SELECT 1 FROM locations WHERE id = v_location_id AND org_id = v_org_id) THEN
                    RAISE EXCEPTION 'mint_activation_code: location_id must belong to org_id' USING ERRCODE = '22023';
                END IF;

                SELECT id INTO v_owner_membership_id
                FROM memberships
                WHERE org_id = v_org_id AND role = 'owner' AND is_active = true
                ORDER BY id
                LIMIT 1;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'mint_activation_code: org_id has no active owner membership' USING ERRCODE = '22023';
                END IF;

                v_id := (payload->>'id')::uuid;

                INSERT INTO activation_codes (id, org_id, location_id, code_hash, expires_at, used_at, used_by_device_id, created_at)
                VALUES (v_id, v_org_id, v_location_id, v_code_hash, v_expires_at, NULL, NULL, v_now);

                SELECT COALESCE(MAX(seq), 0) INTO v_seq FROM audit_log;
                v_seq := v_seq + 1;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_id')::uuid, v_org_id, v_owner_membership_id, 'activation_codes', v_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_id, 'org_id', v_org_id, 'location_id', v_location_id,
                        'expires_at', v_expires_at, 'used_at', NULL, 'used_by_device_id', NULL
                    ),
                    v_now, v_seq
                );

                RETURN jsonb_build_object('id', v_id, 'org_id', v_org_id, 'location_id', v_location_id, 'expires_at', v_expires_at);
            END;
            $$
        SQL);
        DB::statement('REVOKE EXECUTE ON FUNCTION mint_activation_code(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION mint_activation_code(jsonb) TO clintra_owner');

        DB::statement(<<<'SQL'
            CREATE FUNCTION register_device(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY['device_id', 'phone', 'code_hash', 'audit_device_id', 'audit_code_used_id'];
                v_unknown_keys text[];
                v_key text;

                v_device_id uuid;
                v_phone text;
                v_code_hash text;

                v_code_id uuid;
                v_code_org_id uuid;
                v_code_location_id uuid;
                v_code_expires_at timestamptz;
                v_code_used_at timestamptz;

                v_membership_id uuid;
                v_updated_rows int;
                v_seq bigint;
                v_now timestamptz := now();

                v_organization jsonb;
                v_locations jsonb;
                v_practitioners jsonb;
                v_memberships jsonb;
            BEGIN
                IF payload->>'device_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                    RAISE EXCEPTION 'register_device: device_id must be a well-formed uuid' USING ERRCODE = '22023';
                END IF;

                IF payload->>'phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'register_device: phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;

                IF payload->>'code_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'register_device: code_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'register_device: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'register_device: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                v_device_id := (payload->>'device_id')::uuid;
                v_phone := payload->>'phone';
                v_code_hash := payload->>'code_hash';

                SELECT id, org_id, location_id, expires_at, used_at
                INTO v_code_id, v_code_org_id, v_code_location_id, v_code_expires_at, v_code_used_at
                FROM activation_codes
                WHERE code_hash = v_code_hash;

                IF NOT FOUND OR v_code_used_at IS NOT NULL OR v_code_expires_at <= v_now THEN
                    RAISE EXCEPTION 'register_device: registration failed';
                END IF;

                SELECT m.id INTO v_membership_id
                FROM memberships m
                JOIN users u ON u.id = m.user_id
                WHERE m.org_id = v_code_org_id
                  AND m.role = 'owner'
                  AND m.is_active = true
                  AND u.phone = v_phone
                LIMIT 1;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'register_device: registration failed';
                END IF;

                UPDATE activation_codes
                SET used_at = v_now
                WHERE id = v_code_id AND used_at IS NULL;

                GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
                IF v_updated_rows = 0 THEN
                    RAISE EXCEPTION 'register_device: registration failed';
                END IF;

                INSERT INTO device (id, org_id, location_id, membership_id, registered_at)
                VALUES (v_device_id, v_code_org_id, v_code_location_id, v_membership_id, v_now);

                UPDATE activation_codes
                SET used_by_device_id = v_device_id
                WHERE id = v_code_id;

                SELECT COALESCE(MAX(seq), 0) INTO v_seq FROM audit_log;

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_device_id')::uuid, v_code_org_id, v_membership_id, 'device', v_device_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_device_id, 'org_id', v_code_org_id, 'location_id', v_code_location_id,
                        'membership_id', v_membership_id, 'registered_at', v_now
                    ),
                    v_now, v_seq
                );

                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_code_used_id')::uuid, v_code_org_id, v_membership_id, 'activation_codes', v_code_id, 'update',
                    jsonb_build_object('used_at', NULL, 'used_by_device_id', NULL),
                    jsonb_build_object('used_at', v_now, 'used_by_device_id', v_device_id),
                    v_now, v_seq
                );

                SELECT jsonb_build_object('id', id, 'name', name, 'plan_tier', plan_tier, 'created_at', created_at)
                INTO v_organization
                FROM organizations WHERE id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'org_id', org_id, 'name', name, 'address', address, 'phone', phone, 'is_active', is_active
                )), '[]'::jsonb)
                INTO v_locations
                FROM locations WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'org_id', org_id, 'user_id', user_id, 'full_name', full_name,
                    'specialty_id', specialty_id, 'title', title, 'is_active', is_active
                )), '[]'::jsonb)
                INTO v_practitioners
                FROM practitioners WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'user_id', user_id, 'org_id', org_id, 'role', role,
                    'location_scope', location_scope, 'practitioner_scope', practitioner_scope,
                    'practitioner_id', practitioner_id, 'pin_hash', pin_hash, 'pin_salt', pin_salt,
                    'is_active', is_active
                )), '[]'::jsonb)
                INTO v_memberships
                FROM memberships WHERE org_id = v_code_org_id;

                RETURN jsonb_build_object(
                    'device_id', v_device_id,
                    'org_id', v_code_org_id,
                    'location_id', v_code_location_id,
                    'membership_id', v_membership_id,
                    'organization', v_organization,
                    'locations', v_locations,
                    'practitioners', v_practitioners,
                    'memberships', v_memberships
                );
            END;
            $$
        SQL);
        DB::statement('REVOKE EXECUTE ON FUNCTION register_device(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION register_device(jsonb) TO clintra_app');
        DB::statement('RESET ROLE');
    }
};
