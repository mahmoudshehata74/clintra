<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Consume a successful step-up in the same transaction as the identity
 * change, so an attempt can authorize only one successful change.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE login_attempts ADD COLUMN consumed_at timestamptz NULL');
        DB::statement('GRANT UPDATE (consumed_at) ON login_attempts TO clintra_auth');

        DB::statement('DROP FUNCTION IF EXISTS auth_set_password(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS auth_reset_member_password(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS auth_revoke_credential(jsonb)');

        DB::statement('SET ROLE clintra_auth');

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_set_password(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_member_id uuid;
                v_org_id uuid;
                v_attempt_id bigint;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'membership_id', 'new_hash'
                    ]
                    OR jsonb_typeof(p -> 'membership_id') IS DISTINCT FROM 'string' OR p->>'membership_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number' OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$'
                    OR jsonb_typeof(p -> 'new_hash') IS DISTINCT FROM 'string' OR p->>'new_hash' !~ '^\$argon2id\$' THEN
                    RAISE EXCEPTION 'auth_set_password: payload must be exactly {membership_id, new_hash, attempt_id, audit_id}'
                        USING ERRCODE = '22023';
                END IF;

                v_member_id := (p->>'membership_id')::uuid;

                -- The caller is the proven person, sets only their own
                -- password, and has just retyped the current one.
                SELECT org_id INTO v_org_id FROM memberships WHERE id = v_member_id AND is_active;

                IF current_membership() IS DISTINCT FROM v_member_id OR v_org_id IS NULL THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE login_attempts SET consumed_at = now()
                WHERE id = (p->>'attempt_id')::bigint AND membership_id = v_member_id AND kind = 'step_up'
                  AND succeeded AND consumed_at IS NULL AND at > now() - interval '2 minutes'
                RETURNING id INTO v_attempt_id;

                IF v_attempt_id IS NULL THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE member_passwords
                SET password_hash = p->>'new_hash', must_change = false, set_at = now(), set_by_membership_id = v_member_id
                WHERE membership_id = v_member_id;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_org_id, v_member_id, 'member_passwords', v_member_id, 'update', NULL,
                        jsonb_build_object('changed', true), now());
            END;
            $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_reset_member_password(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_caller record;
                v_target record;
                v_attempt_id bigint;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'target_membership_id', 'temporary_hash'
                    ]
                    OR jsonb_typeof(p -> 'target_membership_id') IS DISTINCT FROM 'string' OR p->>'target_membership_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number' OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$'
                    OR jsonb_typeof(p -> 'temporary_hash') IS DISTINCT FROM 'string' OR p->>'temporary_hash' !~ '^\$argon2id\$' THEN
                    RAISE EXCEPTION 'auth_reset_member_password: payload must be exactly {target_membership_id, temporary_hash, attempt_id, audit_id}'
                        USING ERRCODE = '22023';
                END IF;

                SELECT id, org_id, role, permissions INTO v_caller
                FROM memberships WHERE id = current_membership() AND is_active;
                SELECT id, org_id, role, username, permissions INTO v_target
                FROM memberships WHERE id = (p->>'target_membership_id')::uuid;

                -- Nobody resets their own password here. A non-owner can
                -- reset only an assistant or manager whose permissions they hold.
                IF v_caller.id IS NULL OR v_target.id IS NULL OR v_target.org_id <> v_caller.org_id OR v_target.id = v_caller.id
                    OR (v_caller.role <> 'owner' AND (
                        NOT ('staff.manage' = ANY (v_caller.permissions))
                        OR v_target.role IN ('owner', 'practitioner')
                        OR NOT (v_target.permissions <@ v_caller.permissions))) THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE login_attempts SET consumed_at = now()
                WHERE id = (p->>'attempt_id')::bigint AND membership_id = v_caller.id AND kind = 'step_up'
                  AND succeeded AND consumed_at IS NULL AND at > now() - interval '2 minutes'
                RETURNING id INTO v_attempt_id;

                IF v_attempt_id IS NULL THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                IF v_target.username IS NULL THEN
                    RAISE EXCEPTION 'auth: the member has no username' USING ERRCODE = 'CL422';
                END IF;

                INSERT INTO member_passwords (membership_id, org_id, password_hash, must_change, set_at, set_by_membership_id)
                VALUES (v_target.id, v_target.org_id, p->>'temporary_hash', true, now(), v_caller.id)
                ON CONFLICT (membership_id) DO UPDATE
                SET password_hash = EXCLUDED.password_hash, must_change = true,
                    set_at = EXCLUDED.set_at, set_by_membership_id = EXCLUDED.set_by_membership_id;

                UPDATE member_credentials
                SET revoked_at = now(), revoked_by_membership_id = v_caller.id, revoke_reason = 'password_reset'
                WHERE membership_id = v_target.id AND revoked_at IS NULL;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'member_passwords', v_target.id, 'update', NULL,
                        jsonb_build_object('reset', true), now());
            END;
            $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_revoke_credential(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_caller record;
                v_cred record;
                v_target record;
                v_attempt_id bigint;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'credential_id'
                    ]
                    OR jsonb_typeof(p -> 'credential_id') IS DISTINCT FROM 'string' OR p->>'credential_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number' OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$' THEN
                    RAISE EXCEPTION 'auth_revoke_credential: payload must be exactly {credential_id, attempt_id, audit_id}'
                        USING ERRCODE = '22023';
                END IF;

                SELECT id, org_id, role, permissions INTO v_caller
                FROM memberships WHERE id = current_membership() AND is_active;
                SELECT id, org_id, membership_id INTO v_cred
                FROM member_credentials WHERE id = (p->>'credential_id')::uuid AND revoked_at IS NULL;
                SELECT role, permissions INTO v_target FROM memberships WHERE id = v_cred.membership_id;

                -- An owner can revoke their own credential. A non-owner can
                -- revoke only another assistant or manager's credential and
                -- must hold all the target's permissions.
                IF v_caller.id IS NULL OR v_cred.id IS NULL OR v_cred.org_id <> v_caller.org_id
                    OR (v_caller.role <> 'owner' AND (
                        NOT ('staff.manage' = ANY (v_caller.permissions))
                        OR v_cred.membership_id = v_caller.id
                        OR v_target.role IN ('owner', 'practitioner')
                        OR NOT (v_target.permissions <@ v_caller.permissions))) THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE login_attempts SET consumed_at = now()
                WHERE id = (p->>'attempt_id')::bigint AND membership_id = v_caller.id AND kind = 'step_up'
                  AND succeeded AND consumed_at IS NULL AND at > now() - interval '2 minutes'
                RETURNING id INTO v_attempt_id;

                IF v_attempt_id IS NULL THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE member_credentials
                SET revoked_at = now(), revoked_by_membership_id = v_caller.id, revoke_reason = 'owner_revoked'
                WHERE id = v_cred.id;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'member_credentials', v_cred.id, 'update', NULL,
                        jsonb_build_object('revoked', true), now());
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION auth_set_password(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_set_password(jsonb) TO clintra_app');
        DB::statement('REVOKE EXECUTE ON FUNCTION auth_reset_member_password(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_reset_member_password(jsonb) TO clintra_app');
        DB::statement('REVOKE EXECUTE ON FUNCTION auth_revoke_credential(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_revoke_credential(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS auth_set_password(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS auth_reset_member_password(jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS auth_revoke_credential(jsonb)');

        DB::statement('SET ROLE clintra_auth');

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_set_password(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_member_id uuid;
                v_org_id uuid;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'membership_id', 'new_hash'
                    ]
                    OR jsonb_typeof(p -> 'membership_id') IS DISTINCT FROM 'string' OR p->>'membership_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number' OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$'
                    OR jsonb_typeof(p -> 'new_hash') IS DISTINCT FROM 'string' OR p->>'new_hash' !~ '^\$argon2id\$' THEN
                    RAISE EXCEPTION 'auth_set_password: payload must be exactly {membership_id, new_hash, attempt_id, audit_id}'
                        USING ERRCODE = '22023';
                END IF;

                v_member_id := (p->>'membership_id')::uuid;

                -- The caller is the proven person, sets only their own
                -- password, and has just retyped the current one.
                SELECT org_id INTO v_org_id FROM memberships WHERE id = v_member_id AND is_active;

                IF current_membership() IS DISTINCT FROM v_member_id OR v_org_id IS NULL
                    OR NOT EXISTS (
                        SELECT 1 FROM login_attempts
                        WHERE id = (p->>'attempt_id')::bigint AND membership_id = v_member_id AND kind = 'step_up'
                          AND succeeded AND at > now() - interval '2 minutes'
                    ) THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE member_passwords
                SET password_hash = p->>'new_hash', must_change = false, set_at = now(), set_by_membership_id = v_member_id
                WHERE membership_id = v_member_id;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_org_id, v_member_id, 'member_passwords', v_member_id, 'update', NULL,
                        jsonb_build_object('changed', true), now());
            END;
            $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_reset_member_password(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_caller record;
                v_target record;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'target_membership_id', 'temporary_hash'
                    ]
                    OR jsonb_typeof(p -> 'target_membership_id') IS DISTINCT FROM 'string' OR p->>'target_membership_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number' OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$'
                    OR jsonb_typeof(p -> 'temporary_hash') IS DISTINCT FROM 'string' OR p->>'temporary_hash' !~ '^\$argon2id\$' THEN
                    RAISE EXCEPTION 'auth_reset_member_password: payload must be exactly {target_membership_id, temporary_hash, attempt_id, audit_id}'
                        USING ERRCODE = '22023';
                END IF;

                SELECT id, org_id, role, permissions INTO v_caller
                FROM memberships WHERE id = current_membership() AND is_active;
                SELECT id, org_id, role, username, permissions INTO v_target
                FROM memberships WHERE id = (p->>'target_membership_id')::uuid;

                -- Nobody resets their own password here. A non-owner can
                -- reset only an assistant or manager whose permissions they hold.
                IF v_caller.id IS NULL OR v_target.id IS NULL OR v_target.org_id <> v_caller.org_id OR v_target.id = v_caller.id
                    OR (v_caller.role <> 'owner' AND (
                        NOT ('staff.manage' = ANY (v_caller.permissions))
                        OR v_target.role IN ('owner', 'practitioner')
                        OR NOT (v_target.permissions <@ v_caller.permissions)))
                    OR NOT EXISTS (
                        SELECT 1 FROM login_attempts
                        WHERE id = (p->>'attempt_id')::bigint AND membership_id = v_caller.id AND kind = 'step_up'
                          AND succeeded AND at > now() - interval '2 minutes'
                    ) THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                IF v_target.username IS NULL THEN
                    RAISE EXCEPTION 'auth: the member has no username' USING ERRCODE = 'CL422';
                END IF;

                INSERT INTO member_passwords (membership_id, org_id, password_hash, must_change, set_at, set_by_membership_id)
                VALUES (v_target.id, v_target.org_id, p->>'temporary_hash', true, now(), v_caller.id)
                ON CONFLICT (membership_id) DO UPDATE
                SET password_hash = EXCLUDED.password_hash, must_change = true,
                    set_at = EXCLUDED.set_at, set_by_membership_id = EXCLUDED.set_by_membership_id;

                UPDATE member_credentials
                SET revoked_at = now(), revoked_by_membership_id = v_caller.id, revoke_reason = 'password_reset'
                WHERE membership_id = v_target.id AND revoked_at IS NULL;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'member_passwords', v_target.id, 'update', NULL,
                        jsonb_build_object('reset', true), now());
            END;
            $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_revoke_credential(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_caller record;
                v_cred record;
                v_target record;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'credential_id'
                    ]
                    OR jsonb_typeof(p -> 'credential_id') IS DISTINCT FROM 'string' OR p->>'credential_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'audit_id') IS DISTINCT FROM 'string' OR p->>'audit_id' !~* v_uuid
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number' OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$' THEN
                    RAISE EXCEPTION 'auth_revoke_credential: payload must be exactly {credential_id, attempt_id, audit_id}'
                        USING ERRCODE = '22023';
                END IF;

                SELECT id, org_id, role, permissions INTO v_caller
                FROM memberships WHERE id = current_membership() AND is_active;
                SELECT id, org_id, membership_id INTO v_cred
                FROM member_credentials WHERE id = (p->>'credential_id')::uuid AND revoked_at IS NULL;
                SELECT role, permissions INTO v_target FROM memberships WHERE id = v_cred.membership_id;

                -- An owner can revoke their own credential. A non-owner can
                -- revoke only another assistant or manager's credential and
                -- must hold all the target's permissions.
                IF v_caller.id IS NULL OR v_cred.id IS NULL OR v_cred.org_id <> v_caller.org_id
                    OR (v_caller.role <> 'owner' AND (
                        NOT ('staff.manage' = ANY (v_caller.permissions))
                        OR v_cred.membership_id = v_caller.id
                        OR v_target.role IN ('owner', 'practitioner')
                        OR NOT (v_target.permissions <@ v_caller.permissions)))
                    OR NOT EXISTS (
                        SELECT 1 FROM login_attempts
                        WHERE id = (p->>'attempt_id')::bigint AND membership_id = v_caller.id AND kind = 'step_up'
                          AND succeeded AND at > now() - interval '2 minutes'
                    ) THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE member_credentials
                SET revoked_at = now(), revoked_by_membership_id = v_caller.id, revoke_reason = 'owner_revoked'
                WHERE id = v_cred.id;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'member_credentials', v_cred.id, 'update', NULL,
                        jsonb_build_object('revoked', true), now());
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION auth_set_password(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_set_password(jsonb) TO clintra_app');
        DB::statement('REVOKE EXECUTE ON FUNCTION auth_reset_member_password(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_reset_member_password(jsonb) TO clintra_app');
        DB::statement('REVOKE EXECUTE ON FUNCTION auth_revoke_credential(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_revoke_credential(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');

        DB::statement('ALTER TABLE login_attempts DROP COLUMN consumed_at');
    }
};
