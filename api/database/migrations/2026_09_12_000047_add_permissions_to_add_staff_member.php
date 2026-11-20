<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Identity phase A1: add_staff_member(jsonb) gains `permissions` and the
 * subset rule (docs/design-identity-permissions.md, section 4: "never grant
 * what you don't hold").
 *
 * - `permissions` is optional: a payload without it (every device today)
 *   adds a member with none and gets back exactly the response, audit row and
 *   ledger rows it got before. Present, it is a list of distinct catalogue
 *   keys, stored on the membership and named in the response and audit row.
 * - The caller is an active owner, as before, or an active holder of
 *   staff.manage adding a non-owner with only permissions they hold
 *   themselves. Until an organization's identity_enforced_at is set nobody
 *   holds a permission (the backfill is phase A4), so only an owner can add
 *   staff, as before.
 * - The membership permission guard (2026_09_12_000045) checks the insert
 *   too, for an enforced organization.
 *
 * Otherwise byte-for-byte the body
 * 2026_09_12_000032_add_staff_member_function.php left. clintra_staff gains
 * SELECT (permissions) — the caller's — and INSERT (permissions) on
 * memberships; ProvisioningRoleGrantsTest pins both.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('GRANT SELECT (permissions), INSERT (permissions) ON memberships TO clintra_staff');

        DB::statement('DROP FUNCTION IF EXISTS add_staff_member(jsonb)');

        DB::statement('SET ROLE clintra_staff');

        DB::statement(<<<'SQL'
            CREATE FUNCTION add_staff_member(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY[
                    'membership_id', 'user_id', 'display_name', 'phone', 'role',
                    'location_scope', 'practitioner_scope', 'practitioner_id',
                    'pin_hash', 'pin_salt', 'locations', 'practitioners', 'audit_id', 'permissions'
                ];
                v_catalogue text[] := ARRAY[
                    'reports.view', 'services.manage', 'invoices.edit_items', 'invoices.void', 'cash.close',
                    'staff.manage', 'schedules.manage', 'clinical.view', 'patients.archive', 'messages.send'
                ];
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_unknown_keys text[];
                v_key text;
                v_link jsonb;
                v_link_keys text[];

                v_caller_setting text;
                v_caller_id uuid;
                v_org_id uuid;
                v_caller_role text;
                v_caller_permissions text[];
                v_permissions text[] := '{}'::text[];

                v_membership_id uuid;
                v_user_id uuid;
                v_display_name text;
                v_phone text;
                v_role text;
                v_location_scope text;
                v_practitioner_scope text;
                v_practitioner_id uuid;
                v_location_ids uuid[];
                v_practitioner_ids uuid[];
                v_locations jsonb := '[]'::jsonb;
                v_practitioners jsonb := '[]'::jsonb;
                v_membership jsonb;
                v_now timestamptz := now();
            BEGIN
                -- 1. Keys: no unknown key, every key present but the optional
                -- permissions, and only practitioner_id may be null.
                IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
                    RAISE EXCEPTION 'add_staff_member: payload must be an object' USING ERRCODE = '22023';
                END IF;

                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'add_staff_member: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY array_remove(v_allowed_keys, 'permissions') LOOP
                    IF NOT jsonb_exists(payload, v_key)
                        OR (v_key <> 'practitioner_id' AND jsonb_typeof(payload -> v_key) = 'null') THEN
                        RAISE EXCEPTION 'add_staff_member: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                -- 2. Shapes.
                FOREACH v_key IN ARRAY ARRAY['membership_id', 'user_id', 'audit_id'] LOOP
                    IF jsonb_typeof(payload -> v_key) IS DISTINCT FROM 'string' OR payload->>v_key !~* v_uuid THEN
                        RAISE EXCEPTION 'add_staff_member: % must be a well-formed uuid', v_key USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                IF jsonb_typeof(payload -> 'practitioner_id') <> 'null'
                    AND (jsonb_typeof(payload -> 'practitioner_id') <> 'string' OR payload->>'practitioner_id' !~* v_uuid) THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner_id must be null or a well-formed uuid' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'display_name') IS DISTINCT FROM 'string'
                    OR btrim(payload->>'display_name') = ''
                    OR payload->>'display_name' <> btrim(payload->>'display_name')
                    OR char_length(payload->>'display_name') > 120 THEN
                    RAISE EXCEPTION 'add_staff_member: display_name must be trimmed, non-empty text of at most 120 characters'
                        USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'phone') IS DISTINCT FROM 'string' OR payload->>'phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'add_staff_member: phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'role') IS DISTINCT FROM 'string'
                    OR payload->>'role' NOT IN ('owner', 'practitioner', 'assistant', 'manager') THEN
                    RAISE EXCEPTION 'add_staff_member: role must be owner, practitioner, assistant or manager' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'location_scope') IS DISTINCT FROM 'string'
                    OR payload->>'location_scope' NOT IN ('all', 'listed') THEN
                    RAISE EXCEPTION 'add_staff_member: location_scope must be all or listed' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'practitioner_scope') IS DISTINCT FROM 'string'
                    OR payload->>'practitioner_scope' NOT IN ('all', 'listed', 'self') THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner_scope must be all, listed or self' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'pin_hash') IS DISTINCT FROM 'string' OR payload->>'pin_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'add_staff_member: pin_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'pin_salt') IS DISTINCT FROM 'string' OR payload->>'pin_salt' !~ '^[0-9a-f]{32}$' THEN
                    RAISE EXCEPTION 'add_staff_member: pin_salt must be 32 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'locations') IS DISTINCT FROM 'array' THEN
                    RAISE EXCEPTION 'add_staff_member: locations must be an array' USING ERRCODE = '22023';
                END IF;

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'locations') LOOP
                    IF jsonb_typeof(v_link) IS DISTINCT FROM 'object' THEN
                        RAISE EXCEPTION 'add_staff_member: every location link must be an object' USING ERRCODE = '22023';
                    END IF;
                    SELECT array_agg(k ORDER BY k) INTO v_link_keys FROM jsonb_object_keys(v_link) AS k;
                    IF v_link_keys IS DISTINCT FROM ARRAY['id', 'location_id']
                        OR jsonb_typeof(v_link -> 'id') IS DISTINCT FROM 'string' OR v_link->>'id' !~* v_uuid
                        OR jsonb_typeof(v_link -> 'location_id') IS DISTINCT FROM 'string' OR v_link->>'location_id' !~* v_uuid THEN
                        RAISE EXCEPTION 'add_staff_member: a location link must be exactly {id, location_id}, both uuids'
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                IF jsonb_typeof(payload -> 'practitioners') IS DISTINCT FROM 'array' THEN
                    RAISE EXCEPTION 'add_staff_member: practitioners must be an array' USING ERRCODE = '22023';
                END IF;

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'practitioners') LOOP
                    IF jsonb_typeof(v_link) IS DISTINCT FROM 'object' THEN
                        RAISE EXCEPTION 'add_staff_member: every practitioner link must be an object' USING ERRCODE = '22023';
                    END IF;
                    SELECT array_agg(k ORDER BY k) INTO v_link_keys FROM jsonb_object_keys(v_link) AS k;
                    IF v_link_keys IS DISTINCT FROM ARRAY['id', 'practitioner_id']
                        OR jsonb_typeof(v_link -> 'id') IS DISTINCT FROM 'string' OR v_link->>'id' !~* v_uuid
                        OR jsonb_typeof(v_link -> 'practitioner_id') IS DISTINCT FROM 'string' OR v_link->>'practitioner_id' !~* v_uuid THEN
                        RAISE EXCEPTION 'add_staff_member: a practitioner link must be exactly {id, practitioner_id}, both uuids'
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                -- permissions: absent means none, exactly as before the key
                -- existed; present, distinct keys of the catalogue
                -- (docs/design-identity-permissions.md, section 4).
                IF jsonb_exists(payload, 'permissions') THEN
                    IF jsonb_typeof(payload -> 'permissions') IS DISTINCT FROM 'array'
                        OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload -> 'permissions') AS e WHERE jsonb_typeof(e) <> 'string') THEN
                        RAISE EXCEPTION 'add_staff_member: permissions must be an array of strings' USING ERRCODE = '22023';
                    END IF;
                    SELECT COALESCE(array_agg(value), '{}'::text[]) INTO v_permissions
                    FROM jsonb_array_elements_text(payload -> 'permissions');
                    IF NOT (v_permissions <@ v_catalogue)
                        OR (SELECT count(DISTINCT x) FROM unnest(v_permissions) AS x) <> cardinality(v_permissions) THEN
                        RAISE EXCEPTION 'add_staff_member: permissions must be distinct keys of the catalogue' USING ERRCODE = '22023';
                    END IF;
                END IF;

                v_membership_id := (payload->>'membership_id')::uuid;
                v_display_name := payload->>'display_name';
                v_phone := payload->>'phone';
                v_role := payload->>'role';
                v_location_scope := payload->>'location_scope';
                v_practitioner_scope := payload->>'practitioner_scope';
                v_practitioner_id := NULLIF(payload->>'practitioner_id', '')::uuid;

                SELECT COALESCE(array_agg((value->>'location_id')::uuid), '{}')
                INTO v_location_ids FROM jsonb_array_elements(payload -> 'locations');
                SELECT COALESCE(array_agg((value->>'practitioner_id')::uuid), '{}')
                INTO v_practitioner_ids FROM jsonb_array_elements(payload -> 'practitioners');

                -- 3. The scope and its links agree: links only for a listed
                -- scope, each target at most once, and practitioner_id only
                -- (and always) for the self scope.
                IF v_location_scope = 'all' AND cardinality(v_location_ids) > 0 THEN
                    RAISE EXCEPTION 'add_staff_member: location links need location_scope listed' USING ERRCODE = '22023';
                END IF;
                IF v_practitioner_scope <> 'listed' AND cardinality(v_practitioner_ids) > 0 THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner links need practitioner_scope listed' USING ERRCODE = '22023';
                END IF;
                IF (v_practitioner_scope = 'self') <> (v_practitioner_id IS NOT NULL) THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner_id is required for practitioner_scope self, and only then'
                        USING ERRCODE = '22023';
                END IF;
                IF (SELECT count(DISTINCT x) FROM unnest(v_location_ids) AS x) <> cardinality(v_location_ids)
                    OR (SELECT count(DISTINCT x) FROM unnest(v_practitioner_ids) AS x) <> cardinality(v_practitioner_ids) THEN
                    RAISE EXCEPTION 'add_staff_member: a location or practitioner is linked twice' USING ERRCODE = '22023';
                END IF;

                -- 4. Who is asking: the request's own membership, an active
                -- owner, or an active holder of staff.manage adding a
                -- non-owner with only permissions they hold themselves
                -- (never grant what you do not hold). From here on every
                -- refusal is the same message.
                v_caller_setting := current_setting('app.membership_id', true);
                IF v_caller_setting IS NULL OR v_caller_setting !~* v_uuid THEN
                    RAISE EXCEPTION 'add_staff_member: not allowed';
                END IF;
                v_caller_id := v_caller_setting::uuid;

                SELECT org_id, role, permissions INTO v_org_id, v_caller_role, v_caller_permissions
                FROM memberships
                WHERE id = v_caller_id AND is_active = true;

                IF NOT FOUND
                    OR (v_caller_role <> 'owner' AND (
                        NOT ('staff.manage' = ANY (v_caller_permissions))
                        OR v_role = 'owner'
                        OR NOT (v_permissions <@ v_caller_permissions))) THEN
                    RAISE EXCEPTION 'add_staff_member: not allowed';
                END IF;

                -- 5. Every location and practitioner named belongs to the
                -- caller's organization.
                IF EXISTS (
                    SELECT 1 FROM unnest(v_location_ids) AS x
                    WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = x AND l.org_id = v_org_id)
                ) OR EXISTS (
                    SELECT 1 FROM unnest(array_append(v_practitioner_ids, v_practitioner_id)) AS x
                    WHERE x IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM practitioners p WHERE p.id = x AND p.org_id = v_org_id)
                ) THEN
                    RAISE EXCEPTION 'add_staff_member: not allowed';
                END IF;

                -- 6. The user: an existing phone links its user (whose id is
                -- all that is ever returned about it); a new phone gets the
                -- payload's user id. One membership per user per organization.
                SELECT id INTO v_user_id FROM users WHERE phone = v_phone;

                IF FOUND THEN
                    IF EXISTS (SELECT 1 FROM memberships WHERE user_id = v_user_id AND org_id = v_org_id) THEN
                        RAISE EXCEPTION 'add_staff_member: already a member of this organization' USING ERRCODE = '23505';
                    END IF;
                ELSE
                    v_user_id := (payload->>'user_id')::uuid;
                    INSERT INTO users (id, full_name, phone, email, is_active)
                    VALUES (v_user_id, v_display_name, v_phone, NULL, true);
                END IF;

                -- 7. The membership and its links; enforce_row_rev() sets
                -- every new row's rev to 1.
                INSERT INTO memberships (
                    id, user_id, org_id, role, location_scope, practitioner_scope, practitioner_id,
                    pin_hash, pin_salt, is_active, display_name, permissions
                ) VALUES (
                    v_membership_id, v_user_id, v_org_id, v_role, v_location_scope, v_practitioner_scope, v_practitioner_id,
                    payload->>'pin_hash', payload->>'pin_salt', true, v_display_name, v_permissions
                );

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'locations') LOOP
                    INSERT INTO membership_locations (id, membership_id, location_id)
                    VALUES ((v_link->>'id')::uuid, v_membership_id, (v_link->>'location_id')::uuid);
                    v_locations := v_locations || jsonb_build_object(
                        'id', (v_link->>'id')::uuid, 'membership_id', v_membership_id,
                        'location_id', (v_link->>'location_id')::uuid, 'rev', 1
                    );
                END LOOP;

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'practitioners') LOOP
                    INSERT INTO membership_practitioners (id, membership_id, practitioner_id)
                    VALUES ((v_link->>'id')::uuid, v_membership_id, (v_link->>'practitioner_id')::uuid);
                    v_practitioners := v_practitioners || jsonb_build_object(
                        'id', (v_link->>'id')::uuid, 'membership_id', v_membership_id,
                        'practitioner_id', (v_link->>'practitioner_id')::uuid, 'rev', 1
                    );
                END LOOP;

                v_membership := jsonb_build_object(
                    'id', v_membership_id, 'user_id', v_user_id, 'org_id', v_org_id, 'role', v_role,
                    'location_scope', v_location_scope, 'practitioner_scope', v_practitioner_scope,
                    'practitioner_id', v_practitioner_id, 'pin_hash', payload->>'pin_hash',
                    'pin_salt', payload->>'pin_salt', 'is_active', true, 'display_name', v_display_name, 'rev', 1
                ) || CASE WHEN jsonb_exists(payload, 'permissions')
                          THEN jsonb_build_object('permissions', to_jsonb(v_permissions)) ELSE '{}'::jsonb END;

                -- 8. One audit row, attributed to the caller: the
                -- membership as created, never its PIN.
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_id')::uuid, v_org_id, v_caller_id, 'memberships', v_membership_id, 'create', NULL,
                    (v_membership - 'pin_hash' - 'pin_salt' - 'rev')
                        || jsonb_build_object('location_ids', to_jsonb(v_location_ids), 'practitioner_ids', to_jsonb(v_practitioner_ids)),
                    v_now
                );

                RETURN jsonb_build_object(
                    'membership', v_membership,
                    'membership_locations', v_locations,
                    'membership_practitioners', v_practitioners
                );
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION add_staff_member(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION add_staff_member(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS add_staff_member(jsonb)');

        DB::statement('SET ROLE clintra_staff');

        DB::statement(<<<'SQL'
            CREATE FUNCTION add_staff_member(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY[
                    'membership_id', 'user_id', 'display_name', 'phone', 'role',
                    'location_scope', 'practitioner_scope', 'practitioner_id',
                    'pin_hash', 'pin_salt', 'locations', 'practitioners', 'audit_id'
                ];
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_unknown_keys text[];
                v_key text;
                v_link jsonb;
                v_link_keys text[];

                v_caller_setting text;
                v_caller_id uuid;
                v_org_id uuid;

                v_membership_id uuid;
                v_user_id uuid;
                v_display_name text;
                v_phone text;
                v_role text;
                v_location_scope text;
                v_practitioner_scope text;
                v_practitioner_id uuid;
                v_location_ids uuid[];
                v_practitioner_ids uuid[];
                v_locations jsonb := '[]'::jsonb;
                v_practitioners jsonb := '[]'::jsonb;
                v_membership jsonb;
                v_now timestamptz := now();
            BEGIN
                -- 1. Keys: no unknown key, every key present, and only
                -- practitioner_id may be null.
                IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
                    RAISE EXCEPTION 'add_staff_member: payload must be an object' USING ERRCODE = '22023';
                END IF;

                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'add_staff_member: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key)
                        OR (v_key <> 'practitioner_id' AND jsonb_typeof(payload -> v_key) = 'null') THEN
                        RAISE EXCEPTION 'add_staff_member: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                -- 2. Shapes.
                FOREACH v_key IN ARRAY ARRAY['membership_id', 'user_id', 'audit_id'] LOOP
                    IF jsonb_typeof(payload -> v_key) IS DISTINCT FROM 'string' OR payload->>v_key !~* v_uuid THEN
                        RAISE EXCEPTION 'add_staff_member: % must be a well-formed uuid', v_key USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                IF jsonb_typeof(payload -> 'practitioner_id') <> 'null'
                    AND (jsonb_typeof(payload -> 'practitioner_id') <> 'string' OR payload->>'practitioner_id' !~* v_uuid) THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner_id must be null or a well-formed uuid' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'display_name') IS DISTINCT FROM 'string'
                    OR btrim(payload->>'display_name') = ''
                    OR payload->>'display_name' <> btrim(payload->>'display_name')
                    OR char_length(payload->>'display_name') > 120 THEN
                    RAISE EXCEPTION 'add_staff_member: display_name must be trimmed, non-empty text of at most 120 characters'
                        USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'phone') IS DISTINCT FROM 'string' OR payload->>'phone' !~ '^\+[1-9]\d{1,14}$' THEN
                    RAISE EXCEPTION 'add_staff_member: phone must be a non-empty E.164 number' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'role') IS DISTINCT FROM 'string'
                    OR payload->>'role' NOT IN ('owner', 'practitioner', 'assistant', 'manager') THEN
                    RAISE EXCEPTION 'add_staff_member: role must be owner, practitioner, assistant or manager' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'location_scope') IS DISTINCT FROM 'string'
                    OR payload->>'location_scope' NOT IN ('all', 'listed') THEN
                    RAISE EXCEPTION 'add_staff_member: location_scope must be all or listed' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'practitioner_scope') IS DISTINCT FROM 'string'
                    OR payload->>'practitioner_scope' NOT IN ('all', 'listed', 'self') THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner_scope must be all, listed or self' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'pin_hash') IS DISTINCT FROM 'string' OR payload->>'pin_hash' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'add_staff_member: pin_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'pin_salt') IS DISTINCT FROM 'string' OR payload->>'pin_salt' !~ '^[0-9a-f]{32}$' THEN
                    RAISE EXCEPTION 'add_staff_member: pin_salt must be 32 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF jsonb_typeof(payload -> 'locations') IS DISTINCT FROM 'array' THEN
                    RAISE EXCEPTION 'add_staff_member: locations must be an array' USING ERRCODE = '22023';
                END IF;

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'locations') LOOP
                    IF jsonb_typeof(v_link) IS DISTINCT FROM 'object' THEN
                        RAISE EXCEPTION 'add_staff_member: every location link must be an object' USING ERRCODE = '22023';
                    END IF;
                    SELECT array_agg(k ORDER BY k) INTO v_link_keys FROM jsonb_object_keys(v_link) AS k;
                    IF v_link_keys IS DISTINCT FROM ARRAY['id', 'location_id']
                        OR jsonb_typeof(v_link -> 'id') IS DISTINCT FROM 'string' OR v_link->>'id' !~* v_uuid
                        OR jsonb_typeof(v_link -> 'location_id') IS DISTINCT FROM 'string' OR v_link->>'location_id' !~* v_uuid THEN
                        RAISE EXCEPTION 'add_staff_member: a location link must be exactly {id, location_id}, both uuids'
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                IF jsonb_typeof(payload -> 'practitioners') IS DISTINCT FROM 'array' THEN
                    RAISE EXCEPTION 'add_staff_member: practitioners must be an array' USING ERRCODE = '22023';
                END IF;

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'practitioners') LOOP
                    IF jsonb_typeof(v_link) IS DISTINCT FROM 'object' THEN
                        RAISE EXCEPTION 'add_staff_member: every practitioner link must be an object' USING ERRCODE = '22023';
                    END IF;
                    SELECT array_agg(k ORDER BY k) INTO v_link_keys FROM jsonb_object_keys(v_link) AS k;
                    IF v_link_keys IS DISTINCT FROM ARRAY['id', 'practitioner_id']
                        OR jsonb_typeof(v_link -> 'id') IS DISTINCT FROM 'string' OR v_link->>'id' !~* v_uuid
                        OR jsonb_typeof(v_link -> 'practitioner_id') IS DISTINCT FROM 'string' OR v_link->>'practitioner_id' !~* v_uuid THEN
                        RAISE EXCEPTION 'add_staff_member: a practitioner link must be exactly {id, practitioner_id}, both uuids'
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                v_membership_id := (payload->>'membership_id')::uuid;
                v_display_name := payload->>'display_name';
                v_phone := payload->>'phone';
                v_role := payload->>'role';
                v_location_scope := payload->>'location_scope';
                v_practitioner_scope := payload->>'practitioner_scope';
                v_practitioner_id := NULLIF(payload->>'practitioner_id', '')::uuid;

                SELECT COALESCE(array_agg((value->>'location_id')::uuid), '{}')
                INTO v_location_ids FROM jsonb_array_elements(payload -> 'locations');
                SELECT COALESCE(array_agg((value->>'practitioner_id')::uuid), '{}')
                INTO v_practitioner_ids FROM jsonb_array_elements(payload -> 'practitioners');

                -- 3. The scope and its links agree: links only for a listed
                -- scope, each target at most once, and practitioner_id only
                -- (and always) for the self scope.
                IF v_location_scope = 'all' AND cardinality(v_location_ids) > 0 THEN
                    RAISE EXCEPTION 'add_staff_member: location links need location_scope listed' USING ERRCODE = '22023';
                END IF;
                IF v_practitioner_scope <> 'listed' AND cardinality(v_practitioner_ids) > 0 THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner links need practitioner_scope listed' USING ERRCODE = '22023';
                END IF;
                IF (v_practitioner_scope = 'self') <> (v_practitioner_id IS NOT NULL) THEN
                    RAISE EXCEPTION 'add_staff_member: practitioner_id is required for practitioner_scope self, and only then'
                        USING ERRCODE = '22023';
                END IF;
                IF (SELECT count(DISTINCT x) FROM unnest(v_location_ids) AS x) <> cardinality(v_location_ids)
                    OR (SELECT count(DISTINCT x) FROM unnest(v_practitioner_ids) AS x) <> cardinality(v_practitioner_ids) THEN
                    RAISE EXCEPTION 'add_staff_member: a location or practitioner is linked twice' USING ERRCODE = '22023';
                END IF;

                -- 4. Who is asking: the request's own membership, an active
                -- owner. From here on every refusal is the same message.
                v_caller_setting := current_setting('app.membership_id', true);
                IF v_caller_setting IS NULL OR v_caller_setting !~* v_uuid THEN
                    RAISE EXCEPTION 'add_staff_member: not allowed';
                END IF;
                v_caller_id := v_caller_setting::uuid;

                SELECT org_id INTO v_org_id
                FROM memberships
                WHERE id = v_caller_id AND role = 'owner' AND is_active = true;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'add_staff_member: not allowed';
                END IF;

                -- 5. Every location and practitioner named belongs to the
                -- caller's organization.
                IF EXISTS (
                    SELECT 1 FROM unnest(v_location_ids) AS x
                    WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = x AND l.org_id = v_org_id)
                ) OR EXISTS (
                    SELECT 1 FROM unnest(array_append(v_practitioner_ids, v_practitioner_id)) AS x
                    WHERE x IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM practitioners p WHERE p.id = x AND p.org_id = v_org_id)
                ) THEN
                    RAISE EXCEPTION 'add_staff_member: not allowed';
                END IF;

                -- 6. The user: an existing phone links its user (whose id is
                -- all that is ever returned about it); a new phone gets the
                -- payload's user id. One membership per user per organization.
                SELECT id INTO v_user_id FROM users WHERE phone = v_phone;

                IF FOUND THEN
                    IF EXISTS (SELECT 1 FROM memberships WHERE user_id = v_user_id AND org_id = v_org_id) THEN
                        RAISE EXCEPTION 'add_staff_member: already a member of this organization' USING ERRCODE = '23505';
                    END IF;
                ELSE
                    v_user_id := (payload->>'user_id')::uuid;
                    INSERT INTO users (id, full_name, phone, email, is_active)
                    VALUES (v_user_id, v_display_name, v_phone, NULL, true);
                END IF;

                -- 7. The membership and its links; enforce_row_rev() sets
                -- every new row's rev to 1.
                INSERT INTO memberships (
                    id, user_id, org_id, role, location_scope, practitioner_scope, practitioner_id,
                    pin_hash, pin_salt, is_active, display_name
                ) VALUES (
                    v_membership_id, v_user_id, v_org_id, v_role, v_location_scope, v_practitioner_scope, v_practitioner_id,
                    payload->>'pin_hash', payload->>'pin_salt', true, v_display_name
                );

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'locations') LOOP
                    INSERT INTO membership_locations (id, membership_id, location_id)
                    VALUES ((v_link->>'id')::uuid, v_membership_id, (v_link->>'location_id')::uuid);
                    v_locations := v_locations || jsonb_build_object(
                        'id', (v_link->>'id')::uuid, 'membership_id', v_membership_id,
                        'location_id', (v_link->>'location_id')::uuid, 'rev', 1
                    );
                END LOOP;

                FOR v_link IN SELECT value FROM jsonb_array_elements(payload -> 'practitioners') LOOP
                    INSERT INTO membership_practitioners (id, membership_id, practitioner_id)
                    VALUES ((v_link->>'id')::uuid, v_membership_id, (v_link->>'practitioner_id')::uuid);
                    v_practitioners := v_practitioners || jsonb_build_object(
                        'id', (v_link->>'id')::uuid, 'membership_id', v_membership_id,
                        'practitioner_id', (v_link->>'practitioner_id')::uuid, 'rev', 1
                    );
                END LOOP;

                v_membership := jsonb_build_object(
                    'id', v_membership_id, 'user_id', v_user_id, 'org_id', v_org_id, 'role', v_role,
                    'location_scope', v_location_scope, 'practitioner_scope', v_practitioner_scope,
                    'practitioner_id', v_practitioner_id, 'pin_hash', payload->>'pin_hash',
                    'pin_salt', payload->>'pin_salt', 'is_active', true, 'display_name', v_display_name, 'rev', 1
                );

                -- 8. One audit row, attributed to the caller: the
                -- membership as created, never its PIN.
                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES (
                    (payload->>'audit_id')::uuid, v_org_id, v_caller_id, 'memberships', v_membership_id, 'create', NULL,
                    (v_membership - 'pin_hash' - 'pin_salt' - 'rev')
                        || jsonb_build_object('location_ids', to_jsonb(v_location_ids), 'practitioner_ids', to_jsonb(v_practitioner_ids)),
                    v_now
                );

                RETURN jsonb_build_object(
                    'membership', v_membership,
                    'membership_locations', v_locations,
                    'membership_practitioners', v_practitioners
                );
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION add_staff_member(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION add_staff_member(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');

        DB::statement('REVOKE SELECT (permissions), INSERT (permissions) ON memberships FROM clintra_staff');
    }
};
