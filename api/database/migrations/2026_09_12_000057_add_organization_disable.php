<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE organizations ADD COLUMN disabled_at timestamptz NULL');
        DB::statement('ALTER TABLE organizations ADD COLUMN disabled_reason varchar(200) NULL');
        DB::statement('ALTER TABLE organizations ADD CONSTRAINT organizations_disabled_reason CHECK (((disabled_at IS NULL) = (disabled_reason IS NULL)) AND (disabled_reason IS NULL OR char_length(disabled_reason) BETWEEN 1 AND 200))');
        DB::statement('GRANT SELECT (id, disabled_at) ON organizations TO clintra_rls');
        // Standalone functions survive migrate:fresh; retire PR #68's CLI
        // entry point and recreate its helper with this phase's exact ACL.
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
        DB::unprepared(<<<'SQL'
            GRANT SELECT (id,disabled_at) ON organizations TO clintra_admin_org;
            GRANT UPDATE (disabled_at,disabled_reason) ON organizations TO clintra_admin_org;
            GRANT SELECT (disabled_at) ON organizations TO clintra_auth;
            ALTER TABLE platform.admin_log DROP CONSTRAINT admin_log_action_check;
            ALTER TABLE platform.admin_log ADD CONSTRAINT admin_log_action_check CHECK (action IN ('admin.login','admin.logout','admin.password_change','figures.view','org.provision','code.mint_request','code.mint_approve','device.revoke','org.disable','org.enable','support.open','cli.provision','cli.mint','cli.revoke','cli.admin_create','cli.org_disable','cli.org_enable'));
            GRANT CREATE ON SCHEMA platform TO clintra_admin_auth,clintra_admin_org;
            SET ROLE clintra_admin_auth;
            CREATE OR REPLACE FUNCTION platform.admin_log_write(p_id uuid, p_admin uuid, p_action text, p_org uuid,
                p_target uuid, p_ok boolean, p_reason text, p_detail jsonb, p_ip inet DEFAULT NULL,
                p_user_agent text DEFAULT NULL) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            BEGIN
                IF p_id IS NULL OR p_ok IS NULL OR p_action IS NULL OR p_action NOT IN (
                    'admin.login','admin.logout','admin.password_change','figures.view','org.provision',
                    'code.mint_request','code.mint_approve','device.revoke','org.disable','org.enable',
                    'support.open','cli.provision','cli.mint','cli.revoke','cli.admin_create','cli.org_disable','cli.org_enable')
                    OR (p_detail IS NOT NULL AND jsonb_typeof(p_detail) <> 'object') THEN
                    RAISE EXCEPTION 'invalid admin log payload' USING ERRCODE='22023';
                END IF;
                INSERT INTO platform.admin_log (id,admin_user_id,action,org_id,target_id,succeeded,reason,detail,ip,user_agent)
                VALUES (p_id,p_admin,p_action,p_org,p_target,p_ok,p_reason,coalesce(p_detail,'{}'::jsonb),p_ip,left(p_user_agent,400));
            EXCEPTION WHEN unique_violation OR foreign_key_violation THEN
                RAISE EXCEPTION 'invalid admin log identifiers' USING ERRCODE='22023';
            END;
            $$;
            CREATE OR REPLACE FUNCTION platform.admin_log_cli(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE v_log uuid; v_target uuid; v_org uuid;
            BEGIN
                IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'invalid CLI log payload' USING ERRCODE='22023'; END IF;
                IF NOT p ?& ARRAY['log_id','action','target_id','succeeded','reason','detail']
                    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('log_id','action','target_id','succeeded','reason','detail'))
                    OR jsonb_typeof(p->'log_id')<>'string' OR jsonb_typeof(p->'target_id') NOT IN ('string','null')
                    OR jsonb_typeof(p->'succeeded')<>'boolean' OR jsonb_typeof(p->'reason') NOT IN ('string','null')
                    OR jsonb_typeof(p->'action')<>'string' OR p->>'action' NOT IN ('cli.provision','cli.mint','cli.revoke','cli.admin_create','cli.org_disable','cli.org_enable')
                    OR jsonb_typeof(p->'detail')<>'object' OR jsonb_typeof(p->'detail'->'host_user') IS DISTINCT FROM 'string'
                    OR length(btrim(p->'detail'->>'host_user')) NOT BETWEEN 1 AND 254 THEN
                    RAISE EXCEPTION 'invalid CLI log payload' USING ERRCODE='22023';
                END IF;
                BEGIN v_log:=(p->>'log_id')::uuid; v_target:=(p->>'target_id')::uuid;
                EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid CLI log identifiers' USING ERRCODE='22023'; END;
                IF p->>'action' IN ('cli.org_disable','cli.org_enable') THEN
                    v_org := (p->'detail'->>'org_id')::uuid;
                END IF;
                PERFORM platform.admin_log_write(v_log,NULL,p->>'action',v_org,v_target,(p->>'succeeded')::boolean,
                    p->>'reason',p->'detail',NULL,NULL);
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            GRANT EXECUTE ON FUNCTION platform.admin_log_cli(jsonb) TO clintra_admin_org;
            RESET ROLE;
            SET ROLE clintra_admin_org;
            CREATE FUNCTION platform.admin_set_org_disabled(p_session uuid, p_otp text, p_org uuid, p_disabled boolean,
                p_reason text, p_log_id uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,p_otp,true);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_org uuid;
                v_action text := CASE WHEN p_disabled IS FALSE THEN 'org.enable' ELSE 'org.disable' END;
                v_reason text := nullif(btrim(p_reason),'');
                v_refusal text := v_state->>'reason';
            BEGIN
                -- Resolve and step up before looking up even a guessed organization ID.
                SELECT id INTO v_org FROM organizations WHERE id=p_org;
                IF v_refusal IS NULL THEN
                    IF v_org IS NULL THEN v_refusal := 'not_found';
                    ELSIF p_disabled IS NULL THEN v_refusal := 'invalid_payload';
                    ELSIF p_disabled AND (v_reason IS NULL OR char_length(v_reason)>200) THEN v_refusal := 'reason_required';
                    ELSE
                        PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:' || p_org::text,0));
                        UPDATE organizations SET disabled_at=CASE WHEN p_disabled THEN now() END,
                            disabled_reason=CASE WHEN p_disabled THEN v_reason END
                        WHERE id=p_org AND (disabled_at IS NULL)=p_disabled;
                        IF NOT FOUND THEN v_refusal := 'unchanged'; END IF;
                    END IF;
                END IF;
                PERFORM platform.admin_log_write(coalesce(p_log_id,gen_random_uuid()),v_admin,v_action,v_org,p_org,
                    v_refusal IS NULL,v_refusal,v_state || jsonb_build_object('reason',v_reason));
                IF v_refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_refusal); END IF;
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_set_org_disabled(uuid,text,uuid,boolean,text,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_set_org_disabled(uuid,text,uuid,boolean,text,uuid) TO clintra_admin_app;

            CREATE FUNCTION platform.cli_set_org_disabled(p_org uuid,p_disabled boolean,p_reason text,p_log_id uuid,p_host_user text) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_org uuid;
                v_reason text := nullif(btrim(p_reason),'');
                v_refusal text;
            BEGIN
                SELECT id INTO v_org FROM organizations WHERE id=p_org;
                IF v_org IS NULL THEN v_refusal := 'not_found';
                ELSIF p_disabled IS NULL OR nullif(btrim(p_host_user),'') IS NULL OR char_length(p_host_user)>254 THEN v_refusal := 'invalid_payload';
                ELSIF p_disabled AND (v_reason IS NULL OR char_length(v_reason)>200) THEN v_refusal := 'reason_required';
                ELSE
                    PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:' || p_org::text,0));
                    UPDATE organizations SET disabled_at=CASE WHEN p_disabled THEN now() END,
                        disabled_reason=CASE WHEN p_disabled THEN v_reason END
                    WHERE id=p_org AND (disabled_at IS NULL)=p_disabled;
                    IF NOT FOUND THEN v_refusal := 'unchanged'; END IF;
                END IF;
                PERFORM platform.admin_log_cli(jsonb_build_object('log_id',coalesce(p_log_id,gen_random_uuid()),
                    'action',CASE WHEN p_disabled IS FALSE THEN 'cli.org_enable' ELSE 'cli.org_disable' END,
                    'target_id',p_org,'succeeded',v_refusal IS NULL,'reason',v_refusal,
                    'detail',jsonb_build_object('org_id',v_org,'reason',v_reason,
                        'host_user',coalesce(nullif(left(btrim(p_host_user),254),''),'unknown'))));
                IF v_refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_refusal); END IF;
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.cli_set_org_disabled(uuid,boolean,text,uuid,text) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.cli_set_org_disabled(uuid,boolean,text,uuid,text) TO clintra_owner;

            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_auth,clintra_admin_org;
        SQL);
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
        DB::unprepared(<<<'SQL'
            SET ROLE clintra_auth;
            CREATE OR REPLACE FUNCTION auth_recover_owner(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_username text;
                v_code record;
                v_owner record;
                v_device_id uuid;
                v_username_set boolean := false;
                v_rev integer;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k WHERE k <> 'check_only') IS DISTINCT FROM ARRAY[
                        'audit_id', 'code_hash', 'device_id', 'new_hash', 'phone', 'username'
                    ]
                    OR (p ? 'check_only' AND jsonb_typeof(p->'check_only') IS DISTINCT FROM 'boolean')
                    OR jsonb_typeof(p -> 'code_hash') IS DISTINCT FROM 'string' OR p->>'code_hash' !~ '^[0-9a-f]{64}$'
                    OR jsonb_typeof(p -> 'phone') IS DISTINCT FROM 'string' OR p->>'phone' !~ '^\+[1-9]\d{1,14}$'
                    OR jsonb_typeof(p -> 'device_id') IS DISTINCT FROM 'string' OR p->>'device_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'new_hash') IS DISTINCT FROM 'string' OR p->>'new_hash' !~ '^\$argon2id\$'
                    OR jsonb_typeof(p -> 'username') IS DISTINCT FROM 'string' OR lower(p->>'username') !~ '^[a-z0-9._-]{3,32}$' THEN
                    RAISE EXCEPTION 'auth_recover_owner: payload must be exactly {code_hash, phone, username, new_hash, device_id, audit_id}, well formed'
                        USING ERRCODE = '22023';
                END IF;

                v_username := lower(p->>'username');

                SELECT id, org_id INTO v_code
                FROM activation_codes
                WHERE code_hash = p->>'code_hash' AND purpose = 'owner_recovery' AND used_at IS NULL AND expires_at > now();

                SELECT m.id, m.username INTO v_owner
                FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.org_id = v_code.org_id AND m.role = 'owner' AND m.is_active AND u.phone = p->>'phone'
                LIMIT 1;

                SELECT id INTO v_device_id
                FROM device WHERE id = (p->>'device_id')::uuid AND org_id = v_code.org_id AND revoked_at IS NULL;

                IF v_code.id IS NULL OR v_owner.id IS NULL OR v_device_id IS NULL
                    OR (v_owner.username IS NOT NULL AND lower(v_owner.username) <> v_username) THEN
                    RAISE EXCEPTION 'auth_recover_owner: recovery failed';
                END IF;

                PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:' || v_code.org_id::text,0));
                PERFORM 1 FROM activation_codes WHERE id=v_code.id AND used_at IS NULL AND expires_at>now() FOR UPDATE;
                IF NOT FOUND THEN RAISE EXCEPTION 'auth_recover_owner: recovery failed'; END IF;
                IF coalesce((p->>'check_only')::boolean,false)
                    OR EXISTS (SELECT 1 FROM organizations WHERE id=v_code.org_id AND disabled_at IS NOT NULL) THEN
                    RAISE EXCEPTION 'auth_recover_owner: organization disabled' USING ERRCODE='CL403';
                END IF;

                -- A username another member holds raises 23505 here, before
                -- anything else is written.
                IF v_owner.username IS NULL THEN
                    UPDATE memberships SET username = v_username WHERE id = v_owner.id;
                    v_username_set := true;
                END IF;

                SELECT rev INTO v_rev FROM memberships WHERE id = v_owner.id;

                UPDATE activation_codes SET used_at = now(), used_by_device_id = v_device_id WHERE id = v_code.id;

                INSERT INTO member_passwords (membership_id, org_id, password_hash, must_change, set_at, set_by_membership_id)
                VALUES (v_owner.id, v_code.org_id, p->>'new_hash', false, now(), NULL)
                ON CONFLICT (membership_id) DO UPDATE
                SET password_hash = EXCLUDED.password_hash, must_change = false,
                    set_at = EXCLUDED.set_at, set_by_membership_id = NULL;

                UPDATE member_credentials SET revoked_at = now(), revoke_reason = 'password_reset'
                WHERE membership_id = v_owner.id AND revoked_at IS NULL;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_code.org_id, v_owner.id, 'member_passwords', v_owner.id, 'update', NULL,
                        jsonb_build_object('recovered', true, 'username_set', v_username_set), now());

                RETURN jsonb_build_object('membership_id', v_owner.id, 'org_id', v_code.org_id,
                                          'username', v_username, 'username_set', v_username_set, 'rev', v_rev);
            END;
            $$;
            RESET ROLE;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            SET ROLE clintra_auth;
            CREATE OR REPLACE FUNCTION auth_recover_owner(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_username text;
                v_code record;
                v_owner record;
                v_device_id uuid;
                v_username_set boolean := false;
                v_rev integer;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'audit_id', 'code_hash', 'device_id', 'new_hash', 'phone', 'username'
                    ]
                    OR jsonb_typeof(p -> 'code_hash') IS DISTINCT FROM 'string' OR p->>'code_hash' !~ '^[0-9a-f]{64}$'
                    OR jsonb_typeof(p -> 'phone') IS DISTINCT FROM 'string' OR p->>'phone' !~ '^\+[1-9]\d{1,14}$'
                    OR jsonb_typeof(p -> 'device_id') IS DISTINCT FROM 'string' OR p->>'device_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'new_hash') IS DISTINCT FROM 'string' OR p->>'new_hash' !~ '^\$argon2id\$'
                    OR jsonb_typeof(p -> 'username') IS DISTINCT FROM 'string' OR lower(p->>'username') !~ '^[a-z0-9._-]{3,32}$' THEN
                    RAISE EXCEPTION 'auth_recover_owner: payload must be exactly {code_hash, phone, username, new_hash, device_id, audit_id}, well formed'
                        USING ERRCODE = '22023';
                END IF;

                v_username := lower(p->>'username');

                SELECT id, org_id INTO v_code
                FROM activation_codes
                WHERE code_hash = p->>'code_hash' AND purpose = 'owner_recovery' AND used_at IS NULL AND expires_at > now()
                FOR UPDATE;

                SELECT m.id, m.username INTO v_owner
                FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.org_id = v_code.org_id AND m.role = 'owner' AND m.is_active AND u.phone = p->>'phone'
                LIMIT 1;

                SELECT id INTO v_device_id
                FROM device WHERE id = (p->>'device_id')::uuid AND org_id = v_code.org_id AND revoked_at IS NULL;

                IF v_code.id IS NULL OR v_owner.id IS NULL OR v_device_id IS NULL
                    OR (v_owner.username IS NOT NULL AND lower(v_owner.username) <> v_username) THEN
                    RAISE EXCEPTION 'auth_recover_owner: recovery failed';
                END IF;

                -- A username another member holds raises 23505 here, before
                -- anything else is written.
                IF v_owner.username IS NULL THEN
                    UPDATE memberships SET username = v_username WHERE id = v_owner.id;
                    v_username_set := true;
                END IF;

                SELECT rev INTO v_rev FROM memberships WHERE id = v_owner.id;

                UPDATE activation_codes SET used_at = now(), used_by_device_id = v_device_id WHERE id = v_code.id;

                INSERT INTO member_passwords (membership_id, org_id, password_hash, must_change, set_at, set_by_membership_id)
                VALUES (v_owner.id, v_code.org_id, p->>'new_hash', false, now(), NULL)
                ON CONFLICT (membership_id) DO UPDATE
                SET password_hash = EXCLUDED.password_hash, must_change = false,
                    set_at = EXCLUDED.set_at, set_by_membership_id = NULL;

                UPDATE member_credentials SET revoked_at = now(), revoke_reason = 'password_reset'
                WHERE membership_id = v_owner.id AND revoked_at IS NULL;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_code.org_id, v_owner.id, 'member_passwords', v_owner.id, 'update', NULL,
                        jsonb_build_object('recovered', true, 'username_set', v_username_set), now());

                RETURN jsonb_build_object('membership_id', v_owner.id, 'org_id', v_code.org_id,
                                          'username', v_username, 'username_set', v_username_set, 'rev', v_rev);
            END;
            $$;
            RESET ROLE;
        SQL);
        DB::unprepared(<<<'SQL'
            DROP FUNCTION platform.admin_set_org_disabled(uuid,text,uuid,boolean,text,uuid);
            DROP FUNCTION platform.cli_set_org_disabled(uuid,boolean,text,uuid,text);
            REVOKE EXECUTE ON FUNCTION platform.admin_log_cli(jsonb) FROM clintra_admin_org;
            GRANT CREATE ON SCHEMA platform TO clintra_admin_auth;
            SET ROLE clintra_admin_auth;
            CREATE OR REPLACE FUNCTION platform.admin_log_write(p_id uuid, p_admin uuid, p_action text, p_org uuid,
                p_target uuid, p_ok boolean, p_reason text, p_detail jsonb, p_ip inet DEFAULT NULL,
                p_user_agent text DEFAULT NULL) RETURNS void
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            BEGIN
                IF p_id IS NULL OR p_ok IS NULL OR p_action IS NULL OR p_action NOT IN (
                    'admin.login','admin.logout','admin.password_change','figures.view','org.provision',
                    'code.mint_request','code.mint_approve','device.revoke','org.disable','org.enable',
                    'support.open','cli.provision','cli.mint','cli.revoke','cli.admin_create')
                    OR (p_detail IS NOT NULL AND jsonb_typeof(p_detail) <> 'object') THEN
                    RAISE EXCEPTION 'invalid admin log payload' USING ERRCODE='22023';
                END IF;
                INSERT INTO platform.admin_log (id,admin_user_id,action,org_id,target_id,succeeded,reason,detail,ip,user_agent)
                VALUES (p_id,p_admin,p_action,p_org,p_target,p_ok,p_reason,coalesce(p_detail,'{}'::jsonb),p_ip,left(p_user_agent,400));
            EXCEPTION WHEN unique_violation OR foreign_key_violation THEN
                RAISE EXCEPTION 'invalid admin log identifiers' USING ERRCODE='22023';
            END;
            $$;
            CREATE OR REPLACE FUNCTION platform.admin_log_cli(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE v_log uuid; v_target uuid;
            BEGIN
                IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'invalid CLI log payload' USING ERRCODE='22023'; END IF;
                IF NOT p ?& ARRAY['log_id','action','target_id','succeeded','reason','detail']
                    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('log_id','action','target_id','succeeded','reason','detail'))
                    OR jsonb_typeof(p->'log_id')<>'string' OR jsonb_typeof(p->'target_id') NOT IN ('string','null')
                    OR jsonb_typeof(p->'succeeded')<>'boolean' OR jsonb_typeof(p->'reason') NOT IN ('string','null')
                    OR jsonb_typeof(p->'action')<>'string' OR p->>'action' NOT IN ('cli.provision','cli.mint','cli.revoke','cli.admin_create')
                    OR jsonb_typeof(p->'detail')<>'object' OR jsonb_typeof(p->'detail'->'host_user') IS DISTINCT FROM 'string'
                    OR length(btrim(p->'detail'->>'host_user')) NOT BETWEEN 1 AND 254 THEN
                    RAISE EXCEPTION 'invalid CLI log payload' USING ERRCODE='22023';
                END IF;
                BEGIN v_log:=(p->>'log_id')::uuid; v_target:=(p->>'target_id')::uuid;
                EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid CLI log identifiers' USING ERRCODE='22023'; END;
                PERFORM platform.admin_log_write(v_log,NULL,p->>'action',NULL,v_target,(p->>'succeeded')::boolean,
                    p->>'reason',p->'detail',NULL,NULL);
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_auth;
            ALTER TABLE platform.admin_log DROP CONSTRAINT admin_log_action_check;
            -- Keep immutable B2 history while rejecting these actions after rollback.
            ALTER TABLE platform.admin_log ADD CONSTRAINT admin_log_action_check CHECK (action IN ('admin.login','admin.logout','admin.password_change','figures.view','org.provision','code.mint_request','code.mint_approve','device.revoke','org.disable','org.enable','support.open','cli.provision','cli.mint','cli.revoke','cli.admin_create')) NOT VALID;
            REVOKE SELECT (id,disabled_at), UPDATE (disabled_at,disabled_reason) ON organizations FROM clintra_admin_org;
            REVOKE SELECT (disabled_at) ON organizations FROM clintra_auth;
        SQL);
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
        DB::statement('REVOKE SELECT (id, disabled_at) ON organizations FROM clintra_rls');
        DB::statement('ALTER TABLE organizations DROP CONSTRAINT organizations_disabled_reason');
        DB::statement('ALTER TABLE organizations DROP COLUMN disabled_reason');
        DB::statement('ALTER TABLE organizations DROP COLUMN disabled_at');
    }
};
