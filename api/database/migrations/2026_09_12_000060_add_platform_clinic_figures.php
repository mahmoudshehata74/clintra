<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            GRANT SELECT (id,name,disabled_at,disabled_reason) ON organizations TO clintra_admin_stats;
            GRANT SELECT (id,org_id,name,is_active) ON locations TO clintra_admin_stats;
            GRANT SELECT (org_id,is_active) ON practitioners TO clintra_admin_stats;
            GRANT SELECT (org_id,is_active) ON memberships TO clintra_admin_stats;
            GRANT SELECT (org_id,revoked_at) ON device TO clintra_admin_stats;
            GRANT SELECT (org_id,applied_at) ON sync_ledger TO clintra_admin_stats;
            GRANT SELECT (org_id,visit_date,status) ON visits TO clintra_admin_stats;
            GRANT SELECT (id,org_id,total,status,issued_at) ON invoices TO clintra_admin_stats;
            GRANT SELECT (invoice_id,amount,created_at) ON payments TO clintra_admin_stats;
            GRANT SELECT (id,ip,user_agent) ON platform.admin_sessions TO clintra_admin_stats;
            GRANT CREATE ON SCHEMA platform TO clintra_admin_stats;
            SET ROLE clintra_admin_stats;

            CREATE FUNCTION platform.admin_org_figures(p_session uuid, p_from date, p_to date, p_log_id uuid)
            RETURNS TABLE (org_id uuid, org_name text, disabled_at timestamptz, active_locations bigint,
                active_practitioners bigint, active_members bigint, active_devices bigint, last_sync_at timestamptz,
                visits_completed bigint, visits_cancelled bigint, visits_no_show bigint,
                invoices_issued bigint, billed_piastres bigint, collected_piastres bigint)
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,NULL,false);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_ip inet; v_agent text;
                v_to date := coalesce(p_to,(now() AT TIME ZONE 'Africa/Cairo')::date);
                v_from date := coalesce(p_from,v_to-29);
            BEGIN
                SELECT s.ip,s.user_agent INTO v_ip,v_agent FROM platform.admin_sessions s WHERE s.id=p_session;
                IF v_reason IS NULL AND (NOT isfinite(v_from) OR NOT isfinite(v_to)
                    OR v_from>v_to OR v_to-v_from>365) THEN
                    v_reason := 'invalid_payload';
                END IF;
                PERFORM platform.admin_log_write(coalesce(p_log_id,gen_random_uuid()),v_admin,'figures.view',NULL,NULL,
                    v_reason IS NULL,v_reason,jsonb_build_object('from',v_from,'to',v_to),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN; END IF;
                RETURN QUERY
                SELECT o.id,o.name::text,o.disabled_at,
                    (SELECT count(*) FROM locations l WHERE l.org_id=o.id AND l.is_active),
                    (SELECT count(*) FROM practitioners pr WHERE pr.org_id=o.id AND pr.is_active),
                    (SELECT count(*) FROM memberships m WHERE m.org_id=o.id AND m.is_active),
                    (SELECT count(*) FROM device d WHERE d.org_id=o.id AND d.revoked_at IS NULL),
                    (SELECT max(sl.applied_at) FROM sync_ledger sl WHERE sl.org_id=o.id),
                    (SELECT count(*) FROM visits v WHERE v.org_id=o.id AND v.visit_date BETWEEN v_from AND v_to AND v.status='completed'),
                    (SELECT count(*) FROM visits v WHERE v.org_id=o.id AND v.visit_date BETWEEN v_from AND v_to AND v.status='cancelled'),
                    (SELECT count(*) FROM visits v WHERE v.org_id=o.id AND v.visit_date BETWEEN v_from AND v_to AND v.status='no_show'),
                    (SELECT count(*) FROM invoices i WHERE i.org_id=o.id AND i.status<>'void'
                        AND (i.issued_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to),
                    (SELECT coalesce(sum(i.total),0)::bigint FROM invoices i WHERE i.org_id=o.id AND i.status<>'void'
                        AND (i.issued_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to),
                    (SELECT coalesce(sum(pa.amount),0)::bigint FROM payments pa JOIN invoices i ON i.id=pa.invoice_id
                        WHERE i.org_id=o.id AND (pa.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_from AND v_to)
                FROM organizations o ORDER BY o.name,o.id;
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_org_figures(uuid,date,date,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_org_figures(uuid,date,date,uuid) TO clintra_admin_app;

            CREATE FUNCTION platform.admin_org_detail(p_session uuid, p_org uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,NULL,false);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_ip inet; v_agent text; v_org jsonb;
            BEGIN
                SELECT s.ip,s.user_agent INTO v_ip,v_agent FROM platform.admin_sessions s WHERE s.id=p_session;
                IF v_reason IS NULL THEN
                    IF p_org IS NULL THEN v_reason := 'invalid_payload';
                    ELSE
                        SELECT jsonb_build_object('id',o.id,'name',o.name,'disabled_at',o.disabled_at,
                            'disabled_reason',o.disabled_reason,'locations',coalesce((
                                SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) ORDER BY l.name,l.id)
                                FROM locations l WHERE l.org_id=o.id),'[]'::jsonb))
                        INTO v_org FROM organizations o WHERE o.id=p_org;
                        IF NOT FOUND THEN v_reason := 'not_found'; END IF;
                    END IF;
                END IF;
                PERFORM platform.admin_log_write(gen_random_uuid(),v_admin,'figures.view',
                    CASE WHEN v_org IS NOT NULL THEN p_org END,p_org,v_reason IS NULL,v_reason,
                    jsonb_build_object('operation','org.detail'),v_ip,v_agent);
                IF v_reason IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_reason); END IF;
                RETURN jsonb_build_object('ok',true,'org',v_org);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_org_detail(uuid,uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_org_detail(uuid,uuid) TO clintra_admin_app;

            CREATE FUNCTION platform.admin_org_names(p_session uuid, p_ids uuid[]) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,NULL,false);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_ip inet; v_agent text; v_names jsonb;
            BEGIN
                SELECT s.ip,s.user_agent INTO v_ip,v_agent FROM platform.admin_sessions s WHERE s.id=p_session;
                IF v_reason IS NULL AND (p_ids IS NULL OR cardinality(p_ids)>100
                    OR coalesce(array_ndims(p_ids),1)<>1 OR EXISTS(SELECT 1 FROM unnest(p_ids) id WHERE id IS NULL)) THEN
                    v_reason := 'invalid_payload';
                END IF;
                IF v_reason IS NOT NULL THEN
                    PERFORM platform.admin_log_write(gen_random_uuid(),v_admin,'figures.view',NULL,NULL,false,v_reason,
                        jsonb_build_object('operation','org.names','count',cardinality(p_ids)),v_ip,v_agent);
                    RETURN jsonb_build_object('ok',false,'reason',v_reason);
                END IF;
                SELECT coalesce(jsonb_object_agg(o.id::text,o.name),'{}'::jsonb) INTO v_names
                    FROM organizations o WHERE o.id=ANY(p_ids);
                RETURN jsonb_build_object('ok',true,'names',v_names);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_org_names(uuid,uuid[]) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_org_names(uuid,uuid[]) TO clintra_admin_app;

            CREATE FUNCTION platform.admin_org_list(p_session uuid) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
            DECLARE
                v_state jsonb := platform.admin_session_actor(p_session,NULL,false);
                v_admin uuid := (v_state->>'admin_user_id')::uuid;
                v_reason text := v_state->>'reason';
                v_ip inet; v_agent text; v_clinics jsonb;
            BEGIN
                SELECT s.ip,s.user_agent INTO v_ip,v_agent FROM platform.admin_sessions s WHERE s.id=p_session;
                IF v_reason IS NOT NULL THEN
                    PERFORM platform.admin_log_write(gen_random_uuid(),v_admin,'figures.view',NULL,NULL,false,v_reason,
                        jsonb_build_object('operation','org.list'),v_ip,v_agent);
                    RETURN jsonb_build_object('ok',false,'reason',v_reason);
                END IF;
                SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) ORDER BY o.name,o.id),'[]'::jsonb)
                    INTO v_clinics FROM organizations o;
                RETURN jsonb_build_object('ok',true,'clinics',v_clinics);
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_org_list(uuid) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION platform.admin_org_list(uuid) TO clintra_admin_app;
            RESET ROLE;
            REVOKE CREATE ON SCHEMA platform FROM clintra_admin_stats;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP FUNCTION platform.admin_org_list(uuid);
            DROP FUNCTION platform.admin_org_names(uuid,uuid[]);
            DROP FUNCTION platform.admin_org_detail(uuid,uuid);
            DROP FUNCTION platform.admin_org_figures(uuid,date,date,uuid);
            REVOKE SELECT (id,name,disabled_at,disabled_reason) ON organizations FROM clintra_admin_stats;
            REVOKE SELECT (id,org_id,name,is_active) ON locations FROM clintra_admin_stats;
            REVOKE SELECT (org_id,is_active) ON practitioners FROM clintra_admin_stats;
            REVOKE SELECT (org_id,is_active) ON memberships FROM clintra_admin_stats;
            REVOKE SELECT (org_id,revoked_at) ON device FROM clintra_admin_stats;
            REVOKE SELECT (org_id,applied_at) ON sync_ledger FROM clintra_admin_stats;
            REVOKE SELECT (org_id,visit_date,status) ON visits FROM clintra_admin_stats;
            REVOKE SELECT (id,org_id,total,status,issued_at) ON invoices FROM clintra_admin_stats;
            REVOKE SELECT (invoice_id,amount,created_at) ON payments FROM clintra_admin_stats;
            REVOKE SELECT (id,ip,user_agent) ON platform.admin_sessions FROM clintra_admin_stats;
        SQL);
    }
};
