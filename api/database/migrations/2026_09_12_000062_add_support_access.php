<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE device ALTER COLUMN series DROP NOT NULL;
            ALTER TABLE device ADD COLUMN kind text NOT NULL DEFAULT 'clinic' CHECK (kind IN ('clinic','support'));
            ALTER TABLE device ADD COLUMN expires_at timestamptz NULL;
            ALTER TABLE device ADD COLUMN include_clinical boolean NOT NULL DEFAULT true;
            ALTER TABLE device ADD COLUMN support_admin_name varchar(120) NULL;
            ALTER TABLE device ADD COLUMN support_code_id uuid NULL REFERENCES activation_codes(id) ON DELETE RESTRICT;
            ALTER TABLE device ADD CONSTRAINT device_support_shape
                CHECK ((kind='support')=(expires_at IS NOT NULL AND support_admin_name IS NOT NULL AND support_code_id IS NOT NULL));
            ALTER TABLE device ADD CONSTRAINT device_series_shape CHECK ((kind='clinic')=(series IS NOT NULL));

            ALTER TABLE activation_codes DROP CONSTRAINT activation_codes_purpose_check;
            ALTER TABLE activation_codes ADD CONSTRAINT activation_codes_purpose_check
                CHECK (purpose IN ('device','owner_recovery','support'));
            ALTER TABLE activation_codes ADD COLUMN support_hours smallint NULL CHECK (support_hours IN (1,24,72));
            ALTER TABLE activation_codes ADD COLUMN include_clinical boolean NULL;
            ALTER TABLE activation_codes ADD COLUMN created_by_membership_id uuid NULL REFERENCES memberships(id) ON DELETE RESTRICT;
            ALTER TABLE activation_codes ADD CONSTRAINT activation_codes_support_shape
                CHECK ((purpose='support')=(support_hours IS NOT NULL AND include_clinical IS NOT NULL
                    AND created_by_membership_id IS NOT NULL));

            GRANT SELECT (id,disabled_at) ON organizations TO clintra_rls;
            GRANT SELECT (id,org_id,revoked_at,expires_at) ON device TO clintra_rls;
            SET ROLE clintra_rls;
            CREATE OR REPLACE FUNCTION current_org() RETURNS uuid
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
                SELECT m.org_id FROM memberships m JOIN organizations o ON o.id=m.org_id
                WHERE m.id=current_membership() AND m.is_active AND o.disabled_at IS NULL
            $$;
            CREATE OR REPLACE FUNCTION device_exists(p_device_id uuid) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
                SELECT EXISTS (SELECT 1 FROM device WHERE id=p_device_id AND revoked_at IS NULL
                    AND (expires_at IS NULL OR expires_at>now()))
            $$;
            RESET ROLE;

            GRANT SELECT (id,org_id,location_id,code_hash,expires_at,used_at,purpose,support_hours,
                include_clinical,created_by_membership_id) ON activation_codes TO clintra_admin_support;
            GRANT UPDATE (used_at,used_by_device_id) ON activation_codes TO clintra_admin_support;
            GRANT INSERT ON device TO clintra_admin_support;
            GRANT SELECT (id,org_id,kind,revoked_at,expires_at) ON device TO clintra_admin_support;
            GRANT SELECT (id,disabled_at) ON organizations TO clintra_admin_support;
            GRANT SELECT (id,org_id,role,is_active) ON memberships TO clintra_admin_support;
            GRANT SELECT (id,ip,user_agent) ON platform.admin_sessions TO clintra_admin_support;
            GRANT INSERT ON platform.support_exchanges TO clintra_admin_support;
            GRANT SELECT (exchange_hash) ON platform.support_exchanges TO clintra_admin_support;
            GRANT INSERT ON audit_log TO clintra_admin_support;

            GRANT SELECT (id,org_id,role,is_active) ON memberships TO clintra_support;
            GRANT SELECT (id,org_id) ON locations TO clintra_support;
            GRANT INSERT ON activation_codes TO clintra_support;
            GRANT SELECT (id,code_hash) ON activation_codes TO clintra_support;
            GRANT SELECT, UPDATE (used_at) ON platform.support_exchanges TO clintra_support;
            GRANT SELECT (id,org_id,location_id,membership_id,kind,revoked_at,expires_at,public_key,
                include_clinical,support_admin_name)
                ON device TO clintra_support;
            GRANT UPDATE (public_key,public_key_bound_at,revoked_at) ON device TO clintra_support;
            GRANT SELECT (tokenable_type,tokenable_id), DELETE ON personal_access_tokens TO clintra_support;
            GRANT SELECT (id,disabled_at) ON organizations TO clintra_support;
            GRANT INSERT ON audit_log TO clintra_support;
            GRANT EXECUTE ON FUNCTION current_membership() TO clintra_support;

            GRANT CREATE ON SCHEMA platform TO clintra_admin_auth,clintra_admin_support;
            SET ROLE clintra_admin_auth;
            CREATE FUNCTION platform.admin_display_name(p_admin uuid) RETURNS text
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
                SELECT name::text FROM platform.admin_users WHERE id=p_admin AND is_active
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_display_name(uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_display_name(uuid) TO clintra_admin_support;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_auth;

            SET ROLE clintra_admin_support;
            CREATE FUNCTION platform.admin_open_support_session(p_session uuid,p_otp text,p_payload jsonb,p_log_id uuid)
            RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE
                v_state jsonb:=platform.admin_session_actor(p_session,p_otp,true);
                v_admin uuid:=(v_state->>'admin_user_id')::uuid;
                v_reason text:=v_state->>'reason';
                v_code record;
                v_org uuid; v_target uuid; v_device uuid;
                v_ip inet; v_agent text; v_name text; v_expires timestamptz;
                v_hours smallint; v_include boolean;
                v_uuid text:='^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
            BEGIN
                SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                IF v_reason IS NULL THEN
                    IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
                        v_reason:='invalid_payload';
                    ELSIF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
                            IS DISTINCT FROM ARRAY['code_hash','device_id','exchange_hash']
                        OR jsonb_typeof(p_payload->'code_hash')<>'string'
                        OR p_payload->>'code_hash' !~ '^[0-9a-f]{64}$'
                        OR jsonb_typeof(p_payload->'exchange_hash')<>'string'
                        OR p_payload->>'exchange_hash' !~ '^[0-9a-f]{64}$'
                        OR coalesce(p_payload->>'device_id' ~* v_uuid,false)=false THEN
                        v_reason:='invalid_payload';
                    ELSE
                        v_device:=(p_payload->>'device_id')::uuid;
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    SELECT org_id INTO v_org FROM activation_codes WHERE code_hash=p_payload->>'code_hash';
                    IF v_org IS NULL THEN v_reason:='not_found';
                    ELSE
                        PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:'||v_org::text,0));
                        SELECT id,org_id,location_id,expires_at,used_at,purpose,support_hours,include_clinical,
                            created_by_membership_id INTO v_code FROM activation_codes
                            WHERE code_hash=p_payload->>'code_hash' FOR UPDATE;
                        IF v_code.purpose<>'support' THEN
                            v_reason:='not_found'; v_org:=NULL;
                        ELSIF v_code.used_at IS NOT NULL THEN v_reason:='unchanged';
                        ELSIF v_code.expires_at<=now() THEN v_reason:='expired';
                        ELSIF EXISTS(SELECT 1 FROM organizations WHERE id=v_org AND disabled_at IS NOT NULL) THEN
                            v_reason:='org_disabled';
                        ELSIF NOT EXISTS(SELECT 1 FROM memberships WHERE id=v_code.created_by_membership_id
                            AND org_id=v_org AND role='owner' AND is_active) THEN v_reason:='no_owner';
                        ELSIF EXISTS(SELECT 1 FROM device WHERE org_id=v_org AND kind='support'
                            AND revoked_at IS NULL AND expires_at>now()) THEN v_reason:='support_active';
                        ELSIF EXISTS(SELECT 1 FROM device WHERE id=v_device) THEN v_reason:='unchanged';
                        ELSIF EXISTS(SELECT 1 FROM platform.support_exchanges WHERE exchange_hash=p_payload->>'exchange_hash')
                            THEN v_reason:='unchanged';
                        ELSE
                            v_name:=platform.admin_display_name(v_admin);
                            v_hours:=v_code.support_hours;
                            v_include:=v_code.include_clinical;
                            v_expires:=now()+make_interval(hours=>v_code.support_hours);
                            INSERT INTO device(id,org_id,location_id,membership_id,registered_at,series,kind,expires_at,
                                include_clinical,support_admin_name,support_code_id)
                            VALUES(v_device,v_org,v_code.location_id,v_code.created_by_membership_id,now(),NULL,'support',
                                v_expires,v_code.include_clinical,v_name,v_code.id);
                            UPDATE activation_codes SET used_at=now(),used_by_device_id=v_device WHERE id=v_code.id;
                            INSERT INTO platform.support_exchanges(exchange_hash,device_id,expires_at)
                            VALUES(p_payload->>'exchange_hash',v_device,now()+interval '2 minutes');
                            INSERT INTO audit_log(id,org_id,actor_membership_id,entity,entity_id,action,before,after,at)
                            VALUES(gen_random_uuid(),v_org,v_code.created_by_membership_id,'device',v_device,'create',NULL,
                                jsonb_build_object('label','فتح فريق كلينترا دعم للقراءة','expires_at',v_expires),now());
                            v_target:=v_device;
                        END IF;
                    END IF;
                END IF;
                PERFORM platform.admin_log_write(coalesce(p_log_id,gen_random_uuid()),v_admin,'support.open',v_org,
                    v_target,v_reason IS NULL,v_reason,
                    CASE WHEN v_reason IS NULL THEN jsonb_build_object('hours',v_hours,
                        'include_clinical',v_include) ELSE v_state END,v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason)
                    || CASE WHEN coalesce((v_state->>'all_sessions_ended')::boolean,false)
                        THEN jsonb_build_object('all_sessions_ended',true) ELSE '{}'::jsonb END; END IF;
                RETURN jsonb_build_object('ok',true,'device_id',v_device,'expires_at',v_expires);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_open_support_session(uuid,text,jsonb,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_open_support_session(uuid,text,jsonb,uuid) TO clintra_admin_app;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_support;

            GRANT CREATE ON SCHEMA public TO clintra_support;
            SET ROLE clintra_support;
            DROP FUNCTION IF EXISTS end_support_session(jsonb);
            DROP FUNCTION IF EXISTS support_exchange(jsonb);
            DROP FUNCTION IF EXISTS mint_support_code(jsonb);
            CREATE FUNCTION mint_support_code(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE v_member record; v_location uuid; v_now timestamptz:=now();
                v_uuid text:='^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
            BEGIN
                IF p IS NULL OR jsonb_typeof(p)<>'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k)
                        IS DISTINCT FROM ARRAY['audit_id','code_hash','id','include_clinical','location_id','support_hours']
                    OR coalesce(p->>'id' ~* v_uuid,false)=false
                    OR coalesce(p->>'audit_id' ~* v_uuid,false)=false
                    OR coalesce(p->>'location_id' ~* v_uuid,false)=false
                    OR coalesce(p->>'code_hash' ~ '^[0-9a-f]{64}$',false)=false
                    OR jsonb_typeof(p->'support_hours')<>'number'
                    OR coalesce(p->>'support_hours' IN ('1','24','72'),false)=false
                    OR jsonb_typeof(p->'include_clinical')<>'boolean' THEN
                    RAISE EXCEPTION 'mint_support_code: invalid payload' USING ERRCODE='22023';
                END IF;
                SELECT id,org_id INTO v_member FROM memberships
                    WHERE id=current_membership() AND role='owner' AND is_active;
                IF v_member.id IS NULL THEN
                    RAISE EXCEPTION 'mint_support_code: owner required' USING ERRCODE='CL403';
                END IF;
                IF EXISTS(SELECT 1 FROM organizations WHERE id=v_member.org_id AND disabled_at IS NOT NULL) THEN
                    RAISE EXCEPTION 'mint_support_code: organization disabled' USING ERRCODE='CL403';
                END IF;
                v_location:=(p->>'location_id')::uuid;
                IF NOT EXISTS(SELECT 1 FROM locations WHERE id=v_location AND org_id=v_member.org_id) THEN
                    RAISE EXCEPTION 'mint_support_code: location unavailable' USING ERRCODE='CL403';
                END IF;
                PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:'||v_member.org_id::text,0));
                IF EXISTS(SELECT 1 FROM activation_codes WHERE id=(p->>'id')::uuid
                    OR code_hash=p->>'code_hash') THEN
                    RAISE EXCEPTION 'mint_support_code: duplicate code' USING ERRCODE='22023';
                END IF;
                INSERT INTO activation_codes(id,org_id,location_id,code_hash,expires_at,created_at,purpose,
                    support_hours,include_clinical,created_by_membership_id)
                VALUES((p->>'id')::uuid,v_member.org_id,v_location,p->>'code_hash',v_now+interval '72 hours',v_now,
                    'support',(p->>'support_hours')::smallint,(p->>'include_clinical')::boolean,v_member.id);
                INSERT INTO audit_log(id,org_id,actor_membership_id,entity,entity_id,action,before,after,at)
                VALUES(gen_random_uuid(),v_member.org_id,v_member.id,'activation_codes',(p->>'id')::uuid,
                    'create',NULL,jsonb_build_object('purpose','support','support_hours',p->'support_hours',
                        'include_clinical',p->'include_clinical'),v_now);
                RETURN jsonb_build_object('id',p->>'id','expires_at',v_now+interval '72 hours');
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION mint_support_code(jsonb) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION mint_support_code(jsonb) TO clintra_app;

            CREATE FUNCTION support_exchange(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE v_exchange platform.support_exchanges%ROWTYPE; v_device record;
                v_key jsonb; v_failure text:='support_exchange: exchange failed';
            BEGIN
                IF p IS NULL OR jsonb_typeof(p)<>'object' THEN
                    RAISE EXCEPTION '%',v_failure USING ERRCODE='CL401';
                END IF;
                IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k)
                        IS DISTINCT FROM ARRAY['device_public_key','exchange_hash']
                    OR coalesce(p->>'exchange_hash' ~ '^[0-9a-f]{64}$',false)=false THEN
                    RAISE EXCEPTION '%' ,v_failure USING ERRCODE='CL401';
                END IF;
                v_key:=p->'device_public_key';
                IF jsonb_typeof(v_key)<>'object' OR v_key->>'kty' IS DISTINCT FROM 'EC'
                    OR v_key->>'crv' IS DISTINCT FROM 'P-256'
                    OR coalesce(v_key->>'x' ~ '^[A-Za-z0-9_-]{43}$',false)=false
                    OR coalesce(v_key->>'y' ~ '^[A-Za-z0-9_-]{43}$',false)=false THEN
                    RAISE EXCEPTION '%',v_failure USING ERRCODE='CL401';
                END IF;
                SELECT * INTO v_exchange FROM platform.support_exchanges
                    WHERE exchange_hash=p->>'exchange_hash' FOR UPDATE;
                IF v_exchange.device_id IS NULL OR v_exchange.used_at IS NOT NULL
                    OR v_exchange.expires_at<=now() THEN
                    RAISE EXCEPTION '%',v_failure USING ERRCODE='CL401';
                END IF;
                SELECT id,org_id,location_id,membership_id,kind,revoked_at,expires_at,public_key,
                    include_clinical,support_admin_name INTO v_device FROM device
                    WHERE id=v_exchange.device_id FOR UPDATE;
                IF v_device.kind IS DISTINCT FROM 'support' OR v_device.revoked_at IS NOT NULL
                    OR v_device.expires_at<=now() OR v_device.public_key IS NOT NULL
                    OR EXISTS(SELECT 1 FROM organizations WHERE id=v_device.org_id AND disabled_at IS NOT NULL) THEN
                    RAISE EXCEPTION '%',v_failure USING ERRCODE='CL401';
                END IF;
                UPDATE device SET public_key=v_key,public_key_bound_at=now()
                    WHERE id=v_device.id AND public_key IS NULL;
                IF NOT FOUND THEN RAISE EXCEPTION '%',v_failure USING ERRCODE='CL401'; END IF;
                UPDATE platform.support_exchanges SET used_at=now() WHERE exchange_hash=v_exchange.exchange_hash;
                RETURN jsonb_build_object('device_id',v_device.id,'org_id',v_device.org_id,
                    'location_id',v_device.location_id,'membership_id',v_device.membership_id,
                    'expires_at',v_device.expires_at,'include_clinical',v_device.include_clinical,
                    'admin_name',v_device.support_admin_name);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION support_exchange(jsonb) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION support_exchange(jsonb) TO clintra_app;

            CREATE FUNCTION end_support_session(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE v_member record; v_device record; v_now timestamptz:=now();
                v_uuid text:='^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
            BEGIN
                IF p IS NULL OR jsonb_typeof(p)<>'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k)
                        IS DISTINCT FROM ARRAY['audit_id','device_id']
                    OR coalesce(p->>'device_id' ~* v_uuid,false)=false
                    OR coalesce(p->>'audit_id' ~* v_uuid,false)=false THEN
                    RAISE EXCEPTION 'end_support_session: invalid payload' USING ERRCODE='22023';
                END IF;
                SELECT id,org_id INTO v_member FROM memberships
                    WHERE id=current_membership() AND role='owner' AND is_active;
                IF v_member.id IS NULL THEN
                    RAISE EXCEPTION 'end_support_session: unavailable' USING ERRCODE='CL403';
                END IF;
                SELECT id,org_id,kind,revoked_at INTO v_device FROM device
                    WHERE id=(p->>'device_id')::uuid AND org_id=v_member.org_id;
                IF v_device.id IS NULL THEN
                    RAISE EXCEPTION 'end_support_session: unavailable' USING ERRCODE='CL403';
                END IF;
                PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:'||v_member.org_id::text,0));
                SELECT id,org_id,kind,revoked_at INTO v_device FROM device
                    WHERE id=(p->>'device_id')::uuid AND org_id=v_member.org_id FOR UPDATE;
                IF v_device.kind IS DISTINCT FROM 'support' OR v_device.revoked_at IS NOT NULL THEN
                    RAISE EXCEPTION 'end_support_session: unavailable' USING ERRCODE='CL403';
                END IF;
                UPDATE device SET revoked_at=v_now WHERE id=v_device.id;
                DELETE FROM personal_access_tokens
                    WHERE tokenable_type='App\Models\Device' AND tokenable_id=v_device.id;
                INSERT INTO audit_log(id,org_id,actor_membership_id,entity,entity_id,action,before,after,at)
                VALUES(gen_random_uuid(),v_member.org_id,v_member.id,'device',v_device.id,'update',
                    jsonb_build_object('revoked_at',NULL),jsonb_build_object('revoked_at',v_now),v_now);
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION end_support_session(jsonb) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION end_support_session(jsonb) TO clintra_app;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA public FROM clintra_support;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DO $$ BEGIN
                EXECUTE 'SET LOCAL ROLE clintra_rls';
                IF EXISTS (SELECT 1 FROM device WHERE kind = 'support') THEN
                    RAISE EXCEPTION 'rollback of 000062 requires that no support device rows exist' USING ERRCODE = '55000';
                END IF;
                EXECUTE 'RESET ROLE';
            END $$;
            DROP FUNCTION end_support_session(jsonb);
            DROP FUNCTION support_exchange(jsonb);
            DROP FUNCTION mint_support_code(jsonb);
            DROP FUNCTION platform.admin_open_support_session(uuid,text,jsonb,uuid);
            DROP FUNCTION platform.admin_display_name(uuid);
            REVOKE EXECUTE ON FUNCTION current_membership() FROM clintra_support;
            REVOKE INSERT ON audit_log FROM clintra_support,clintra_admin_support;
            REVOKE SELECT (id,disabled_at) ON organizations FROM clintra_support,clintra_admin_support;
            REVOKE SELECT (tokenable_type,tokenable_id), DELETE ON personal_access_tokens FROM clintra_support;
            REVOKE UPDATE (public_key,public_key_bound_at,revoked_at) ON device FROM clintra_support;
            REVOKE SELECT (id,org_id,location_id,membership_id,kind,revoked_at,expires_at,public_key,
                include_clinical,support_admin_name)
                ON device FROM clintra_support;
            REVOKE SELECT, UPDATE (used_at) ON platform.support_exchanges FROM clintra_support;
            REVOKE INSERT ON activation_codes FROM clintra_support;
            REVOKE SELECT (id,code_hash) ON activation_codes FROM clintra_support;
            REVOKE SELECT (id,org_id) ON locations FROM clintra_support;
            REVOKE SELECT (id,org_id,role,is_active) ON memberships FROM clintra_support,clintra_admin_support;
            REVOKE INSERT ON platform.support_exchanges FROM clintra_admin_support;
            REVOKE SELECT (exchange_hash) ON platform.support_exchanges FROM clintra_admin_support;
            REVOKE SELECT (id,ip,user_agent) ON platform.admin_sessions FROM clintra_admin_support;
            REVOKE SELECT (id,org_id,kind,revoked_at,expires_at) ON device FROM clintra_admin_support;
            REVOKE INSERT ON device FROM clintra_admin_support;
            REVOKE UPDATE (used_at,used_by_device_id) ON activation_codes FROM clintra_admin_support;
            REVOKE SELECT (id,org_id,location_id,code_hash,expires_at,used_at,purpose,support_hours,
                include_clinical,created_by_membership_id) ON activation_codes FROM clintra_admin_support;
            SET ROLE clintra_rls;
            CREATE OR REPLACE FUNCTION device_exists(p_device_id uuid) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
                SELECT EXISTS (SELECT 1 FROM device WHERE id=p_device_id AND revoked_at IS NULL)
            $$;
            RESET ROLE;
            REVOKE SELECT (expires_at) ON device FROM clintra_rls;
            ALTER TABLE activation_codes DROP CONSTRAINT activation_codes_support_shape;
            ALTER TABLE activation_codes DROP COLUMN created_by_membership_id;
            ALTER TABLE activation_codes DROP COLUMN include_clinical;
            ALTER TABLE activation_codes DROP COLUMN support_hours;
            ALTER TABLE activation_codes DROP CONSTRAINT activation_codes_purpose_check;
            ALTER TABLE activation_codes ADD CONSTRAINT activation_codes_purpose_check
                CHECK (purpose IN ('device','owner_recovery'));
            ALTER TABLE device DROP CONSTRAINT device_series_shape;
            ALTER TABLE device DROP CONSTRAINT device_support_shape;
            ALTER TABLE device DROP COLUMN support_code_id;
            ALTER TABLE device DROP COLUMN support_admin_name;
            ALTER TABLE device DROP COLUMN include_clinical;
            ALTER TABLE device DROP COLUMN expires_at;
            ALTER TABLE device DROP COLUMN kind;
            ALTER TABLE device ALTER COLUMN series SET NOT NULL;
        SQL);
    }
};
