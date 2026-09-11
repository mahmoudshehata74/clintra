<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The other bootstrapping door alongside provision_organization(jsonb) —
 * see api/docs/rls.md's "Provisioning: the one door into an empty
 * database". A device registering has no membership yet, so it cannot
 * read or write anything through the ordinary RLS-bound clintra_app
 * connection: not the activation code it's presenting, not the org it's
 * about to join, nothing. register_device(jsonb) is SECURITY DEFINER,
 * owned by clintra_provision (BYPASSRLS), same as provisioning — but
 * EXECUTE is granted to clintra_app, not clintra_owner, because this one
 * is called from a live, unauthenticated HTTP request
 * (POST /api/devices/register), never from a CLI command on the
 * pgsql_owner connection.
 *
 * Credential verification only ever produces ONE outcome on failure — a
 * generic exception, regardless of whether the code was wrong, expired,
 * already used, or the phone didn't match an active owner membership in
 * that code's org. App\Http\Controllers\DeviceRegistrationController
 * catches it and returns one fixed, generic HTTP response; SQLSTATE isn't
 * differentiated here the way provision_organization's validation errors
 * are, because nothing downstream needs to tell these cases apart —
 * telling them apart is exactly what an attacker probing this endpoint
 * would use. Payload *shape* problems (not a real phone, not real hex,
 * not a real uuid) are instead caught by a Laravel FormRequest before
 * this function is ever called, producing a 422 — a shape problem is the
 * caller's bug, not a credential-guessing signal, so it's fine to be
 * specific about those.
 */
return new class extends Migration
{
    public function up(): void
    {
        // organizations/locations/practitioners: read to assemble the
        // bootstrap payload the response returns. activation_codes: read
        // to verify, update to mark used. users: read to match the
        // submitted phone. memberships: already granted SELECT (mint
        // migration) — also needed here for the same phone-match join and
        // to build the bootstrap memberships list. device: insert the new
        // row.
        DB::statement('GRANT SELECT ON organizations, locations, practitioners TO clintra_provision');
        DB::statement('GRANT SELECT, UPDATE ON activation_codes TO clintra_provision');
        DB::statement('GRANT INSERT ON device TO clintra_provision');

        DB::statement('SET ROLE clintra_provision');

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
                v_seq bigint;
                v_now timestamptz := now();

                v_organization jsonb;
                v_locations jsonb;
                v_practitioners jsonb;
                v_memberships jsonb;
            BEGIN
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
                -- mismatch — see this migration's own doc comment for why
                -- these are deliberately not distinguished.
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

                -- Atomic single-use: the WHERE used_at IS NULL means a
                -- second, concurrent request racing on the same code
                -- updates zero rows here even if it passed every check
                -- above, because this UPDATE is what actually claims the
                -- code — not the earlier SELECT. used_by_device_id isn't
                -- set until after the device row exists below (it's a
                -- foreign key to device.id, which doesn't exist yet) —
                -- the claim itself only needs used_at.
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

                -- The bootstrap payload: everything the device needs to
                -- reach the PIN screen offline, including every
                -- membership's pin_hash/pin_salt. This is the one moment
                -- those cross the wire at all — see docs/auth-plan.md's
                -- registration credential resolution.
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
        DB::statement('SET ROLE clintra_provision');
        DB::statement('DROP FUNCTION IF EXISTS register_device(jsonb)');
        DB::statement('RESET ROLE');

        DB::statement('REVOKE SELECT ON organizations, locations, practitioners FROM clintra_provision');
        DB::statement('REVOKE SELECT, UPDATE ON activation_codes FROM clintra_provision');
        DB::statement('REVOKE INSERT ON device FROM clintra_provision');
    }
};
