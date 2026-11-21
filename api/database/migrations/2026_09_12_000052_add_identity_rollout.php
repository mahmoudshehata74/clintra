<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS auth_identity_rollout(jsonb)');

        DB::statement('GRANT UPDATE (permissions) ON memberships TO clintra_auth');
        DB::statement('GRANT UPDATE (identity_enforced_at) ON organizations TO clintra_auth');
        DB::statement('GRANT SELECT (org_id, entity, at, after) ON audit_log TO clintra_auth');
        DB::statement('GRANT INSERT (op_id, org_id, entity, entity_id, rev, actor_membership_id, device_id, applied_at, client_created_at) ON sync_ledger TO clintra_auth');
        DB::statement('SET ROLE clintra_auth');

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_identity_rollout(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_action text := p->>'action';
                v_org_id uuid;
                v_actor_id uuid;
                v_device_id uuid;
                v_enforced_at timestamptz;
                v_first_password_at timestamptz;
                v_auto_at timestamptz;
                v_now timestamptz;
                v_owner_ready boolean;
                v_all_named boolean;
                v_all_bound boolean;
                v_ready boolean;
                v_members jsonb;
                v_devices jsonb;
                v_status jsonb;
                v_member record;
            BEGIN
                IF v_action IN ('candidates', 'automatic') THEN
                    -- Only the scheduler's CLI connection may select another
                    -- organization. No request can supply this scope.
                    IF session_user <> 'clintra_owner' THEN
                        RAISE EXCEPTION 'auth: not allowed';
                    END IF;
                    IF v_action = 'candidates' THEN
                        RETURN jsonb_build_object('organizations', COALESCE((
                            SELECT jsonb_agg(o.id ORDER BY o.id)
                            FROM organizations o
                            WHERE o.identity_enforced_at IS NULL AND (
                                EXISTS (
                                    SELECT 1 FROM member_passwords pw JOIN memberships m ON m.id = pw.membership_id
                                    WHERE pw.org_id = o.id AND m.org_id = o.id AND m.role = 'owner'
                                      AND pw.set_at <= now() - interval '720 hours'
                                ) OR EXISTS (
                                    SELECT 1 FROM audit_log a WHERE a.org_id = o.id AND a.entity = 'member_passwords'
                                      AND a.after->>'recovered' = 'true' AND a.at <= now() - interval '720 hours'
                                )
                            )
                        ), '[]'::jsonb));
                    END IF;
                    v_org_id := (p->>'org_id')::uuid;
                ELSIF v_action IN ('status', 'warning', 'manual') THEN
                    v_org_id := current_org();
                    v_actor_id := current_membership();
                    IF v_org_id IS NULL OR (v_action <> 'warning' AND NOT EXISTS (
                        SELECT 1 FROM memberships
                        WHERE id = v_actor_id AND org_id = v_org_id AND is_active AND role = 'owner'
                    )) THEN
                        RAISE EXCEPTION 'auth: not allowed';
                    END IF;
                ELSE
                    RAISE EXCEPTION 'auth_identity_rollout: invalid action' USING ERRCODE = '22023';
                END IF;

                IF v_action IN ('manual', 'automatic') THEN
                    -- SyncSeqLock. The org row lock also serializes with
                    -- registration's foreign key to organizations.
                    PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:' || v_org_id::text, 0));
                    SELECT identity_enforced_at INTO v_enforced_at
                    FROM organizations WHERE id = v_org_id FOR UPDATE;
                ELSE
                    SELECT identity_enforced_at INTO v_enforced_at FROM organizations WHERE id = v_org_id;
                END IF;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                v_now := statement_timestamp();
                -- Recovery records the first real owner password in the
                -- immutable audit log. Later recovery/change cannot reset
                -- the clock, even if the original owner is now inactive.
                SELECT COALESCE(
                    (SELECT min(a.at) FROM audit_log a
                     WHERE a.org_id = v_org_id AND a.entity = 'member_passwords' AND a.after->>'recovered' = 'true'),
                    (SELECT min(pw.set_at) FROM member_passwords pw JOIN memberships m ON m.id = pw.membership_id
                     WHERE pw.org_id = v_org_id AND m.org_id = v_org_id AND m.role = 'owner')
                ) INTO v_first_password_at;
                v_auto_at := v_first_password_at + interval '720 hours';

                IF v_action = 'warning' THEN
                    IF v_enforced_at IS NULL AND v_now >= v_auto_at - interval '168 hours' THEN
                        RETURN jsonb_build_object('auto_at', v_auto_at);
                    END IF;
                    RETURN NULL;
                END IF;

                IF v_action = 'manual' THEN
                    SELECT id INTO v_device_id FROM device
                    WHERE id = (p->>'device_id')::uuid AND org_id = v_org_id
                      AND revoked_at IS NULL AND public_key IS NOT NULL;
                    IF v_device_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM memberships
                        WHERE id = v_actor_id AND org_id = v_org_id AND is_active AND role = 'owner'
                    ) THEN
                        RAISE EXCEPTION 'auth: not allowed';
                    END IF;
                END IF;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', m.id, 'display_name', m.display_name, 'role', m.role,
                    'has_username', m.username IS NOT NULL, 'has_password', pw.membership_id IS NOT NULL,
                    'signed_in', EXISTS (
                        SELECT 1 FROM member_credentials c JOIN device d ON d.id = c.device_id
                        WHERE c.org_id = v_org_id AND c.membership_id = m.id AND c.revoked_at IS NULL
                          AND d.org_id = v_org_id AND d.revoked_at IS NULL AND d.public_key IS NOT NULL
                    )) ORDER BY m.display_name, m.id), '[]'::jsonb),
                    COALESCE(bool_or(m.role = 'owner' AND m.username IS NOT NULL AND pw.membership_id IS NOT NULL), false),
                    COALESCE(bool_and(m.username IS NOT NULL), true)
                INTO v_members, v_owner_ready, v_all_named
                FROM memberships m LEFT JOIN member_passwords pw ON pw.membership_id = m.id AND pw.org_id = v_org_id
                WHERE m.org_id = v_org_id AND m.is_active;

                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'bound', public_key IS NOT NULL
                ) ORDER BY id), '[]'::jsonb),
                    COALESCE(bool_and(public_key IS NOT NULL), true)
                INTO v_devices, v_all_bound
                FROM device WHERE org_id = v_org_id AND revoked_at IS NULL;

                v_ready := v_owner_ready AND v_all_named AND v_all_bound;
                v_status := jsonb_build_object(
                    'identity_enforced_at', v_enforced_at, 'auto_at', v_auto_at,
                    'waiting', v_auto_at IS NOT NULL AND v_now >= v_auto_at AND NOT v_ready AND v_enforced_at IS NULL,
                    'ready', v_ready, 'members', v_members, 'devices', v_devices,
                    'blockers', to_jsonb(array_remove(ARRAY[
                        CASE WHEN NOT v_owner_ready THEN 'rolloutOwnerMissing' END,
                        CASE WHEN NOT v_all_named THEN 'rolloutUsernamesMissing' END,
                        CASE WHEN NOT v_all_bound THEN 'rolloutDevicesUnbound' END
                    ], NULL))
                );
                IF v_action = 'status' OR v_enforced_at IS NOT NULL OR NOT v_ready
                    OR (v_action = 'automatic' AND (v_auto_at IS NULL OR v_now < v_auto_at)) THEN
                    RETURN v_status;
                END IF;

                IF v_action = 'manual' THEN
                    PERFORM auth_consume_staff_step_up(jsonb_build_object('attempt_id', p->'attempt_id'));
                ELSE
                    -- The system records the eligible owner's membership and
                    -- a same-org device for the ledger's required foreign keys.
                    SELECT m.id INTO v_actor_id FROM memberships m JOIN member_passwords pw ON pw.membership_id = m.id
                    WHERE m.org_id = v_org_id AND pw.org_id = v_org_id AND m.role = 'owner' AND m.is_active
                      AND m.username IS NOT NULL ORDER BY m.id LIMIT 1;
                    SELECT id INTO v_device_id FROM device WHERE org_id = v_org_id
                    ORDER BY (revoked_at IS NOT NULL), id LIMIT 1;
                END IF;

                FOR v_member IN
                    UPDATE memberships SET permissions = CASE role
                        WHEN 'owner' THEN ARRAY['reports.view', 'services.manage', 'invoices.edit_items', 'invoices.void', 'cash.close',
                                                'staff.manage', 'schedules.manage', 'clinical.view', 'patients.archive', 'messages.send']
                        WHEN 'practitioner' THEN ARRAY['clinical.view', 'reports.view', 'patients.archive', 'messages.send', 'cash.close']
                        ELSE ARRAY['reports.view', 'patients.archive', 'messages.send', 'cash.close']
                    END
                    WHERE org_id = v_org_id AND is_active AND cardinality(permissions) = 0
                    RETURNING id, rev, permissions
                LOOP
                    INSERT INTO sync_ledger
                        (op_id, org_id, entity, entity_id, rev, actor_membership_id, device_id, applied_at, client_created_at)
                    VALUES (gen_random_uuid(), v_org_id, 'memberships', v_member.id, v_member.rev,
                            v_actor_id, v_device_id, v_now, v_now);
                    INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                    VALUES (gen_random_uuid(), v_org_id, v_actor_id, 'memberships', v_member.id, 'update',
                            jsonb_build_object('permissions', '[]'::jsonb),
                            jsonb_build_object('permissions', v_member.permissions, 'identity_rollout', v_action), v_now);
                END LOOP;

                UPDATE organizations SET identity_enforced_at = v_now WHERE id = v_org_id;
                RETURN v_status || jsonb_build_object('identity_enforced_at', v_now, 'waiting', false);
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION auth_identity_rollout(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_identity_rollout(jsonb) TO clintra_app, clintra_owner');
        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION auth_identity_rollout(jsonb)');
        DB::statement('REVOKE INSERT (op_id, org_id, entity, entity_id, rev, actor_membership_id, device_id, applied_at, client_created_at) ON sync_ledger FROM clintra_auth');
        DB::statement('REVOKE SELECT (org_id, entity, at, after) ON audit_log FROM clintra_auth');
        DB::statement('REVOKE UPDATE (identity_enforced_at) ON organizations FROM clintra_auth');
        DB::statement('REVOKE UPDATE (permissions) ON memberships FROM clintra_auth');
    }
};
