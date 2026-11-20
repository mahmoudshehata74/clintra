<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Identity phase A1: what an activation code is for
 * (docs/design-identity-permissions.md, 6.2, and "A1 decisions", 5).
 *
 * - register_device(jsonb) finds only a code minted for a device
 *   (`AND purpose = 'device'`), so an owner-recovery code never registers a
 *   device. Otherwise byte-for-byte the body
 *   2026_09_12_000033_add_display_name_to_register_device.php left.
 *   clintra_register's SELECT on activation_codes is table-level, so it
 *   already covers the new column.
 * - mint_activation_code(jsonb) takes an optional `purpose` ('device' or
 *   'owner_recovery'; absent means 'device', so a payload without it mints
 *   exactly what it did before). An owner-recovery code expires within 24
 *   hours; its audit row and result name its purpose. Otherwise byte-for-byte
 *   the body 2026_09_12_000010_sequence_backed_audit_seq.php left.
 *   clintra_mint's INSERT on activation_codes is table-level.
 *
 * Both DROPs run as clintra_owner before SET ROLE (api/docs/rls.md's
 * "migrate:fresh is idempotent").
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS register_device(jsonb)');

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
                v_series smallint;
                v_updated_rows int;
                v_now timestamptz := now();

                v_organization jsonb;
                v_locations jsonb;
                v_practitioners jsonb;
                v_memberships jsonb;
                v_users jsonb;
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
                WHERE code_hash = v_code_hash AND purpose = 'device';

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

                -- The next series at this location: max + 1 across every
                -- device ever registered there, revoked ones included, so a
                -- number is never handed out twice. Serialised per location
                -- by a transaction-scoped advisory lock, held until this
                -- transaction commits or rolls back, so two concurrent
                -- registrations at one location can never read the same max.
                -- An advisory lock rather than a row lock: locking the
                -- locations row FOR UPDATE would need UPDATE on locations,
                -- which clintra_register deliberately does not hold, and an
                -- advisory lock needs no grant at all. Two different
                -- locations whose keys collide in the hash only queue behind
                -- each other briefly; device_location_id_series_unique is the
                -- backstop that makes a wrong number impossible either way.
                PERFORM pg_advisory_xact_lock(hashtextextended('device_series:' || v_code_location_id::text, 0));

                SELECT COALESCE(MAX(series), 0) + 1 INTO v_series
                FROM device
                WHERE location_id = v_code_location_id;

                INSERT INTO device (id, org_id, location_id, membership_id, registered_at, series)
                VALUES (v_device_id, v_code_org_id, v_code_location_id, v_membership_id, v_now, v_series);

                UPDATE activation_codes
                SET used_by_device_id = v_device_id
                WHERE id = v_code_id;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_device_id')::uuid, v_code_org_id, v_membership_id, 'device', v_device_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_device_id, 'org_id', v_code_org_id, 'location_id', v_code_location_id,
                        'membership_id', v_membership_id, 'registered_at', v_now, 'series', v_series
                    ),
                    v_now
                );

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_code_used_id')::uuid, v_code_org_id, v_membership_id, 'activation_codes', v_code_id, 'update',
                    jsonb_build_object('used_at', NULL, 'used_by_device_id', NULL),
                    jsonb_build_object('used_at', v_now, 'used_by_device_id', v_device_id),
                    v_now
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
                    'specialty_id', specialty_id, 'title', title, 'is_active', is_active,
                    'syndicate_number', syndicate_number, 'rev', rev
                )), '[]'::jsonb)
                INTO v_practitioners
                FROM practitioners WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'user_id', user_id, 'org_id', org_id, 'role', role,
                    'location_scope', location_scope, 'practitioner_scope', practitioner_scope,
                    'practitioner_id', practitioner_id, 'pin_hash', pin_hash, 'pin_salt', pin_salt,
                    'is_active', is_active, 'rev', rev, 'display_name', display_name
                )), '[]'::jsonb)
                INTO v_memberships
                FROM memberships WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', u.id, 'full_name', u.full_name, 'phone', u.phone,
                    'email', u.email, 'is_active', u.is_active
                )), '[]'::jsonb)
                INTO v_users
                FROM users u
                WHERE u.id IN (SELECT user_id FROM memberships WHERE org_id = v_code_org_id);

                RETURN jsonb_build_object(
                    'device_id', v_device_id,
                    'org_id', v_code_org_id,
                    'location_id', v_code_location_id,
                    'membership_id', v_membership_id,
                    'series', v_series,
                    'organization', v_organization,
                    'locations', v_locations,
                    'practitioners', v_practitioners,
                    'memberships', v_memberships,
                    'users', v_users
                );
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION register_device(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION register_device(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');

        DB::statement('DROP FUNCTION IF EXISTS mint_activation_code(jsonb)');

        DB::statement('SET ROLE clintra_mint');

        DB::statement(<<<'SQL'
            CREATE FUNCTION mint_activation_code(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY['id', 'org_id', 'location_id', 'code_hash', 'expires_at', 'audit_id', 'purpose'];
                v_required_keys text[] := ARRAY['id', 'org_id', 'location_id', 'code_hash', 'expires_at', 'audit_id'];
                v_unknown_keys text[];
                v_key text;

                v_id uuid;
                v_org_id uuid;
                v_location_id uuid;
                v_code_hash text;
                v_expires_at timestamptz;
                v_purpose text;
                v_owner_membership_id uuid;
                v_now timestamptz := now();
            BEGIN
                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'mint_activation_code: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_required_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'mint_activation_code: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                -- purpose is optional: absent, the code registers a device,
                -- exactly as before it existed.
                IF jsonb_exists(payload, 'purpose')
                    AND (jsonb_typeof(payload -> 'purpose') IS DISTINCT FROM 'string'
                         OR payload->>'purpose' NOT IN ('device', 'owner_recovery')) THEN
                    RAISE EXCEPTION 'mint_activation_code: purpose must be device or owner_recovery' USING ERRCODE = '22023';
                END IF;
                v_purpose := COALESCE(payload->>'purpose', 'device');

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

                IF v_purpose = 'owner_recovery' AND v_expires_at > v_now + interval '24 hours' THEN
                    RAISE EXCEPTION 'mint_activation_code: an owner-recovery code expires within 24 hours' USING ERRCODE = '22023';
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

                INSERT INTO activation_codes (id, org_id, location_id, code_hash, expires_at, used_at, used_by_device_id, created_at, purpose)
                VALUES (v_id, v_org_id, v_location_id, v_code_hash, v_expires_at, NULL, NULL, v_now, v_purpose);

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_id')::uuid, v_org_id, v_owner_membership_id, 'activation_codes', v_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_id, 'org_id', v_org_id, 'location_id', v_location_id,
                        'expires_at', v_expires_at, 'used_at', NULL, 'used_by_device_id', NULL
                    ) || CASE WHEN v_purpose = 'owner_recovery' THEN jsonb_build_object('purpose', v_purpose) ELSE '{}'::jsonb END,
                    v_now
                );

                RETURN jsonb_build_object('id', v_id, 'org_id', v_org_id, 'location_id', v_location_id, 'expires_at', v_expires_at)
                    || CASE WHEN v_purpose = 'owner_recovery' THEN jsonb_build_object('purpose', v_purpose) ELSE '{}'::jsonb END;
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION mint_activation_code(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION mint_activation_code(jsonb) TO clintra_owner');

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS register_device(jsonb)');

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
                v_series smallint;
                v_updated_rows int;
                v_now timestamptz := now();

                v_organization jsonb;
                v_locations jsonb;
                v_practitioners jsonb;
                v_memberships jsonb;
                v_users jsonb;
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

                -- The next series at this location: max + 1 across every
                -- device ever registered there, revoked ones included, so a
                -- number is never handed out twice. Serialised per location
                -- by a transaction-scoped advisory lock, held until this
                -- transaction commits or rolls back, so two concurrent
                -- registrations at one location can never read the same max.
                -- An advisory lock rather than a row lock: locking the
                -- locations row FOR UPDATE would need UPDATE on locations,
                -- which clintra_register deliberately does not hold, and an
                -- advisory lock needs no grant at all. Two different
                -- locations whose keys collide in the hash only queue behind
                -- each other briefly; device_location_id_series_unique is the
                -- backstop that makes a wrong number impossible either way.
                PERFORM pg_advisory_xact_lock(hashtextextended('device_series:' || v_code_location_id::text, 0));

                SELECT COALESCE(MAX(series), 0) + 1 INTO v_series
                FROM device
                WHERE location_id = v_code_location_id;

                INSERT INTO device (id, org_id, location_id, membership_id, registered_at, series)
                VALUES (v_device_id, v_code_org_id, v_code_location_id, v_membership_id, v_now, v_series);

                UPDATE activation_codes
                SET used_by_device_id = v_device_id
                WHERE id = v_code_id;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_device_id')::uuid, v_code_org_id, v_membership_id, 'device', v_device_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_device_id, 'org_id', v_code_org_id, 'location_id', v_code_location_id,
                        'membership_id', v_membership_id, 'registered_at', v_now, 'series', v_series
                    ),
                    v_now
                );

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_code_used_id')::uuid, v_code_org_id, v_membership_id, 'activation_codes', v_code_id, 'update',
                    jsonb_build_object('used_at', NULL, 'used_by_device_id', NULL),
                    jsonb_build_object('used_at', v_now, 'used_by_device_id', v_device_id),
                    v_now
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
                    'specialty_id', specialty_id, 'title', title, 'is_active', is_active,
                    'syndicate_number', syndicate_number, 'rev', rev
                )), '[]'::jsonb)
                INTO v_practitioners
                FROM practitioners WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'user_id', user_id, 'org_id', org_id, 'role', role,
                    'location_scope', location_scope, 'practitioner_scope', practitioner_scope,
                    'practitioner_id', practitioner_id, 'pin_hash', pin_hash, 'pin_salt', pin_salt,
                    'is_active', is_active, 'rev', rev, 'display_name', display_name
                )), '[]'::jsonb)
                INTO v_memberships
                FROM memberships WHERE org_id = v_code_org_id;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', u.id, 'full_name', u.full_name, 'phone', u.phone,
                    'email', u.email, 'is_active', u.is_active
                )), '[]'::jsonb)
                INTO v_users
                FROM users u
                WHERE u.id IN (SELECT user_id FROM memberships WHERE org_id = v_code_org_id);

                RETURN jsonb_build_object(
                    'device_id', v_device_id,
                    'org_id', v_code_org_id,
                    'location_id', v_code_location_id,
                    'membership_id', v_membership_id,
                    'series', v_series,
                    'organization', v_organization,
                    'locations', v_locations,
                    'practitioners', v_practitioners,
                    'memberships', v_memberships,
                    'users', v_users
                );
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION register_device(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION register_device(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');

        DB::statement('DROP FUNCTION IF EXISTS mint_activation_code(jsonb)');

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

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_id')::uuid, v_org_id, v_owner_membership_id, 'activation_codes', v_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_id, 'org_id', v_org_id, 'location_id', v_location_id,
                        'expires_at', v_expires_at, 'used_at', NULL, 'used_by_device_id', NULL
                    ),
                    v_now
                );

                RETURN jsonb_build_object('id', v_id, 'org_id', v_org_id, 'location_id', v_location_id, 'expires_at', v_expires_at);
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION mint_activation_code(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION mint_activation_code(jsonb) TO clintra_owner');

        DB::statement('RESET ROLE');
    }
};
