<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('GRANT CREATE ON SCHEMA platform TO clintra_admin_auth');
        DB::statement('SET ROLE clintra_admin_auth');
        try {
            DB::unprepared(<<<'SQL'
                CREATE FUNCTION platform.totp_at(p_secret bytea, p_step bigint) RETURNS text
                LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                    WITH h AS (SELECT platform_crypto.hmac(int8send(p_step), p_secret, 'sha1') AS mac),
                         o AS (SELECT mac, get_byte(mac, 19) & 15 AS off FROM h)
                    SELECT lpad(((((get_byte(mac, off) & 127)::bigint << 24) | (get_byte(mac, off + 1)::bigint << 16)
                                 | (get_byte(mac, off + 2)::bigint << 8) | get_byte(mac, off + 3)) % 1000000)::text, 6, '0')
                    FROM o
                $$;
                REVOKE EXECUTE ON FUNCTION platform.totp_at(bytea, bigint) FROM PUBLIC;

                CREATE FUNCTION platform.admin_log_write(p_id uuid, p_admin uuid, p_action text, p_org uuid,
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
                REVOKE EXECUTE ON FUNCTION platform.admin_log_write(uuid,uuid,text,uuid,uuid,boolean,text,jsonb,inet,text) FROM PUBLIC;
                GRANT EXECUTE ON FUNCTION platform.admin_log_write(uuid,uuid,text,uuid,uuid,boolean,text,jsonb,inet,text)
                    TO clintra_admin_provision,clintra_admin_mint,clintra_admin_device,clintra_admin_org,clintra_admin_stats,clintra_admin_support;

                -- p: {email,password,otp,ip,user_agent,session_id,log_id}
                CREATE FUNCTION platform.admin_login(p jsonb) RETURNS jsonb
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                DECLARE
                    v_email text; v_ip inet; v_session uuid; v_log uuid; v_lock bigint;
                    v_user platform.admin_users%ROWTYPE;
                    v_now_step bigint := floor(extract(epoch FROM now()) / 30);
                    v_step bigint; v_ok boolean := false;
                BEGIN
                    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
                        RAISE EXCEPTION 'invalid login payload' USING ERRCODE='22023';
                    END IF;
                    IF NOT p ?& ARRAY['email','password','otp','ip','user_agent','session_id','log_id']
                        OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('email','password','otp','ip','user_agent','session_id','log_id'))
                        OR jsonb_typeof(p->'email') <> 'string' OR length(p->>'email') NOT BETWEEN 1 AND 254
                        OR jsonb_typeof(p->'password') <> 'string' OR octet_length(p->>'password') > 72
                        OR jsonb_typeof(p->'otp') <> 'string' OR length(p->>'otp') > 128
                        OR jsonb_typeof(p->'ip') NOT IN ('string','null')
                        OR jsonb_typeof(p->'user_agent') NOT IN ('string','null')
                        OR jsonb_typeof(p->'session_id') <> 'string' OR jsonb_typeof(p->'log_id') <> 'string' THEN
                        RAISE EXCEPTION 'invalid login payload' USING ERRCODE='22023';
                    END IF;
                    BEGIN
                        v_ip := (p->>'ip')::inet; v_session := (p->>'session_id')::uuid; v_log := (p->>'log_id')::uuid;
                    EXCEPTION WHEN invalid_text_representation THEN
                        RAISE EXCEPTION 'invalid login identifiers' USING ERRCODE='22023';
                    END;
                    v_email := lower(btrim(p->>'email'));
                    -- Serialize each independent limit, including unknown identities.
                    FOR v_lock IN SELECT DISTINCT hashtextextended(k,0) FROM unnest(ARRAY[
                        'admin.email:'||v_email, CASE WHEN v_ip IS NOT NULL THEN 'admin.ip:'||host(v_ip) END]) k
                        WHERE k IS NOT NULL ORDER BY 1 LOOP
                        PERFORM pg_advisory_xact_lock(v_lock);
                    END LOOP;
                    IF (SELECT count(*) FROM platform.admin_log WHERE action='admin.login' AND NOT succeeded
                        AND at > now()-interval '15 minutes' AND detail->>'email'=v_email) >= 5
                        OR (v_ip IS NOT NULL AND (SELECT count(*) FROM platform.admin_log WHERE action='admin.login'
                        AND NOT succeeded AND at > now()-interval '15 minutes' AND ip=v_ip) >= 5) THEN
                        PERFORM platform.admin_log_write(v_log,NULL,'admin.login',NULL,NULL,false,'rate_limited',
                            jsonb_build_object('email',v_email),v_ip,p->>'user_agent');
                        RETURN jsonb_build_object('ok',false,'reason','rate_limited');
                    END IF;
                    SELECT * INTO v_user FROM platform.admin_users WHERE email=v_email AND is_active FOR UPDATE;
                    IF v_user.id IS NULL THEN
                        PERFORM platform_crypto.crypt(p->>'password', platform_crypto.gen_salt('bf',12));
                    ELSIF platform_crypto.crypt(p->>'password',v_user.password_hash)=v_user.password_hash THEN
                        SELECT s INTO v_step FROM generate_series(v_now_step-1,v_now_step+1) s
                            WHERE platform.totp_at(v_user.totp_secret,s)=p->>'otp'
                              AND s > coalesce(v_user.last_totp_step,-1) ORDER BY s LIMIT 1;
                        IF v_step IS NOT NULL THEN
                            UPDATE platform.admin_users SET last_totp_step=v_step WHERE id=v_user.id;
                            v_ok := true;
                        ELSE
                            UPDATE platform.admin_recovery_codes SET used_at=now()
                                WHERE admin_user_id=v_user.id AND used_at IS NULL
                                  AND code_hash=encode(platform_crypto.digest(p->>'otp','sha256'),'hex');
                            v_ok := FOUND;
                        END IF;
                    END IF;
                    PERFORM platform.admin_log_write(v_log,CASE WHEN v_ok THEN v_user.id END,'admin.login',NULL,NULL,
                        v_ok,CASE WHEN NOT v_ok THEN 'bad_credentials' END,jsonb_build_object('email',v_email),v_ip,p->>'user_agent');
                    IF NOT v_ok THEN RETURN jsonb_build_object('ok',false,'reason','bad_credentials'); END IF;
                    UPDATE platform.admin_users SET last_login_at=now() WHERE id=v_user.id;
                    INSERT INTO platform.admin_sessions(id,admin_user_id,expires_at,ip,user_agent)
                        VALUES(v_session,v_user.id,now()+interval '8 hours',v_ip,left(p->>'user_agent',400));
                    RETURN jsonb_build_object('ok',true,'session_id',v_session,'name',v_user.name,'must_change_password',v_user.must_change_password);
                EXCEPTION WHEN unique_violation THEN
                    RAISE EXCEPTION 'invalid login identifiers' USING ERRCODE='22023';
                END;
                $$;
                REVOKE EXECUTE ON FUNCTION platform.admin_login(jsonb) FROM PUBLIC;
                GRANT EXECUTE ON FUNCTION platform.admin_login(jsonb) TO clintra_admin_app;

                -- Private resolution preserves attribution independently of step-up.
                CREATE FUNCTION platform.admin_session_state(p_session uuid,p_allow_password_change boolean DEFAULT false) RETURNS jsonb
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                DECLARE v_admin uuid; v_must_change boolean;
                BEGIN
                    IF p_allow_password_change IS NULL THEN RAISE EXCEPTION 'missing password-change policy' USING ERRCODE='22023'; END IF;
                    SELECT admin_user_id INTO v_admin FROM platform.admin_sessions WHERE id=p_session;
                    IF v_admin IS NULL THEN RETURN jsonb_build_object('ok',false,'admin_user_id',NULL,'reason','session_invalid'); END IF;
                    SELECT must_change_password INTO v_must_change FROM platform.admin_users WHERE id=v_admin AND is_active FOR UPDATE;
                    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'admin_user_id',NULL,'reason','session_invalid'); END IF;
                    PERFORM 1 FROM platform.admin_sessions WHERE id=p_session AND admin_user_id=v_admin
                        AND ended_at IS NULL AND expires_at>now() AND last_seen_at>now()-interval '30 minutes' FOR UPDATE;
                    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'admin_user_id',NULL,'reason','session_invalid'); END IF;
                    IF v_must_change AND NOT p_allow_password_change THEN
                        RETURN jsonb_build_object('ok',false,'admin_user_id',v_admin,'reason','password_change_required');
                    END IF;
                    RETURN jsonb_build_object('ok',true,'admin_user_id',v_admin);
                END;
                $$;
                REVOKE EXECUTE ON FUNCTION platform.admin_session_state(uuid,boolean) FROM PUBLIC;

                CREATE FUNCTION platform.admin_step_up(p_admin uuid,p_otp text) RETURNS jsonb
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                DECLARE v_secret bytea; v_last bigint; v_step bigint; v_failures integer; v_ended boolean:=false;
                    v_now_step bigint:=floor(extract(epoch FROM now())/30);
                BEGIN
                    SELECT totp_secret,last_totp_step INTO v_secret,v_last FROM platform.admin_users
                        WHERE id=p_admin AND is_active FOR UPDATE;
                    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'admin_user_id',NULL,'reason','session_invalid'); END IF;
                    SELECT count(*) INTO v_failures FROM platform.admin_log
                        WHERE admin_user_id=p_admin AND NOT succeeded AND reason='step_up_failed'
                          AND at>now()-interval '15 minutes';
                    IF v_failures<5 THEN
                        SELECT s INTO v_step FROM generate_series(v_now_step-1,v_now_step+1) s
                            WHERE platform.totp_at(v_secret,s)=p_otp AND s>coalesce(v_last,-1) ORDER BY s LIMIT 1;
                    END IF;
                    IF v_step IS NULL THEN
                        IF v_failures>=4 THEN
                            UPDATE platform.admin_sessions SET ended_at=now() WHERE admin_user_id=p_admin AND ended_at IS NULL;
                            v_ended:=true;
                        END IF;
                        RETURN jsonb_build_object('ok',false,'admin_user_id',p_admin,'reason','step_up_failed','all_sessions_ended',v_ended);
                    END IF;
                    UPDATE platform.admin_users SET last_totp_step=v_step WHERE id=p_admin;
                    RETURN jsonb_build_object('ok',true,'admin_user_id',p_admin);
                END;
                $$;
                REVOKE EXECUTE ON FUNCTION platform.admin_step_up(uuid,text) FROM PUBLIC;

                -- Action roles receive both the reason and the resolved actor.
                CREATE FUNCTION platform.admin_session_actor(p_session uuid,p_otp text,p_require_otp boolean) RETURNS jsonb
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                DECLARE v_state jsonb;
                BEGIN
                    IF p_require_otp IS NULL THEN RAISE EXCEPTION 'missing step-up requirement' USING ERRCODE='22023'; END IF;
                    v_state:=platform.admin_session_state(p_session,false);
                    IF NOT (v_state->>'ok')::boolean THEN RETURN v_state; END IF;
                    IF p_require_otp THEN
                        v_state:=platform.admin_step_up((v_state->>'admin_user_id')::uuid,p_otp);
                        IF NOT (v_state->>'ok')::boolean THEN RETURN v_state; END IF;
                    END IF;
                    UPDATE platform.admin_sessions SET last_seen_at=now() WHERE id=p_session;
                    RETURN v_state;
                END;
                $$;
                REVOKE EXECUTE ON FUNCTION platform.admin_session_actor(uuid,text,boolean) FROM PUBLIC;
                GRANT EXECUTE ON FUNCTION platform.admin_session_actor(uuid,text,boolean)
                    TO clintra_admin_provision,clintra_admin_mint,clintra_admin_device,clintra_admin_org,clintra_admin_stats,clintra_admin_support;

                CREATE FUNCTION platform.admin_logout(p_session uuid) RETURNS jsonb
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                DECLARE v_admin uuid; v_ip inet; v_agent text; v_state jsonb; v_reason text;
                BEGIN
                    v_state:=platform.admin_session_state(p_session,true);
                    v_admin:=(v_state->>'admin_user_id')::uuid; v_reason:=v_state->>'reason';
                    IF (v_state->>'ok')::boolean THEN
                        UPDATE platform.admin_sessions SET ended_at=now() WHERE id=p_session RETURNING ip,user_agent INTO v_ip,v_agent;
                    END IF;
                    PERFORM platform.admin_log_write(gen_random_uuid(),v_admin,'admin.logout',NULL,p_session,v_reason IS NULL,
                        v_reason,'{}',v_ip,v_agent);
                    IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason); END IF;
                    RETURN jsonb_build_object('ok',true);
                END;
                $$;
                REVOKE EXECUTE ON FUNCTION platform.admin_logout(uuid) FROM PUBLIC;
                GRANT EXECUTE ON FUNCTION platform.admin_logout(uuid) TO clintra_admin_app;

                -- p: {session_id,current_password,otp,password,log_id}; password is the new password.
                CREATE FUNCTION platform.admin_change_password(p jsonb) RETURNS jsonb
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                DECLARE v_admin uuid; v_session uuid; v_log uuid; v_ip inet; v_agent text; v_state jsonb; v_reason text; v_hash text; v_ended boolean:=false;
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
                        SELECT password_hash INTO v_hash FROM platform.admin_users WHERE id=v_admin;
                        IF platform_crypto.crypt(p->>'current_password',v_hash)<>v_hash OR p->>'password'=p->>'current_password' THEN
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

                -- p: {session_id,action,reason,log_id,target_id}; no caller-supplied actor or success flag.
                CREATE FUNCTION platform.admin_log_refusal(p jsonb) RETURNS jsonb
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
                DECLARE v_admin uuid; v_session uuid; v_log uuid; v_target uuid; v_ip inet; v_agent text; v_state jsonb; v_reason text;
                BEGIN
                    IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'invalid refusal payload' USING ERRCODE='22023'; END IF;
                    IF NOT p ?& ARRAY['session_id','action','reason','log_id','target_id']
                        OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('session_id','action','reason','log_id','target_id'))
                        OR jsonb_typeof(p->'session_id')<>'string' OR jsonb_typeof(p->'log_id')<>'string'
                        OR jsonb_typeof(p->'target_id') NOT IN ('string','null') OR jsonb_typeof(p->'reason')<>'string'
                        OR length(p->>'reason') NOT BETWEEN 1 AND 200 OR jsonb_typeof(p->'action')<>'string'
                        OR p->>'action' NOT IN ('admin.login','admin.logout','admin.password_change','figures.view','org.provision',
                            'code.mint_request','code.mint_approve','device.revoke','org.disable','org.enable','support.open') THEN
                        RAISE EXCEPTION 'invalid refusal payload' USING ERRCODE='22023';
                    END IF;
                    BEGIN v_session:=(p->>'session_id')::uuid; v_log:=(p->>'log_id')::uuid; v_target:=(p->>'target_id')::uuid;
                    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid refusal identifiers' USING ERRCODE='22023'; END;
                    v_state:=platform.admin_session_actor(v_session,NULL,false);
                    v_admin:=(v_state->>'admin_user_id')::uuid; v_reason:=v_state->>'reason';
                    IF (v_state->>'ok')::boolean THEN SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=v_session; END IF;
                    PERFORM platform.admin_log_write(v_log,v_admin,p->>'action',NULL,v_target,false,
                        coalesce(v_reason,p->>'reason'),'{}',v_ip,v_agent);
                    IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason); END IF;
                    RETURN jsonb_build_object('ok',true);
                END;
                $$;
                REVOKE EXECUTE ON FUNCTION platform.admin_log_refusal(jsonb) FROM PUBLIC;
                GRANT EXECUTE ON FUNCTION platform.admin_log_refusal(jsonb) TO clintra_admin_app;

                -- p: {log_id,action,target_id,succeeded,reason,detail}; CLI targets are immutable identifiers,
                -- not foreign keys, so the operator history survives removal of a test/retired target.
                CREATE FUNCTION platform.admin_log_cli(p jsonb) RETURNS jsonb
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
                REVOKE EXECUTE ON FUNCTION platform.admin_log_cli(jsonb) FROM PUBLIC;
                GRANT EXECUTE ON FUNCTION platform.admin_log_cli(jsonb) TO clintra_owner;
            SQL);
        } finally {
            DB::statement('RESET ROLE');
        }
        DB::statement('REVOKE CREATE ON SCHEMA platform FROM clintra_admin_auth');
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP FUNCTION platform.admin_log_cli(jsonb);
            DROP FUNCTION platform.admin_log_refusal(jsonb);
            DROP FUNCTION platform.admin_change_password(jsonb);
            DROP FUNCTION platform.admin_logout(uuid);
            DROP FUNCTION platform.admin_session_actor(uuid,text,boolean);
            DROP FUNCTION platform.admin_step_up(uuid,text);
            DROP FUNCTION platform.admin_session_state(uuid,boolean);
            DROP FUNCTION platform.admin_login(jsonb);
            DROP FUNCTION platform.admin_log_write(uuid,uuid,text,uuid,uuid,boolean,text,jsonb,inet,text);
            DROP FUNCTION platform.totp_at(bytea,bigint);
        SQL);
    }
};
