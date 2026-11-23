<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TABLE admin_code_notices (
                id uuid PRIMARY KEY,
                org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
                purpose text NOT NULL CHECK (purpose IN ('device','owner_recovery')),
                issued_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX admin_code_notices_org_time ON admin_code_notices (org_id,issued_at DESC);
            CREATE INDEX sync_ledger_device_applied ON sync_ledger (device_id, applied_at);
            ALTER TABLE admin_code_notices ENABLE ROW LEVEL SECURITY;
            ALTER TABLE admin_code_notices FORCE ROW LEVEL SECURITY;
            CREATE POLICY admin_code_notices_read ON admin_code_notices FOR SELECT TO clintra_app
                USING (org_id=current_org());
            CREATE POLICY admin_code_notices_write ON admin_code_notices FOR INSERT TO clintra_admin_mint
                WITH CHECK (true);
            GRANT SELECT (id,org_id,purpose,issued_at) ON admin_code_notices TO clintra_app;
            GRANT INSERT (id,org_id,purpose,issued_at) ON admin_code_notices TO clintra_admin_mint;

            GRANT SELECT (id,org_id,location_id,series,registered_at,revoked_at) ON device TO clintra_admin_device;
            GRANT UPDATE (revoked_at) ON device TO clintra_admin_device;
            GRANT SELECT (id,org_id,name) ON locations TO clintra_admin_device;
            GRANT SELECT (device_id,org_id,applied_at) ON sync_ledger TO clintra_admin_device;
            GRANT SELECT (id,org_id,role,is_active) ON memberships TO clintra_admin_device;
            GRANT SELECT (tokenable_type,tokenable_id), DELETE ON personal_access_tokens TO clintra_admin_device;
            GRANT INSERT ON audit_log TO clintra_admin_device;
            GRANT SELECT (id,ip,user_agent) ON platform.admin_sessions TO clintra_admin_device,clintra_admin_mint;
            GRANT SELECT (id) ON organizations TO clintra_admin_device;
            GRANT SELECT (id,disabled_at) ON organizations TO clintra_admin_mint;
            GRANT SELECT (id,org_id) ON locations TO clintra_admin_mint;
            GRANT SELECT (org_id,role,is_active) ON memberships TO clintra_admin_mint;
            GRANT SELECT,INSERT ON platform.admin_approvals TO clintra_admin_mint;
            GRANT UPDATE (approved_by,approved_at) ON platform.admin_approvals TO clintra_admin_mint;
            GRANT EXECUTE ON FUNCTION mint_activation_code(jsonb) TO clintra_admin_mint;
            ALTER POLICY organizations_scope ON organizations TO clintra_app,clintra_owner;
            ALTER POLICY locations_scope ON locations TO clintra_app,clintra_owner;
            ALTER POLICY memberships_scope ON memberships TO clintra_app,clintra_owner;
            CREATE POLICY organizations_admin_mint_read ON organizations FOR SELECT TO clintra_admin_mint
                USING (current_user='clintra_admin_mint');
            CREATE POLICY locations_admin_mint_read ON locations FOR SELECT TO clintra_admin_mint
                USING (current_user='clintra_admin_mint');
            CREATE POLICY memberships_admin_mint_read ON memberships FOR SELECT TO clintra_admin_mint
                USING (current_user='clintra_admin_mint');
            GRANT CREATE ON SCHEMA platform TO clintra_admin_auth,clintra_admin_device,clintra_admin_mint;

            SET ROLE clintra_admin_auth;
            CREATE FUNCTION platform.admin_active_count() RETURNS integer
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
                SELECT count(*)::integer FROM platform.admin_users WHERE is_active
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_active_count() FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_active_count() TO clintra_admin_mint;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_auth;

            SET ROLE clintra_admin_device;
            CREATE FUNCTION platform.admin_org_devices(p_session uuid,p_org uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,NULL,false);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_org uuid; v_devices jsonb; v_ip inet; v_agent text;
            BEGIN
                SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                IF v_reason IS NULL THEN
                    IF p_org IS NULL THEN v_reason:='invalid_payload';
                    ELSE
                        SELECT id INTO v_org FROM organizations WHERE id=p_org;
                        IF v_org IS NULL THEN v_reason:='not_found'; END IF;
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'location_name',l.name,
                        'series',d.series,'registered_at',d.registered_at,'revoked_at',d.revoked_at,
                        'last_sync_at',(SELECT max(sl.applied_at) FROM sync_ledger sl WHERE sl.device_id=d.id AND sl.org_id=d.org_id))
                        ORDER BY d.registered_at,d.id),'[]'::jsonb)
                    INTO v_devices FROM device d JOIN locations l ON l.id=d.location_id WHERE d.org_id=p_org;
                END IF;
                PERFORM platform.admin_log_write(gen_random_uuid(),v_admin,'figures.view',v_org,p_org,
                    v_reason IS NULL,v_reason,jsonb_build_object('operation','org.devices'),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason); END IF;
                RETURN jsonb_build_object('ok',true,'devices',v_devices);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_org_devices(uuid,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_org_devices(uuid,uuid) TO clintra_admin_app;

            CREATE FUNCTION platform.admin_revoke_device(p_session uuid,p_otp text,p_device_id uuid,p_log_id uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,p_otp,true);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_org uuid; v_revoked timestamptz; v_owner uuid; v_now timestamptz;
                v_ip inet; v_agent text; v_clinic_audit boolean := false;
            BEGIN
                SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                IF v_reason IS NULL AND p_device_id IS NOT NULL THEN
                    SELECT org_id INTO v_org FROM device WHERE id=p_device_id;
                END IF;
                IF v_reason IS NULL THEN
                    IF p_device_id IS NULL THEN v_reason:='invalid_payload';
                    ELSIF v_org IS NULL THEN v_reason:='not_found';
                    ELSE
                        PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:'||v_org::text,0));
                        SELECT revoked_at INTO v_revoked FROM device WHERE id=p_device_id FOR UPDATE;
                        IF v_revoked IS NOT NULL THEN v_reason:='unchanged';
                        ELSE
                            SELECT id INTO v_owner FROM memberships
                            WHERE org_id=v_org AND role='owner' AND is_active ORDER BY id LIMIT 1;
                            v_now:=now();
                            UPDATE device SET revoked_at=v_now WHERE id=p_device_id;
                            DELETE FROM personal_access_tokens
                            WHERE tokenable_type='App\Models\Device' AND tokenable_id=p_device_id;
                            IF v_owner IS NOT NULL THEN
                                INSERT INTO audit_log(id,org_id,actor_membership_id,entity,entity_id,action,before,after,at)
                                VALUES (gen_random_uuid(),v_org,v_owner,'device',p_device_id,'update',
                                    jsonb_build_object('revoked_at',NULL),jsonb_build_object('revoked_at',v_now),v_now);
                                v_clinic_audit:=true;
                            END IF;
                        END IF;
                    END IF;
                END IF;
                PERFORM platform.admin_log_write(coalesce(p_log_id,gen_random_uuid()),v_admin,'device.revoke',v_org,p_device_id,
                    v_reason IS NULL,v_reason,v_state||jsonb_build_object('clinic_audit',v_clinic_audit),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason)
                    || CASE WHEN coalesce((v_state->>'all_sessions_ended')::boolean,false)
                        THEN jsonb_build_object('all_sessions_ended',true) ELSE '{}'::jsonb END; END IF;
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_revoke_device(uuid,text,uuid,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_revoke_device(uuid,text,uuid,uuid) TO clintra_admin_app;
            RESET ROLE;

            SET ROLE clintra_admin_mint;
            CREATE FUNCTION platform.admin_org_approvals(p_session uuid,p_org uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,NULL,false);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_org uuid; v_rows jsonb; v_ip inet; v_agent text;
            BEGIN
                SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                IF v_reason IS NULL THEN
                    IF p_org IS NULL THEN v_reason:='invalid_payload';
                    ELSE
                        SELECT id INTO v_org FROM organizations WHERE id=p_org;
                        IF v_org IS NULL THEN v_reason:='not_found'; END IF;
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'location_id',a.location_id,
                        'purpose',a.purpose,'requested_at',a.requested_at,'expires_at',a.expires_at,
                        'can_approve',a.requested_by<>v_admin) ORDER BY a.requested_at,a.id),'[]'::jsonb)
                    INTO v_rows FROM platform.admin_approvals a
                    WHERE a.org_id=p_org AND a.approved_at IS NULL AND a.expires_at>now();
                END IF;
                PERFORM platform.admin_log_write(gen_random_uuid(),v_admin,'figures.view',v_org,p_org,
                    v_reason IS NULL,v_reason,jsonb_build_object('operation','org.approvals'),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason); END IF;
                RETURN jsonb_build_object('ok',true,'approvals',v_rows,'active_admin_count',platform.admin_active_count());
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_org_approvals(uuid,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_org_approvals(uuid,uuid) TO clintra_admin_app;

            CREATE FUNCTION platform.admin_request_code(p_session uuid,p_otp text,p_payload jsonb,p_log_id uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,p_otp,true);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_org uuid; v_location uuid; v_purpose text; v_hash text; v_approval uuid;
                v_count integer; v_ip inet; v_agent text; v_result jsonb; v_exists uuid; v_requested_org uuid;
            BEGIN
                SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                IF v_reason IS NULL THEN
                    IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN v_reason:='invalid_payload';
                    ELSIF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
                            WHERE k NOT IN ('approval_id','org_id','location_id','purpose','code_hash'))
                        OR coalesce(p_payload->>'org_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false)=false
                        OR coalesce(p_payload->>'location_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false)=false
                        OR coalesce(p_payload->>'approval_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',false)=false
                        OR coalesce(p_payload->>'purpose' IN ('device','owner_recovery'),false)=false
                        OR (p_payload ? 'code_hash' AND coalesce(p_payload->>'code_hash' ~ '^[0-9a-f]{64}$',false)=false)
                        THEN v_reason:='invalid_payload';
                    ELSE
                        v_org:=(p_payload->>'org_id')::uuid;
                        v_requested_org:=v_org;
                        v_location:=(p_payload->>'location_id')::uuid;
                        v_approval:=(p_payload->>'approval_id')::uuid;
                        v_purpose:=p_payload->>'purpose';
                        v_hash:=p_payload->>'code_hash';
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    PERFORM pg_advisory_xact_lock(hashtextextended('admin_code_mint',0));
                    PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:'||v_org::text,0));
                    SELECT org_id INTO v_exists FROM platform.admin_approvals WHERE id=v_approval;
                    IF FOUND THEN v_reason:='unchanged'; v_org:=v_exists;
                    ELSE
                    SELECT id INTO v_exists FROM organizations WHERE id=v_org;
                    IF v_exists IS NULL THEN v_reason:='not_found'; v_org:=NULL;
                    ELSIF EXISTS(SELECT 1 FROM organizations WHERE id=v_org AND disabled_at IS NOT NULL) THEN v_reason:='org_disabled';
                    ELSIF NOT EXISTS(SELECT 1 FROM locations WHERE id=v_location AND org_id=v_org) THEN v_reason:='location_mismatch';
                    ELSIF NOT EXISTS(SELECT 1 FROM memberships WHERE org_id=v_org AND role='owner' AND is_active) THEN v_reason:='no_owner';
                    END IF;
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    v_count:=platform.admin_active_count();
                    IF (v_count<2 AND v_hash IS NULL) OR (v_count>=2 AND v_hash IS NOT NULL) THEN
                        v_reason:='invalid_payload';
                    ELSIF v_count>=2 THEN
                        INSERT INTO platform.admin_approvals(id,action,org_id,location_id,purpose,requested_by,expires_at)
                        VALUES(v_approval,'code.mint',v_org,v_location,v_purpose,v_admin,now()+interval '1 hour');
                        v_result:=jsonb_build_object('ok',true,'pending',true,'approval_id',v_approval);
                    ELSE
                        PERFORM mint_activation_code(jsonb_build_object('id',gen_random_uuid(),'org_id',v_org,
                            'location_id',v_location,'code_hash',v_hash,'expires_at',
                            now()+CASE WHEN v_purpose='owner_recovery' THEN interval '24 hours' ELSE interval '72 hours' END,
                            'audit_id',gen_random_uuid(),'purpose',v_purpose));
                        INSERT INTO admin_code_notices(id,org_id,purpose,issued_at)
                        VALUES(gen_random_uuid(),v_org,v_purpose,now());
                        INSERT INTO platform.admin_approvals(id,action,org_id,location_id,purpose,requested_by,expires_at,approved_at)
                        VALUES(v_approval,'code.mint',v_org,v_location,v_purpose,v_admin,now()+interval '1 hour',now());
                        v_result:=jsonb_build_object('ok',true,'pending',false);
                    END IF;
                END IF;
                PERFORM platform.admin_log_write(coalesce(p_log_id,gen_random_uuid()),v_admin,'code.mint_request',v_org,
                    CASE WHEN v_reason='not_found' THEN v_requested_org ELSE coalesce(v_approval,v_location) END,
                    v_reason IS NULL,v_reason,
                    v_state||jsonb_build_object('purpose',v_purpose,'single_admin',coalesce(v_count<2,false)),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason)
                    || CASE WHEN coalesce((v_state->>'all_sessions_ended')::boolean,false)
                        THEN jsonb_build_object('all_sessions_ended',true) ELSE '{}'::jsonb END; END IF;
                RETURN v_result;
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_request_code(uuid,text,jsonb,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_request_code(uuid,text,jsonb,uuid) TO clintra_admin_app;

            CREATE FUNCTION platform.admin_approve_code(p_session uuid,p_otp text,p_approval_id uuid,p_code_hash text,p_log_id uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,platform,pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,p_otp,true);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_approval platform.admin_approvals%ROWTYPE;
                v_org uuid; v_ip inet; v_agent text;
            BEGIN
                SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                IF v_reason IS NULL THEN
                    IF p_approval_id IS NULL OR coalesce(p_code_hash ~ '^[0-9a-f]{64}$',false)=false THEN v_reason:='invalid_payload';
                    ELSE
                        SELECT org_id INTO v_org FROM platform.admin_approvals WHERE id=p_approval_id;
                        IF FOUND THEN
                            PERFORM pg_advisory_xact_lock(hashtextextended('admin_code_mint',0));
                            PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:'||v_org::text,0));
                            SELECT * INTO v_approval FROM platform.admin_approvals WHERE id=p_approval_id FOR UPDATE;
                        ELSE v_reason:='not_found'; END IF;
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    IF NOT FOUND THEN v_reason:='not_found';
                    ELSIF v_approval.approved_at IS NOT NULL THEN v_reason:='unchanged';
                    ELSIF v_approval.expires_at<=now() THEN v_reason:='expired';
                    ELSIF v_approval.requested_by=v_admin THEN v_reason:='same_admin';
                    ELSIF platform.admin_active_count()<2 THEN v_reason:='approval_unavailable';
                    ELSIF EXISTS(SELECT 1 FROM organizations WHERE id=v_org AND disabled_at IS NOT NULL) THEN v_reason:='org_disabled';
                    ELSIF NOT EXISTS(SELECT 1 FROM locations WHERE id=v_approval.location_id AND org_id=v_org) THEN v_reason:='location_mismatch';
                    ELSIF NOT EXISTS(SELECT 1 FROM memberships WHERE org_id=v_org AND role='owner' AND is_active) THEN v_reason:='no_owner';
                    ELSE
                            PERFORM mint_activation_code(jsonb_build_object('id',gen_random_uuid(),'org_id',v_org,
                                'location_id',v_approval.location_id,'code_hash',p_code_hash,'expires_at',
                                now()+CASE WHEN v_approval.purpose='owner_recovery' THEN interval '24 hours' ELSE interval '72 hours' END,
                                'audit_id',gen_random_uuid(),'purpose',v_approval.purpose));
                            UPDATE platform.admin_approvals SET approved_by=v_admin,approved_at=now() WHERE id=p_approval_id;
                            INSERT INTO admin_code_notices(id,org_id,purpose,issued_at)
                            VALUES(gen_random_uuid(),v_org,v_approval.purpose,now());
                    END IF;
                END IF;
                PERFORM platform.admin_log_write(coalesce(p_log_id,gen_random_uuid()),v_admin,'code.mint_approve',v_org,
                    p_approval_id,v_reason IS NULL,v_reason,v_state,v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason)
                    || CASE WHEN coalesce((v_state->>'all_sessions_ended')::boolean,false)
                        THEN jsonb_build_object('all_sessions_ended',true) ELSE '{}'::jsonb END; END IF;
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_approve_code(uuid,text,uuid,text,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_approve_code(uuid,text,uuid,text,uuid) TO clintra_admin_app;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_device,clintra_admin_mint;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP FUNCTION platform.admin_approve_code(uuid,text,uuid,text,uuid);
            DROP FUNCTION platform.admin_request_code(uuid,text,jsonb,uuid);
            DROP FUNCTION platform.admin_org_approvals(uuid,uuid);
            DROP FUNCTION platform.admin_revoke_device(uuid,text,uuid,uuid);
            DROP FUNCTION platform.admin_org_devices(uuid,uuid);
            DROP FUNCTION platform.admin_active_count();
            REVOKE EXECUTE ON FUNCTION mint_activation_code(jsonb) FROM clintra_admin_mint;
            REVOKE SELECT,INSERT ON platform.admin_approvals FROM clintra_admin_mint;
            REVOKE UPDATE (approved_by,approved_at) ON platform.admin_approvals FROM clintra_admin_mint;
            REVOKE SELECT (id,ip,user_agent) ON platform.admin_sessions FROM clintra_admin_device,clintra_admin_mint;
            REVOKE SELECT (id) ON organizations FROM clintra_admin_device;
            REVOKE SELECT (id,disabled_at) ON organizations FROM clintra_admin_mint;
            REVOKE SELECT (id,org_id) ON locations FROM clintra_admin_mint;
            REVOKE SELECT (org_id,role,is_active) ON memberships FROM clintra_admin_mint;
            DROP POLICY memberships_admin_mint_read ON memberships;
            DROP POLICY locations_admin_mint_read ON locations;
            DROP POLICY organizations_admin_mint_read ON organizations;
            ALTER POLICY memberships_scope ON memberships TO PUBLIC;
            ALTER POLICY locations_scope ON locations TO PUBLIC;
            ALTER POLICY organizations_scope ON organizations TO PUBLIC;
            REVOKE SELECT (id,org_id,location_id,series,registered_at,revoked_at) ON device FROM clintra_admin_device;
            REVOKE UPDATE (revoked_at) ON device FROM clintra_admin_device;
            REVOKE SELECT (id,org_id,name) ON locations FROM clintra_admin_device;
            REVOKE SELECT (device_id,org_id,applied_at) ON sync_ledger FROM clintra_admin_device;
            REVOKE SELECT (id,org_id,role,is_active) ON memberships FROM clintra_admin_device;
            REVOKE SELECT (tokenable_type,tokenable_id), DELETE ON personal_access_tokens FROM clintra_admin_device;
            REVOKE INSERT ON audit_log FROM clintra_admin_device;
            DROP INDEX IF EXISTS sync_ledger_device_applied;
            DROP TABLE admin_code_notices;
        SQL);
    }
};
