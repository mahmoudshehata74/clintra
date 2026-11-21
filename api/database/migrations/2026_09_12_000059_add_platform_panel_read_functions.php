<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            ALTER TABLE platform.admin_log DROP CONSTRAINT admin_log_action_check;
            ALTER TABLE platform.admin_log ADD CONSTRAINT admin_log_action_check CHECK (action IN ('admin.login','admin.logout','admin.password_change','figures.view','org.provision','code.mint_request','code.mint_approve','device.revoke','org.disable','org.enable','support.open','cli.provision','cli.mint','cli.revoke','cli.admin_create','cli.org_disable','cli.org_enable','admin.log_view'));
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
                    'support.open','cli.provision','cli.mint','cli.revoke','cli.admin_create','cli.org_disable','cli.org_enable','admin.log_view')
                    OR (p_detail IS NOT NULL AND jsonb_typeof(p_detail) <> 'object') THEN
                    RAISE EXCEPTION 'invalid admin log payload' USING ERRCODE='22023';
                END IF;
                INSERT INTO platform.admin_log (id,admin_user_id,action,org_id,target_id,succeeded,reason,detail,ip,user_agent)
                VALUES (p_id,p_admin,p_action,p_org,p_target,p_ok,p_reason,coalesce(p_detail,'{}'::jsonb),p_ip,left(p_user_agent,400));
            EXCEPTION WHEN unique_violation OR foreign_key_violation THEN
                RAISE EXCEPTION 'invalid admin log identifiers' USING ERRCODE='22023';
            END;
            $$;
            CREATE OR REPLACE FUNCTION platform.admin_change_password(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE v_admin uuid; v_session uuid; v_log uuid; v_ip inet; v_agent text; v_state jsonb; v_reason text; v_hash text; v_failures integer; v_ended boolean:=false;
            BEGIN
                IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'invalid password payload' USING ERRCODE='22023'; END IF;
                IF NOT p ?& ARRAY['session_id','current_password','otp','password','log_id']
                    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('session_id','current_password','otp','password','log_id'))
                    OR jsonb_typeof(p->'session_id')<>'string' OR jsonb_typeof(p->'log_id')<>'string'
                    OR jsonb_typeof(p->'current_password')<>'string' OR octet_length(p->>'current_password')>72
                    OR jsonb_typeof(p->'otp')<>'string' OR length(p->>'otp')>128
                    OR jsonb_typeof(p->'password')<>'string' OR octet_length(p->>'password') NOT BETWEEN 12 AND 72 THEN
                    RAISE EXCEPTION 'invalid password payload' USING ERRCODE='22023';
                END IF;
                BEGIN v_session:=(p->>'session_id')::uuid; v_log:=(p->>'log_id')::uuid;
                EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid password identifiers' USING ERRCODE='22023'; END;
                v_state:=platform.admin_session_state(v_session,true);
                v_admin:=(v_state->>'admin_user_id')::uuid; v_reason:=v_state->>'reason';
                IF (v_state->>'ok')::boolean THEN
                    SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=v_session;
                    -- admin_session_state holds this admin's row lock through the refusal log.
                    SELECT password_hash INTO v_hash FROM platform.admin_users WHERE id=v_admin FOR UPDATE;
                    SELECT count(*) INTO v_failures FROM platform.admin_log
                        WHERE admin_user_id=v_admin AND NOT succeeded
                          AND reason IN ('step_up_failed','current_password_failed')
                          AND at>now()-interval '15 minutes';
                    IF platform_crypto.crypt(p->>'current_password',v_hash)<>v_hash THEN
                        v_reason:='current_password_failed';
                        IF v_failures>=4 THEN
                            UPDATE platform.admin_sessions SET ended_at=now() WHERE admin_user_id=v_admin AND ended_at IS NULL;
                            v_ended:=true;
                        END IF;
                    ELSIF p->>'password'=p->>'current_password' THEN
                        v_reason:='bad_credentials';
                    ELSE
                        v_state:=platform.admin_step_up(v_admin,p->>'otp');
                        v_reason:=v_state->>'reason'; v_ended:=coalesce((v_state->>'all_sessions_ended')::boolean,false);
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    UPDATE platform.admin_users SET password_hash=platform_crypto.crypt(p->>'password',platform_crypto.gen_salt('bf',12)),must_change_password=false WHERE id=v_admin;
                    UPDATE platform.admin_sessions SET ended_at=now() WHERE admin_user_id=v_admin AND id<>v_session AND ended_at IS NULL;
                    UPDATE platform.admin_sessions SET last_seen_at=now() WHERE id=v_session;
                END IF;
                PERFORM platform.admin_log_write(v_log,v_admin,'admin.password_change',NULL,NULL,v_reason IS NULL,
                    v_reason,jsonb_build_object('all_sessions_ended',v_ended),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN
                    RETURN jsonb_build_object('ok',false,'reason',v_reason) ||
                        CASE WHEN v_ended THEN jsonb_build_object('all_sessions_ended',true) ELSE '{}'::jsonb END;
                END IF;
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_change_password(jsonb) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_change_password(jsonb) TO clintra_admin_app;

            -- Success is deliberately silent; this function runs for every panel request.
            CREATE FUNCTION platform.admin_whoami(p_session uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE v_state jsonb; v_result jsonb;
            BEGIN
                v_state := platform.admin_session_state(p_session,true);
                IF NOT (v_state->>'ok')::boolean THEN
                    RETURN jsonb_build_object('ok',false,'reason','session_invalid');
                END IF;
                SELECT jsonb_build_object('ok',true,'name',name,'email',email,'must_change_password',must_change_password)
                    INTO v_result FROM platform.admin_users WHERE id=(v_state->>'admin_user_id')::uuid;
                UPDATE platform.admin_sessions SET last_seen_at=now() WHERE id=p_session;
                RETURN v_result;
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_whoami(uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_whoami(uuid) TO clintra_admin_app;

            -- p: {before_seq?,page_size?,admin_user_id?,org_id?,action?,from?,to?}.
            -- Dates are inclusive Cairo calendar dates; the default window is the last 30 days.
            CREATE FUNCTION platform.admin_log_page(p_session uuid,p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_state(p_session,false);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_ip inet; v_agent text;
                v_before bigint; v_size integer := 25; v_filter_admin uuid; v_org uuid; v_action text;
                v_from date; v_to date; v_rows jsonb; v_next text;
            BEGIN
                IF v_admin IS NOT NULL THEN
                    SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                END IF;
                IF v_reason IS NULL THEN
                    BEGIN
                        IF p IS NULL OR jsonb_typeof(p)<>'object' THEN
                            v_reason := 'invalid_payload';
                        ELSIF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN
                            ('before_seq','page_size','admin_user_id','org_id','action','from','to')) THEN
                            v_reason := 'invalid_payload';
                        ELSE
                            IF p ? 'page_size' THEN
                                IF jsonb_typeof(p->'page_size')<>'number' OR (p->>'page_size') !~ '^[0-9]{1,3}$' THEN
                                    v_reason := 'invalid_payload';
                                ELSE v_size := (p->>'page_size')::integer; END IF;
                            END IF;
                            IF v_size NOT BETWEEN 1 AND 100 THEN v_reason := 'invalid_payload'; END IF;
                            IF p ? 'before_seq' AND p->'before_seq'<>'null'::jsonb THEN
                                IF jsonb_typeof(p->'before_seq') NOT IN ('number','string') OR (p->>'before_seq') !~ '^[0-9]{1,19}$' THEN
                                    v_reason := 'invalid_payload';
                                ELSE
                                    v_before := (p->>'before_seq')::bigint;
                                    IF v_before<1 THEN v_reason := 'invalid_payload'; END IF;
                                END IF;
                            END IF;
                            IF p ? 'admin_user_id' AND p->'admin_user_id'<>'null'::jsonb THEN
                                IF jsonb_typeof(p->'admin_user_id')<>'string' THEN v_reason := 'invalid_payload';
                                ELSE v_filter_admin := (p->>'admin_user_id')::uuid; END IF;
                            END IF;
                            IF p ? 'org_id' AND p->'org_id'<>'null'::jsonb THEN
                                IF jsonb_typeof(p->'org_id')<>'string' THEN v_reason := 'invalid_payload';
                                ELSE v_org := (p->>'org_id')::uuid; END IF;
                            END IF;
                            IF p ? 'action' AND p->'action'<>'null'::jsonb THEN
                                IF jsonb_typeof(p->'action')<>'string' OR char_length(p->>'action') NOT BETWEEN 1 AND 100 THEN
                                    v_reason := 'invalid_payload';
                                ELSE v_action := p->>'action'; END IF;
                            END IF;
                            IF p ? 'to' AND p->'to'<>'null'::jsonb THEN
                                IF jsonb_typeof(p->'to')<>'string' OR (p->>'to') !~ '^\d{4}-\d{2}-\d{2}$' THEN v_reason := 'invalid_payload';
                                ELSE v_to := (p->>'to')::date; END IF;
                            END IF;
                            IF p ? 'from' AND p->'from'<>'null'::jsonb THEN
                                IF jsonb_typeof(p->'from')<>'string' OR (p->>'from') !~ '^\d{4}-\d{2}-\d{2}$' THEN v_reason := 'invalid_payload';
                                ELSE v_from := (p->>'from')::date; END IF;
                            END IF;
                            v_to := coalesce(v_to,(now() AT TIME ZONE 'Africa/Cairo')::date);
                            v_from := coalesce(v_from,v_to-29);
                            IF v_to<v_from OR v_to-v_from>365 THEN v_reason := 'invalid_payload'; END IF;
                        END IF;
                    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
                        v_reason := 'invalid_payload';
                    END;
                END IF;
                IF v_reason IS NOT NULL THEN
                    PERFORM platform.admin_log_write(gen_random_uuid(),v_admin,'admin.log_view',NULL,NULL,false,v_reason,'{}',v_ip,v_agent);
                    RETURN jsonb_build_object('ok',false,'reason',v_reason);
                END IF;
                -- Only the explicit public log columns and the admin's display name cross this boundary.
                WITH page AS (
                    SELECT l.seq,l.id,l.at,l.admin_user_id,l.action,l.org_id,l.target_id,l.succeeded,l.reason,l.detail,l.ip,l.user_agent,u.name AS admin_name
                    FROM platform.admin_log l LEFT JOIN platform.admin_users u ON u.id=l.admin_user_id
                    WHERE (v_before IS NULL OR l.seq<v_before)
                      AND (v_filter_admin IS NULL OR l.admin_user_id=v_filter_admin)
                      AND (v_org IS NULL OR l.org_id=v_org) AND (v_action IS NULL OR l.action=v_action)
                      AND l.at>=(v_from::timestamp AT TIME ZONE 'Africa/Cairo')
                      AND l.at<((v_to+1)::timestamp AT TIME ZONE 'Africa/Cairo')
                    ORDER BY l.seq DESC LIMIT v_size+1
                ), numbered AS (
                    SELECT *,row_number() OVER (ORDER BY seq DESC) AS position FROM page
                )
                SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'seq',seq::text,'id',id,'at',at,'admin_user_id',admin_user_id,'admin_name',admin_name,
                    'action',action,'org_id',org_id,'target_id',target_id,'succeeded',succeeded,'reason',reason,
                    'detail',detail,'ip',ip,'user_agent',user_agent) ORDER BY seq DESC) FILTER (WHERE position<=v_size),'[]'::jsonb),
                    CASE WHEN count(*)>v_size THEN min(seq) FILTER (WHERE position<=v_size)::text END
                    INTO v_rows,v_next FROM numbered;
                RETURN jsonb_build_object('ok',true,'rows',v_rows,'next_before_seq',v_next);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_log_page(uuid,jsonb) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_log_page(uuid,jsonb) TO clintra_admin_app;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_auth;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP FUNCTION platform.admin_log_page(uuid,jsonb);
            DROP FUNCTION platform.admin_whoami(uuid);
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
            CREATE OR REPLACE FUNCTION platform.admin_change_password(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE v_admin uuid; v_session uuid; v_log uuid; v_ip inet; v_agent text; v_state jsonb; v_reason text; v_hash text; v_failures integer; v_ended boolean:=false;
            BEGIN
                IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'invalid password payload' USING ERRCODE='22023'; END IF;
                IF NOT p ?& ARRAY['session_id','current_password','otp','password','log_id']
                    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('session_id','current_password','otp','password','log_id'))
                    OR jsonb_typeof(p->'session_id')<>'string' OR jsonb_typeof(p->'log_id')<>'string'
                    OR jsonb_typeof(p->'current_password')<>'string' OR octet_length(p->>'current_password')>72
                    OR jsonb_typeof(p->'otp')<>'string' OR length(p->>'otp')>128
                    OR jsonb_typeof(p->'password')<>'string' OR octet_length(p->>'password') NOT BETWEEN 12 AND 72 THEN
                    RAISE EXCEPTION 'invalid password payload' USING ERRCODE='22023';
                END IF;
                BEGIN v_session:=(p->>'session_id')::uuid; v_log:=(p->>'log_id')::uuid;
                EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid password identifiers' USING ERRCODE='22023'; END;
                v_state:=platform.admin_session_state(v_session,true);
                v_admin:=(v_state->>'admin_user_id')::uuid; v_reason:=v_state->>'reason';
                IF (v_state->>'ok')::boolean THEN
                    SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=v_session;
                    -- admin_session_state holds this admin's row lock through the refusal log.
                    SELECT password_hash INTO v_hash FROM platform.admin_users WHERE id=v_admin FOR UPDATE;
                    SELECT count(*) INTO v_failures FROM platform.admin_log
                        WHERE admin_user_id=v_admin AND NOT succeeded
                          AND reason IN ('step_up_failed','current_password_failed')
                          AND at>now()-interval '15 minutes';
                    IF platform_crypto.crypt(p->>'current_password',v_hash)<>v_hash THEN
                        v_reason:='current_password_failed';
                        IF v_failures>=4 THEN
                            UPDATE platform.admin_sessions SET ended_at=now() WHERE admin_user_id=v_admin AND ended_at IS NULL;
                            v_ended:=true;
                        END IF;
                    ELSIF p->>'password'=p->>'current_password' THEN
                        v_reason:='bad_credentials';
                    ELSE
                        v_state:=platform.admin_step_up(v_admin,p->>'otp');
                        v_reason:=v_state->>'reason'; v_ended:=coalesce((v_state->>'all_sessions_ended')::boolean,false);
                    END IF;
                END IF;
                IF v_reason IS NULL THEN
                    UPDATE platform.admin_users SET password_hash=platform_crypto.crypt(p->>'password',platform_crypto.gen_salt('bf',12)),must_change_password=false WHERE id=v_admin;
                    UPDATE platform.admin_sessions SET ended_at=now() WHERE admin_user_id=v_admin AND id<>v_session AND ended_at IS NULL;
                    UPDATE platform.admin_sessions SET last_seen_at=now() WHERE id=v_session;
                END IF;
                PERFORM platform.admin_log_write(v_log,v_admin,'admin.password_change',NULL,NULL,v_reason IS NULL,
                    v_reason,jsonb_build_object('all_sessions_ended',v_ended),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason); END IF;
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_change_password(jsonb) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_change_password(jsonb) TO clintra_admin_app;

            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_auth;
            ALTER TABLE platform.admin_log DROP CONSTRAINT admin_log_action_check;
            ALTER TABLE platform.admin_log ADD CONSTRAINT admin_log_action_check CHECK (action IN ('admin.login','admin.logout','admin.password_change','figures.view','org.provision','code.mint_request','code.mint_approve','device.revoke','org.disable','org.enable','support.open','cli.provision','cli.mint','cli.revoke','cli.admin_create','cli.org_disable','cli.org_enable')) NOT VALID;
        SQL);
    }
};
