<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            GRANT SELECT (id,ip,user_agent) ON platform.admin_sessions TO clintra_admin_org;
            GRANT CREATE ON SCHEMA platform TO clintra_admin_org;
            SET ROLE clintra_admin_org;
            CREATE OR REPLACE FUNCTION platform.admin_set_org_disabled(p_session uuid, p_otp text, p_org uuid, p_disabled boolean,
                p_reason text, p_log_id uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,p_otp,true);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_org uuid;
                v_ip inet;
                v_agent text;
                v_action text := CASE WHEN p_disabled IS FALSE THEN 'org.enable' ELSE 'org.disable' END;
                v_reason text := nullif(btrim(p_reason),'');
                v_refusal text := v_state->>'reason';
            BEGIN
                IF v_admin IS NOT NULL THEN
                    SELECT ip,user_agent INTO v_ip,v_agent FROM platform.admin_sessions WHERE id=p_session;
                END IF;
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
                    v_refusal IS NULL,v_refusal,v_state || jsonb_build_object('reason',v_reason),v_ip,v_agent);
                IF v_refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_refusal); END IF;
                RETURN jsonb_build_object('ok',true);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_set_org_disabled(uuid,text,uuid,boolean,text,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_set_org_disabled(uuid,text,uuid,boolean,text,uuid) TO clintra_admin_app;

            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_org;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            GRANT CREATE ON SCHEMA platform TO clintra_admin_org;
            SET ROLE clintra_admin_org;
            CREATE OR REPLACE FUNCTION platform.admin_set_org_disabled(p_session uuid, p_otp text, p_org uuid, p_disabled boolean,
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

            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_org;
            REVOKE SELECT (id,ip,user_agent) ON platform.admin_sessions FROM clintra_admin_org;
        SQL);
    }
};
