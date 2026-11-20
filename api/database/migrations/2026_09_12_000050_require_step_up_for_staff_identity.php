<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS auth_consume_staff_step_up(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS auth_set_username(jsonb)');

        DB::statement('SET ROLE clintra_auth');

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_consume_staff_step_up(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_attempt_id bigint;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY['attempt_id']
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number'
                    OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$' THEN
                    RAISE EXCEPTION 'auth: invalid step-up payload' USING ERRCODE = '22023';
                END IF;

                UPDATE login_attempts SET consumed_at = now()
                WHERE id = (p->>'attempt_id')::bigint AND membership_id = current_membership()
                  AND kind = 'step_up' AND succeeded AND consumed_at IS NULL AND at > now() - interval '2 minutes'
                RETURNING id INTO v_attempt_id;

                IF v_attempt_id IS NULL THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;
            END;
            $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_set_username(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_username text;
                v_caller record;
                v_target record;
                v_rev integer;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'membership_id', 'username'
                    ]
                    OR jsonb_typeof(p -> 'membership_id') IS DISTINCT FROM 'string' OR p->>'membership_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'username') IS DISTINCT FROM 'string' THEN
                    RAISE EXCEPTION 'auth_set_username: payload must be exactly {membership_id, username, audit_id, attempt_id}'
                        USING ERRCODE = '22023';
                END IF;

                v_username := lower(p->>'username');

                IF v_username !~ '^[a-z0-9._-]{3,32}$' THEN
                    RAISE EXCEPTION 'auth_set_username: username must be 3 to 32 characters of a-z, 0-9, ".", "_" or "-"'
                        USING ERRCODE = '22023';
                END IF;

                -- Owner only: the caller is an active owner, the target any
                -- member of the same organization, the owner included.
                SELECT id, org_id INTO v_caller
                FROM memberships WHERE id = current_membership() AND role = 'owner' AND is_active;
                SELECT id, org_id, username, rev INTO v_target
                FROM memberships WHERE id = (p->>'membership_id')::uuid;

                IF v_caller.id IS NULL OR v_target.id IS NULL OR v_target.org_id <> v_caller.org_id THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                PERFORM auth_consume_staff_step_up(jsonb_build_object('attempt_id', p->'attempt_id'));

                IF v_target.username IS NOT DISTINCT FROM v_username THEN
                    RETURN jsonb_build_object('membership_id', v_target.id, 'username', v_username, 'rev', v_target.rev, 'changed', false);
                END IF;

                -- A username another member holds raises 23505 here.
                UPDATE memberships SET username = v_username WHERE id = v_target.id
                RETURNING rev INTO v_rev;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'memberships', v_target.id, 'update',
                        jsonb_build_object('username', v_target.username), jsonb_build_object('username', v_username), now());

                RETURN jsonb_build_object('membership_id', v_target.id, 'username', v_username, 'rev', v_rev, 'changed', true);
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION auth_consume_staff_step_up(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_consume_staff_step_up(jsonb) TO clintra_app');
        DB::statement('REVOKE EXECUTE ON FUNCTION auth_set_username(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_set_username(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS auth_set_username(jsonb)');

        DB::statement('SET ROLE clintra_auth');

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_set_username(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_username text;
                v_caller record;
                v_target record;
                v_rev integer;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'audit_id', 'membership_id', 'username'
                    ]
                    OR jsonb_typeof(p -> 'membership_id') IS DISTINCT FROM 'string' OR p->>'membership_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'username') IS DISTINCT FROM 'string' THEN
                    RAISE EXCEPTION 'auth_set_username: payload must be exactly {membership_id, username, audit_id}'
                        USING ERRCODE = '22023';
                END IF;

                v_username := lower(p->>'username');

                IF v_username !~ '^[a-z0-9._-]{3,32}$' THEN
                    RAISE EXCEPTION 'auth_set_username: username must be 3 to 32 characters of a-z, 0-9, ".", "_" or "-"'
                        USING ERRCODE = '22023';
                END IF;

                -- Owner only: the caller is an active owner, the target any
                -- member of the same organization, the owner included.
                SELECT id, org_id INTO v_caller
                FROM memberships WHERE id = current_membership() AND role = 'owner' AND is_active;
                SELECT id, org_id, username, rev INTO v_target
                FROM memberships WHERE id = (p->>'membership_id')::uuid;

                IF v_caller.id IS NULL OR v_target.id IS NULL OR v_target.org_id <> v_caller.org_id THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                IF v_target.username IS NOT DISTINCT FROM v_username THEN
                    RETURN jsonb_build_object('membership_id', v_target.id, 'username', v_username, 'rev', v_target.rev, 'changed', false);
                END IF;

                -- A username another member holds raises 23505 here.
                UPDATE memberships SET username = v_username WHERE id = v_target.id
                RETURNING rev INTO v_rev;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'memberships', v_target.id, 'update',
                        jsonb_build_object('username', v_target.username), jsonb_build_object('username', v_username), now());

                RETURN jsonb_build_object('membership_id', v_target.id, 'username', v_username, 'rev', v_rev, 'changed', true);
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION auth_set_username(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_set_username(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');

        DB::statement('DROP FUNCTION IF EXISTS auth_consume_staff_step_up(jsonb)');
    }
};
