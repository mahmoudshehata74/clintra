<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Extends provision_organization(jsonb) to also mint the organization's
 * first activation_codes row, atomically with everything else it creates —
 * "clintra:provision generates one and prints it once" (docs/auth-plan.md's
 * registration credential resolution). The plaintext code itself is
 * generated and shown to the installer entirely in PHP
 * (App\Console\Commands\ProvisionOrganization); this function only ever
 * receives and stores its SHA-256 hash, same as every other secret it
 * handles (pin_hash/pin_salt).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('GRANT INSERT ON activation_codes TO clintra_provision');

        DB::statement('SET ROLE clintra_provision');

        DB::statement('DROP FUNCTION IF EXISTS provision_organization(jsonb)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION provision_organization(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY[
                    'org_id', 'org_name', 'plan_tier',
                    'location_id', 'location_name', 'location_address', 'location_phone', 'location_org_id',
                    'user_id', 'user_full_name', 'user_phone',
                    'practitioner_id', 'practitioner_title', 'practitioner_org_id', 'specialty_id',
                    'practitioner_location_id',
                    'membership_id', 'membership_org_id', 'role', 'location_scope', 'practitioner_scope',
                    'pin_hash', 'pin_salt',
                    'activation_code_id', 'activation_code_hash', 'activation_code_expires_at',
                    'audit_organization_id', 'audit_location_id', 'audit_user_id', 'audit_practitioner_id',
                    'audit_practitioner_location_id', 'audit_membership_id', 'audit_activation_code_id'
                ];
                v_unknown_keys text[];
                v_key text;

                v_org_id uuid;
                v_org_name text;
                v_plan_tier text;
                v_location_id uuid;
                v_location_name text;
                v_location_address text;
                v_location_phone text;
                v_user_id uuid;
                v_user_full_name text;
                v_user_phone text;
                v_user_is_new boolean := true;
                v_existing_user_id uuid;
                v_practitioner_id uuid;
                v_practitioner_title text;
                v_specialty_id uuid;
                v_practitioner_location_id uuid;
                v_membership_id uuid;
                v_pin_hash text;
                v_pin_salt text;
                v_activation_code_id uuid;
                v_activation_code_hash text;
                v_activation_code_expires_at timestamptz;
                v_seq bigint;
                v_now timestamptz := now();
            BEGIN
                -- 1. No unknown keys — reject, don't ignore.
                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'provision_organization: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                -- 2. Every key present and non-null.
                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'provision_organization: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                -- 3. Fixed invariants for the membership this function creates.
                IF payload->>'role' <> 'owner' THEN
                    RAISE EXCEPTION 'provision_organization: role must be "owner"' USING ERRCODE = '22023';
                END IF;
                IF payload->>'location_scope' <> 'all' THEN
                    RAISE EXCEPTION 'provision_organization: location_scope must be "all"' USING ERRCODE = '22023';
                END IF;
                IF payload->>'practitioner_scope' <> 'all' THEN
                    RAISE EXCEPTION 'provision_organization: practitioner_scope must be "all"' USING ERRCODE = '22023';
                END IF;

                -- 4. pin_hash/pin_salt shape — contract/pin-hash.json's Argon2id.
                IF payload->>'pin_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'provision_organization: pin_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;
                IF payload->>'pin_salt' !~ '^[0-9a-f]{32}$' THEN
                    RAISE EXCEPTION 'provision_organization: pin_salt must be 32 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                -- 4b. activation_code_hash shape — SHA-256 hex (64 chars,
                -- same length as pin_hash but a different KDF entirely; see
                -- activation_codes' own migration comment for why).
                IF payload->>'activation_code_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'provision_organization: activation_code_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                -- 5. Phones: non-empty, E.164.
                IF payload->>'location_phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'provision_organization: location_phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;
                IF payload->>'user_phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'provision_organization: user_phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;

                -- 6. specialty_id must reference a real, system-wide template.
                IF NOT EXISTS (
                    SELECT 1 FROM specialty_templates
                    WHERE id = (payload->>'specialty_id')::uuid AND org_id IS NULL
                ) THEN
                    RAISE EXCEPTION 'provision_organization: specialty_id must reference an existing system-wide specialty_templates row' USING ERRCODE = '22023';
                END IF;

                v_org_id := (payload->>'org_id')::uuid;

                -- 7. No cross-org smuggling.
                IF (payload->>'location_org_id')::uuid <> v_org_id
                    OR (payload->>'practitioner_org_id')::uuid <> v_org_id
                    OR (payload->>'membership_org_id')::uuid <> v_org_id
                THEN
                    RAISE EXCEPTION 'provision_organization: location_org_id, practitioner_org_id and membership_org_id must all equal org_id' USING ERRCODE = '22023';
                END IF;

                -- 8. The activation code must actually still be usable by
                -- the time this transaction commits — reject a caller that
                -- built one already expired.
                v_activation_code_expires_at := (payload->>'activation_code_expires_at')::timestamptz;
                IF v_activation_code_expires_at <= v_now THEN
                    RAISE EXCEPTION 'provision_organization: activation_code_expires_at must be in the future' USING ERRCODE = '22023';
                END IF;

                -- Validation passed — now safe to read every value for real.
                v_org_name := payload->>'org_name';
                v_plan_tier := payload->>'plan_tier';
                v_location_id := (payload->>'location_id')::uuid;
                v_location_name := payload->>'location_name';
                v_location_address := payload->>'location_address';
                v_location_phone := payload->>'location_phone';
                v_user_full_name := payload->>'user_full_name';
                v_user_phone := payload->>'user_phone';
                v_practitioner_id := (payload->>'practitioner_id')::uuid;
                v_practitioner_title := payload->>'practitioner_title';
                v_specialty_id := (payload->>'specialty_id')::uuid;
                v_practitioner_location_id := (payload->>'practitioner_location_id')::uuid;
                v_membership_id := (payload->>'membership_id')::uuid;
                v_pin_hash := payload->>'pin_hash';
                v_pin_salt := payload->>'pin_salt';
                v_activation_code_id := (payload->>'activation_code_id')::uuid;
                v_activation_code_hash := payload->>'activation_code_hash';

                INSERT INTO organizations (id, name, plan_tier, created_at)
                VALUES (v_org_id, v_org_name, v_plan_tier, v_now);

                INSERT INTO locations (id, org_id, name, address, phone, is_active)
                VALUES (v_location_id, v_org_id, v_location_name, v_location_address, v_location_phone, true);

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

                INSERT INTO memberships (
                    id, user_id, org_id, role, location_scope, practitioner_scope,
                    practitioner_id, pin_hash, pin_salt, is_active
                )
                VALUES (
                    v_membership_id, v_user_id, v_org_id,
                    'owner', 'all', 'all', NULL,
                    v_pin_hash, v_pin_salt, true
                );

                INSERT INTO activation_codes (id, org_id, location_id, code_hash, expires_at, used_at, used_by_device_id, created_at)
                VALUES (v_activation_code_id, v_org_id, v_location_id, v_activation_code_hash, v_activation_code_expires_at, NULL, NULL, v_now);

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

                -- pin_hash/pin_salt deliberately excluded — see the original
                -- provisioning migration's comment.
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

                -- code_hash deliberately excluded from this snapshot for the
                -- same reason pin_hash is: no legitimate reader of the audit
                -- sheet needs the activation secret, hashed or not.
                v_seq := v_seq + 1;
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_activation_code_id')::uuid, v_org_id, v_membership_id, 'activation_codes', v_activation_code_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_activation_code_id, 'org_id', v_org_id, 'location_id', v_location_id,
                        'expires_at', v_activation_code_expires_at, 'used_at', NULL, 'used_by_device_id', NULL
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
                    'membership_id', v_membership_id,
                    'activation_code_id', v_activation_code_id
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
        // Restores the pre-activation-code function body exactly as
        // 2026_09_12_000001_validate_provision_organization_payload.php
        // created it.
        DB::statement('SET ROLE clintra_provision');

        DB::statement('DROP FUNCTION IF EXISTS provision_organization(jsonb)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION provision_organization(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY[
                    'org_id', 'org_name', 'plan_tier',
                    'location_id', 'location_name', 'location_address', 'location_phone', 'location_org_id',
                    'user_id', 'user_full_name', 'user_phone',
                    'practitioner_id', 'practitioner_title', 'practitioner_org_id', 'specialty_id',
                    'practitioner_location_id',
                    'membership_id', 'membership_org_id', 'role', 'location_scope', 'practitioner_scope',
                    'pin_hash', 'pin_salt',
                    'audit_organization_id', 'audit_location_id', 'audit_user_id', 'audit_practitioner_id',
                    'audit_practitioner_location_id', 'audit_membership_id'
                ];
                v_unknown_keys text[];
                v_key text;

                v_org_id uuid;
                v_org_name text;
                v_plan_tier text;
                v_location_id uuid;
                v_location_name text;
                v_location_address text;
                v_location_phone text;
                v_user_id uuid;
                v_user_full_name text;
                v_user_phone text;
                v_user_is_new boolean := true;
                v_existing_user_id uuid;
                v_practitioner_id uuid;
                v_practitioner_title text;
                v_specialty_id uuid;
                v_practitioner_location_id uuid;
                v_membership_id uuid;
                v_pin_hash text;
                v_pin_salt text;
                v_seq bigint;
                v_now timestamptz := now();
            BEGIN
                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'provision_organization: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'provision_organization: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                IF payload->>'role' <> 'owner' THEN
                    RAISE EXCEPTION 'provision_organization: role must be "owner"' USING ERRCODE = '22023';
                END IF;
                IF payload->>'location_scope' <> 'all' THEN
                    RAISE EXCEPTION 'provision_organization: location_scope must be "all"' USING ERRCODE = '22023';
                END IF;
                IF payload->>'practitioner_scope' <> 'all' THEN
                    RAISE EXCEPTION 'provision_organization: practitioner_scope must be "all"' USING ERRCODE = '22023';
                END IF;

                IF payload->>'pin_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'provision_organization: pin_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;
                IF payload->>'pin_salt' !~ '^[0-9a-f]{32}$' THEN
                    RAISE EXCEPTION 'provision_organization: pin_salt must be 32 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF payload->>'location_phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'provision_organization: location_phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;
                IF payload->>'user_phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'provision_organization: user_phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM specialty_templates
                    WHERE id = (payload->>'specialty_id')::uuid AND org_id IS NULL
                ) THEN
                    RAISE EXCEPTION 'provision_organization: specialty_id must reference an existing system-wide specialty_templates row' USING ERRCODE = '22023';
                END IF;

                v_org_id := (payload->>'org_id')::uuid;

                IF (payload->>'location_org_id')::uuid <> v_org_id
                    OR (payload->>'practitioner_org_id')::uuid <> v_org_id
                    OR (payload->>'membership_org_id')::uuid <> v_org_id
                THEN
                    RAISE EXCEPTION 'provision_organization: location_org_id, practitioner_org_id and membership_org_id must all equal org_id' USING ERRCODE = '22023';
                END IF;

                v_org_name := payload->>'org_name';
                v_plan_tier := payload->>'plan_tier';
                v_location_id := (payload->>'location_id')::uuid;
                v_location_name := payload->>'location_name';
                v_location_address := payload->>'location_address';
                v_location_phone := payload->>'location_phone';
                v_user_full_name := payload->>'user_full_name';
                v_user_phone := payload->>'user_phone';
                v_practitioner_id := (payload->>'practitioner_id')::uuid;
                v_practitioner_title := payload->>'practitioner_title';
                v_specialty_id := (payload->>'specialty_id')::uuid;
                v_practitioner_location_id := (payload->>'practitioner_location_id')::uuid;
                v_membership_id := (payload->>'membership_id')::uuid;
                v_pin_hash := payload->>'pin_hash';
                v_pin_salt := payload->>'pin_salt';

                INSERT INTO organizations (id, name, plan_tier, created_at)
                VALUES (v_org_id, v_org_name, v_plan_tier, v_now);

                INSERT INTO locations (id, org_id, name, address, phone, is_active)
                VALUES (v_location_id, v_org_id, v_location_name, v_location_address, v_location_phone, true);

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

                INSERT INTO memberships (
                    id, user_id, org_id, role, location_scope, practitioner_scope,
                    practitioner_id, pin_hash, pin_salt, is_active
                )
                VALUES (
                    v_membership_id, v_user_id, v_org_id,
                    'owner', 'all', 'all', NULL,
                    v_pin_hash, v_pin_salt, true
                );

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

        DB::statement('REVOKE INSERT ON activation_codes FROM clintra_provision');
    }
};
