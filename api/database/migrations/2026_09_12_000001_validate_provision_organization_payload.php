<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * provision_organization(jsonb) is the one BYPASSRLS function in this
 * schema — App\Console\Commands\ProvisionOrganization was the only thing
 * validating its payload, which means the function trusted its caller
 * completely. A function with BYPASSRLS must not trust its caller: this
 * migration replaces the function body with the same logic, now preceded
 * by exhaustive validation that raises before any write touches a table.
 *
 * Every check uses SQLSTATE 22023 (invalid_parameter_value) so callers —
 * and tests — can assert on it specifically, distinct from RLS's 42501 or
 * a genuine constraint violation.
 *
 * Two invariants that were previously hardcoded literals inside the
 * function (role/location_scope/practitioner_scope always 'owner'/'all'/
 * 'all'; every sub-entity's org_id always the same v_org_id) are promoted
 * into the payload here and then validated against those exact values.
 * This isn't a new capability — the function still only ever produces the
 * same rows it always did — it's a deliberate trap for the future: if this
 * function ever grows a caller that assumes those are configurable, or a
 * bug lets a mismatched org_id through, the function itself now refuses
 * rather than silently trusting whatever arrived.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Needed for the new specialty_id existence check below — nothing
        // else changes about clintra_provision's grants.
        DB::statement('GRANT SELECT ON specialty_templates TO clintra_provision');

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
                -- 1. No unknown keys — reject, don't ignore. A key this
                -- function has never heard of is either a caller bug or an
                -- attempt to see what it does; both get the same answer.
                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'provision_organization: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                -- 2. Every key this function needs must be present and
                -- non-null — checked before any of them are read for real,
                -- so a missing key never surfaces as a confusing NULL
                -- deeper in the function or as a generic NOT NULL violation.
                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    -- jsonb_exists(payload, key), not `payload ? key` — the
                    -- bare `?` operator is indistinguishable from a PDO
                    -- positional placeholder to Laravel's pgsql driver, which
                    -- rewrites it to a literal `$1` with nothing bound to it
                    -- (confirmed: this exact function failed
                    -- "syntax error at or near \"$1\"" until this was
                    -- changed). jsonb_exists() is the operator's own function
                    -- form and contains no `?` at all.
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'provision_organization: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                -- 3. This function only ever produces one shape of
                -- membership. These were fixed literals before this
                -- migration; promoted into the payload and enforced here so
                -- a future caller — or a bug — cannot smuggle a different
                -- role or a narrower scope through.
                IF payload->>'role' <> 'owner' THEN
                    RAISE EXCEPTION 'provision_organization: role must be "owner"' USING ERRCODE = '22023';
                END IF;
                IF payload->>'location_scope' <> 'all' THEN
                    RAISE EXCEPTION 'provision_organization: location_scope must be "all"' USING ERRCODE = '22023';
                END IF;
                IF payload->>'practitioner_scope' <> 'all' THEN
                    RAISE EXCEPTION 'provision_organization: practitioner_scope must be "all"' USING ERRCODE = '22023';
                END IF;

                -- 4. pin_hash/pin_salt shape — contract/pin-hash.json's
                -- Argon2id dkLen=32 bytes (64 hex) and saltBytes=16 bytes
                -- (32 hex); App\Support\PinHash always produces lowercase
                -- via bin2hex(), so uppercase hex is rejected too, not just
                -- non-hex.
                IF payload->>'pin_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'provision_organization: pin_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;
                IF payload->>'pin_salt' !~ '^[0-9a-f]{32}$' THEN
                    RAISE EXCEPTION 'provision_organization: pin_salt must be 32 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                -- 5. Phones: non-empty, E.164 (leading +, first digit 1-9,
                -- up to 15 digits total per the ITU E.164 format itself —
                -- not Egypt-specific here, since this function has no
                -- business knowing about App\Support\EgyptianPhone's
                -- country-specific rules; that validation already happened
                -- one layer up, in the caller).
                IF payload->>'location_phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'provision_organization: location_phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;
                IF payload->>'user_phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'provision_organization: user_phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;

                -- 6. specialty_id must reference a real, system-wide
                -- template — never an org-scoped one (which would mean
                -- reading another org's row) and never a made-up id.
                IF NOT EXISTS (
                    SELECT 1 FROM specialty_templates
                    WHERE id = (payload->>'specialty_id')::uuid AND org_id IS NULL
                ) THEN
                    RAISE EXCEPTION 'provision_organization: specialty_id must reference an existing system-wide specialty_templates row' USING ERRCODE = '22023';
                END IF;

                v_org_id := (payload->>'org_id')::uuid;

                -- 7. No cross-org smuggling: every sub-entity's own org_id
                -- must equal the organization actually being created here.
                -- Also fixed literals before this migration; promoted and
                -- enforced for the same reason as role/scope above.
                IF (payload->>'location_org_id')::uuid <> v_org_id
                    OR (payload->>'practitioner_org_id')::uuid <> v_org_id
                    OR (payload->>'membership_org_id')::uuid <> v_org_id
                THEN
                    RAISE EXCEPTION 'provision_organization: location_org_id, practitioner_org_id and membership_org_id must all equal org_id' USING ERRCODE = '22023';
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

                -- No `RETURNING` anywhere below: every value inserted is
                -- already known from payload (or a fixed constant), and
                -- `INSERT ... RETURNING` requires SELECT privilege on the
                -- target table in addition to INSERT — confirmed empirically
                -- (an earlier version of this function used RETURNING and
                -- failed "permission denied for table organizations" despite
                -- clintra_provision having INSERT). Building each audit
                -- "after" snapshot from the same known values keeps the
                -- grants exactly SELECT-where-actually-needed: users (the
                -- phone-reuse check), audit_log (MAX(seq)), and now
                -- specialty_templates (the existence check above) — nothing
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
        // Restores the pre-validation function body exactly as
        // 2026_09_11_170033_add_organization_provisioning.php created it —
        // that migration's own down() only drops the function outright, so
        // a rollback here must put back a working function, not leave none.
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

        DB::statement('REVOKE SELECT ON specialty_templates FROM clintra_provision');
    }
};
