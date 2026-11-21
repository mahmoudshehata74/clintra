<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE organizations ADD COLUMN disabled_at timestamptz NULL');
        DB::statement('ALTER TABLE organizations ADD COLUMN disabled_reason varchar(200) NULL');
        DB::statement('ALTER TABLE organizations ADD CONSTRAINT organizations_disabled_reason CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL))');
        DB::statement('GRANT SELECT (id, disabled_at) ON organizations TO clintra_rls');
        DB::statement('GRANT SELECT (id, disabled_at, disabled_reason) ON organizations TO clintra_provision');
        DB::statement('GRANT UPDATE (disabled_at, disabled_reason) ON organizations TO clintra_provision');
        DB::statement('GRANT SELECT (id, org_id, role, is_active) ON memberships TO clintra_provision');
        DB::statement('DROP FUNCTION IF EXISTS set_organization_disabled(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS device_org_disabled(uuid)');
        DB::statement('SET ROLE clintra_rls');
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION current_org() RETURNS uuid
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT m.org_id FROM memberships m JOIN organizations o ON o.id = m.org_id
                WHERE m.id = current_membership() AND m.is_active AND o.disabled_at IS NULL
            $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE FUNCTION device_org_disabled(p_device uuid) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT EXISTS (
                    SELECT 1 FROM device d JOIN organizations o ON o.id = d.org_id
                    JOIN memberships m ON m.org_id = d.org_id AND m.id = current_membership() AND m.is_active
                    WHERE d.id = p_device AND d.revoked_at IS NULL AND o.disabled_at IS NOT NULL
                )
            $$
        SQL);
        DB::statement('REVOKE EXECUTE ON FUNCTION device_org_disabled(uuid) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION device_org_disabled(uuid) TO clintra_app');
        DB::statement('RESET ROLE');
        DB::statement('SET ROLE clintra_provision');
        DB::statement(<<<'SQL'
            CREATE FUNCTION set_organization_disabled(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
            DECLARE
                v_org organizations%ROWTYPE;
                v_reason text := NULLIF(btrim(p->>'reason'), '');
                v_at timestamptz;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) IS DISTINCT FROM
                        ARRAY['actor_membership_id', 'audit_id', 'disabled', 'org_id', 'reason']
                    OR jsonb_typeof(p->'disabled') IS DISTINCT FROM 'boolean'
                    OR jsonb_typeof(p->'org_id') IS DISTINCT FROM 'string'
                    OR jsonb_typeof(p->'actor_membership_id') IS DISTINCT FROM 'string'
                    OR jsonb_typeof(p->'audit_id') IS DISTINCT FROM 'string'
                    OR (p->'reason' <> 'null'::jsonb AND jsonb_typeof(p->'reason') <> 'string')
                    OR ((p->>'disabled')::boolean AND (v_reason IS NULL OR char_length(v_reason) > 200)) THEN
                    RAISE EXCEPTION 'set_organization_disabled: invalid payload' USING ERRCODE = '22023';
                END IF;
                PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:' || (p->>'org_id')::uuid::text, 0));
                SELECT id, disabled_at, disabled_reason INTO v_org.id, v_org.disabled_at, v_org.disabled_reason
                FROM organizations WHERE id = (p->>'org_id')::uuid FOR UPDATE;
                IF v_org.id IS NULL OR NOT EXISTS (
                    SELECT 1 FROM memberships WHERE id = (p->>'actor_membership_id')::uuid
                      AND org_id = v_org.id AND role = 'owner' AND is_active
                ) THEN
                    RAISE EXCEPTION 'set_organization_disabled: not allowed';
                END IF;
                IF (v_org.disabled_at IS NOT NULL) = (p->>'disabled')::boolean THEN
                    RETURN jsonb_build_object('changed', false, 'disabled_at', v_org.disabled_at);
                END IF;
                v_at := CASE WHEN (p->>'disabled')::boolean THEN now() END;
                UPDATE organizations SET disabled_at = v_at,
                    disabled_reason = CASE WHEN v_at IS NOT NULL THEN v_reason END WHERE id = v_org.id;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_org.id, (p->>'actor_membership_id')::uuid, 'organizations', v_org.id, 'update',
                    jsonb_build_object('disabled_at', v_org.disabled_at, 'disabled_reason', v_org.disabled_reason),
                    jsonb_build_object('disabled_at', v_at, 'disabled_reason', CASE WHEN v_at IS NOT NULL THEN v_reason END,
                        'source', 'cli'), now());
                RETURN jsonb_build_object('changed', true, 'disabled_at', v_at);
            END;
            $$
        SQL);
        DB::statement('REVOKE EXECUTE ON FUNCTION set_organization_disabled(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION set_organization_disabled(jsonb) TO clintra_owner');
        DB::statement('RESET ROLE');
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
                v_enforced_at timestamptz;
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

                -- Match organization suspension to sync's transaction lock.
                PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:' || v_code_org_id::text, 0));
                IF EXISTS (SELECT 1 FROM organizations WHERE id = v_code_org_id AND disabled_at IS NOT NULL) THEN
                    RAISE EXCEPTION 'register_device: organization disabled' USING ERRCODE = 'CL403';
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

                SELECT identity_enforced_at INTO v_enforced_at FROM organizations WHERE id = v_code_org_id;

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
                    'practitioner_id', practitioner_id,
                    'is_active', is_active, 'rev', rev, 'display_name', display_name
                ) || CASE WHEN v_enforced_at IS NULL THEN jsonb_build_object('pin_hash', pin_hash, 'pin_salt', pin_salt)
                          ELSE jsonb_build_object('username', username, 'permissions', to_jsonb(permissions)) END), '[]'::jsonb)
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
                ) || CASE WHEN v_enforced_at IS NOT NULL THEN jsonb_build_object('identity_enforced_at', v_enforced_at)
                          ELSE '{}'::jsonb END;
            END;
            $$
        SQL);
        DB::statement('REVOKE EXECUTE ON FUNCTION register_device(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION register_device(jsonb) TO clintra_app');
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
                v_enforced_at timestamptz;
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

                SELECT identity_enforced_at INTO v_enforced_at FROM organizations WHERE id = v_code_org_id;

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
                    'practitioner_id', practitioner_id,
                    'is_active', is_active, 'rev', rev, 'display_name', display_name
                ) || CASE WHEN v_enforced_at IS NULL THEN jsonb_build_object('pin_hash', pin_hash, 'pin_salt', pin_salt)
                          ELSE jsonb_build_object('username', username, 'permissions', to_jsonb(permissions)) END), '[]'::jsonb)
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
                ) || CASE WHEN v_enforced_at IS NOT NULL THEN jsonb_build_object('identity_enforced_at', v_enforced_at)
                          ELSE '{}'::jsonb END;
            END;
            $$
        SQL);
        DB::statement('REVOKE EXECUTE ON FUNCTION register_device(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION register_device(jsonb) TO clintra_app');
        DB::statement('RESET ROLE');
        DB::statement('DROP FUNCTION IF EXISTS set_organization_disabled(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS device_org_disabled(uuid)');
        DB::statement('SET ROLE clintra_rls');
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION current_org() RETURNS uuid
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT org_id FROM memberships
                WHERE id = current_membership() AND is_active = true
            $$
        SQL);
        DB::statement('RESET ROLE');
        DB::statement('REVOKE SELECT (id, org_id, role, is_active) ON memberships FROM clintra_provision');
        DB::statement('REVOKE UPDATE (disabled_at, disabled_reason) ON organizations FROM clintra_provision');
        DB::statement('REVOKE SELECT (id, disabled_at, disabled_reason) ON organizations FROM clintra_provision');
        DB::statement('REVOKE SELECT (id, disabled_at) ON organizations FROM clintra_rls');
        DB::statement('ALTER TABLE organizations DROP CONSTRAINT organizations_disabled_reason');
        DB::statement('ALTER TABLE organizations DROP COLUMN disabled_reason');
        DB::statement('ALTER TABLE organizations DROP COLUMN disabled_at');
    }
};
