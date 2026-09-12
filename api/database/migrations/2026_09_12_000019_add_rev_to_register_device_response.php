<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * register_device(jsonb)'s bootstrap payload was missing two things the
 * web client actually needs once it tries to render from it, both found
 * while wiring up the real registration screen (docs/auth-plan.md):
 *
 * 1. Every membership's `rev` (2026_09_12_000012_add_row_versioning.php),
 *    even though `memberships` is one of the 14 tables that column
 *    governs. A device writing that row locally without a real rev would
 *    have to guess one, and guessing wrong means its very first edit to
 *    that membership (a PIN change, a role change) fails the server's
 *    base_rev check (SyncOpApplier::applyUpdate) as a false
 *    "conflict_stale_rev" — not a real conflict, just a client that was
 *    never told the truth at registration.
 * 2. The `users` rows a membership's `user_id` points at, entirely
 *    absent from the payload. web/src/auth/LockScreen.tsx (the PIN
 *    screen this payload exists to bootstrap in the first place),
 *    AuditSheet.tsx, DayScreen.tsx and StaffPanel.tsx all read
 *    `db.users` directly — without this, a freshly registered device's
 *    PIN picker would render membership rows with no name to label them.
 *
 * Based on the function body as 2026_09_12_000010_sequence_backed_audit_seq.php's
 * own `up()` left it (audit_log.seq is a real identity column by then —
 * every INSERT INTO audit_log omits `seq` entirely and lets Postgres
 * assign it), not the earlier v_seq-computing shape — copying from a
 * stale intermediate version here would silently regress that fix.
 * clintra_register already has SELECT on `users`
 * (2026_09_12_000009_split_provisioning_roles.php) — granted for the
 * phone-match join this function already does, just never used to
 * return the rows themselves until now.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('SET ROLE clintra_register');

        DB::statement('DROP FUNCTION IF EXISTS register_device(jsonb)');
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

                INSERT INTO device (id, org_id, location_id, membership_id, registered_at)
                VALUES (v_device_id, v_code_org_id, v_code_location_id, v_membership_id, v_now);

                UPDATE activation_codes
                SET used_by_device_id = v_device_id
                WHERE id = v_code_id;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_device_id')::uuid, v_code_org_id, v_membership_id, 'device', v_device_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_device_id, 'org_id', v_code_org_id, 'location_id', v_code_location_id,
                        'membership_id', v_membership_id, 'registered_at', v_now
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
                    'specialty_id', specialty_id, 'title', title, 'is_active', is_active
                )), '[]'::jsonb)
                INTO v_practitioners
                FROM practitioners WHERE org_id = v_code_org_id;

                -- rev added here — the one field this bootstrap forgot,
                -- see this migration's own doc comment above.
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'user_id', user_id, 'org_id', org_id, 'role', role,
                    'location_scope', location_scope, 'practitioner_scope', practitioner_scope,
                    'practitioner_id', practitioner_id, 'pin_hash', pin_hash, 'pin_salt', pin_salt,
                    'is_active', is_active, 'rev', rev
                )), '[]'::jsonb)
                INTO v_memberships
                FROM memberships WHERE org_id = v_code_org_id;

                -- users added here too — every user referenced by one of
                -- the memberships above, see this migration's own doc
                -- comment above.
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
    }

    public function down(): void
    {
        // Restores the function body exactly as
        // 2026_09_12_000010_sequence_backed_audit_seq.php's own up() left
        // it (no rev in the memberships payload).
        DB::statement('SET ROLE clintra_register');

        DB::statement('DROP FUNCTION IF EXISTS register_device(jsonb)');
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

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_device_id')::uuid, v_code_org_id, v_membership_id, 'device', v_device_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_device_id, 'org_id', v_code_org_id, 'location_id', v_code_location_id,
                        'membership_id', v_membership_id, 'registered_at', v_now
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
