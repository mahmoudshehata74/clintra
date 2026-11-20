<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Identity phase A1: the auth functions (docs/design-identity-permissions.md,
 * 6.4, and "A1 decisions"). Every one is SECURITY DEFINER, owned by
 * clintra_auth (2026_09_12_000043 holds its grants), search_path pinned,
 * validates its payload's keys and shapes before any read (SQLSTATE 22023),
 * takes every id from the caller (none calls gen_random_uuid()), and is
 * executable by clintra_app only.
 *
 * Errors the endpoints tell apart:
 * - 'auth: not allowed' (P0001) — every refusal about who is asking or what
 *   they may touch; one message, so a refusal says nothing about what exists;
 * - CL429 — auth_login_begin's database rate limits;
 * - CL422 — a reset for a member who has no username yet (they could never
 *   sign in with the temporary password);
 * - 23505 — a username another member of the organization already has;
 * - 'auth_recover_owner: recovery failed' (P0001) — every credential problem
 *   of an owner recovery, as register_device.
 *
 * Differences from the design's 6.4, each from the A1 decisions:
 * - auth_attempt_succeeded (decision 3) is the one way an attempt is marked
 *   succeeded: only for that attempt's own credential (a sign-in) or person
 *   (a step-up), only within 2 minutes of the attempt, only once.
 *   auth_login_complete calls it; every step-up endpoint calls it after the
 *   password verifies. The rate limits count failed attempts only.
 * - auth_login_begin takes `kind`: a step-up resolves only to the caller
 *   (current_membership()), so a step-up never verifies anyone else's
 *   password.
 * - auth_set_password, auth_reset_member_password and auth_revoke_credential
 *   take the caller's succeeded step-up attempt (attempt_id): the database
 *   refuses them without one, whatever PHP did.
 * - auth_set_username (decision 1) is the eighth function; auth_recover_owner
 *   takes the owner's username (sets it when null, must match when set) and
 *   the device it runs on, so the endpoint can record the membership's new
 *   rev in sync_ledger for that device.
 */
return new class extends Migration
{
    /** @var list<string> */
    private const FUNCTIONS = [
        'auth_login_begin', 'auth_login_complete', 'auth_attempt_succeeded', 'auth_set_password',
        'auth_reset_member_password', 'auth_revoke_credential', 'auth_recover_owner', 'auth_set_username',
    ];

    public function up(): void
    {
        foreach (self::FUNCTIONS as $function) {
            DB::statement("DROP FUNCTION IF EXISTS {$function}(jsonb)");
        }

        DB::statement('SET ROLE clintra_auth');

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_attempt_succeeded(p jsonb) RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_attempt record;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY['attempt_id']
                    OR jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number'
                    OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$' THEN
                    RAISE EXCEPTION 'auth_attempt_succeeded: payload must be exactly {attempt_id}, a positive integer'
                        USING ERRCODE = '22023';
                END IF;

                SELECT id, device_id, membership_id, kind, at INTO v_attempt
                FROM login_attempts
                WHERE id = (p->>'attempt_id')::bigint
                  AND NOT succeeded
                  AND membership_id IS NOT NULL
                  AND at > now() - interval '2 minutes'
                FOR UPDATE;

                IF v_attempt.id IS NULL THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                -- A step-up is the caller's own: the request proved who it is.
                IF v_attempt.kind = 'step_up' AND current_membership() IS DISTINCT FROM v_attempt.membership_id THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                -- A sign-in succeeded only once its credential exists: a live
                -- credential of that person on that device, made after the
                -- attempt (auth_login_complete makes it, then calls this).
                IF v_attempt.kind = 'login' AND NOT EXISTS (
                    SELECT 1 FROM member_credentials
                    WHERE membership_id = v_attempt.membership_id AND device_id = v_attempt.device_id
                      AND revoked_at IS NULL AND created_at >= v_attempt.at
                ) THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                UPDATE login_attempts SET succeeded = true WHERE id = v_attempt.id;
            END;
            $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_login_begin(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_device_id uuid;
                v_org_id uuid;
                v_username text;
                v_member_id uuid;
                v_hash text;
                v_attempt bigint;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY['device_id', 'kind', 'username'] THEN
                    RAISE EXCEPTION 'auth_login_begin: payload must be exactly {device_id, username, kind}' USING ERRCODE = '22023';
                END IF;
                IF jsonb_typeof(p -> 'device_id') IS DISTINCT FROM 'string'
                    OR p->>'device_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                    RAISE EXCEPTION 'auth_login_begin: device_id must be a well-formed uuid' USING ERRCODE = '22023';
                END IF;
                IF jsonb_typeof(p -> 'username') IS DISTINCT FROM 'string'
                    OR char_length(p->>'username') NOT BETWEEN 1 AND 64 THEN
                    RAISE EXCEPTION 'auth_login_begin: username must be text of 1 to 64 characters' USING ERRCODE = '22023';
                END IF;
                IF jsonb_typeof(p -> 'kind') IS DISTINCT FROM 'string' OR p->>'kind' NOT IN ('login', 'step_up') THEN
                    RAISE EXCEPTION 'auth_login_begin: kind must be login or step_up' USING ERRCODE = '22023';
                END IF;

                v_username := lower(p->>'username');

                SELECT id, org_id INTO v_device_id, v_org_id
                FROM device
                WHERE id = (p->>'device_id')::uuid AND revoked_at IS NULL;

                IF v_device_id IS NULL THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                -- Failed attempts only: per organization and username (existing
                -- or not), per device, per organization. An attempt is failed
                -- until auth_attempt_succeeded marks it, so a begin that never
                -- completes still spends the limit.
                IF (SELECT count(*) FROM login_attempts
                        WHERE org_id = v_org_id AND username = v_username
                          AND NOT succeeded AND at > now() - interval '15 minutes') >= 5
                    OR (SELECT count(*) FROM login_attempts
                        WHERE device_id = v_device_id
                          AND NOT succeeded AND at > now() - interval '1 hour') >= 20
                    OR (SELECT count(*) FROM login_attempts
                        WHERE org_id = v_org_id
                          AND NOT succeeded AND at > now() - interval '24 hours') >= 100 THEN
                    RAISE EXCEPTION 'auth: rate limited' USING ERRCODE = 'CL429';
                END IF;

                SELECT m.id INTO v_member_id
                FROM memberships m
                WHERE m.org_id = v_org_id AND lower(m.username) = v_username AND m.is_active;

                -- A step-up verifies only the caller's own password.
                IF p->>'kind' = 'step_up' AND v_member_id IS DISTINCT FROM current_membership() THEN
                    v_member_id := NULL;
                END IF;

                IF v_member_id IS NOT NULL THEN
                    SELECT password_hash INTO v_hash FROM member_passwords WHERE membership_id = v_member_id;
                    IF v_hash IS NULL THEN
                        v_member_id := NULL;
                    END IF;
                END IF;

                INSERT INTO login_attempts (org_id, device_id, username, membership_id, kind)
                VALUES (v_org_id, v_device_id, v_username, v_member_id, p->>'kind')
                RETURNING id INTO v_attempt;

                -- A null hash: the caller verifies its dummy hash instead, so an
                -- unknown username takes the same time and fails the same way.
                RETURN jsonb_build_object('attempt_id', v_attempt, 'membership_id', v_member_id, 'password_hash', v_hash);
            END;
            $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_login_complete(p jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
                v_key text;
                v_device_id uuid;
                v_org_id uuid;
                v_member record;
                v_must_change boolean;
            BEGIN
                IF jsonb_typeof(p) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k) IS DISTINCT FROM ARRAY[
                        'attempt_id', 'audit_id', 'credential_id', 'credential_public_key', 'device_id',
                        'device_public_key', 'membership_id', 'rehash'
                    ] THEN
                    RAISE EXCEPTION 'auth_login_complete: payload must be exactly {device_id, attempt_id, membership_id, credential_id, credential_public_key, device_public_key, rehash, audit_id}'
                        USING ERRCODE = '22023';
                END IF;
                FOREACH v_key IN ARRAY ARRAY['device_id', 'membership_id', 'credential_id', 'audit_id'] LOOP
                    IF jsonb_typeof(p -> v_key) IS DISTINCT FROM 'string' OR p->>v_key !~* v_uuid THEN
                        RAISE EXCEPTION 'auth_login_complete: % must be a well-formed uuid', v_key USING ERRCODE = '22023';
                    END IF;
                END LOOP;
                IF jsonb_typeof(p -> 'attempt_id') IS DISTINCT FROM 'number' OR p->>'attempt_id' !~ '^[1-9][0-9]{0,17}$' THEN
                    RAISE EXCEPTION 'auth_login_complete: attempt_id must be a positive integer' USING ERRCODE = '22023';
                END IF;
                IF jsonb_typeof(p -> 'credential_public_key') IS DISTINCT FROM 'object'
                    OR p #>> '{credential_public_key,kty}' IS DISTINCT FROM 'EC'
                    OR p #>> '{credential_public_key,crv}' IS DISTINCT FROM 'P-256'
                    OR p #>> '{credential_public_key,x}' !~ '^[A-Za-z0-9_-]{43}$'
                    OR p #>> '{credential_public_key,y}' !~ '^[A-Za-z0-9_-]{43}$' THEN
                    RAISE EXCEPTION 'auth_login_complete: credential_public_key must be a P-256 JWK' USING ERRCODE = '22023';
                END IF;
                IF jsonb_typeof(p -> 'device_public_key') <> 'null' AND (
                    jsonb_typeof(p -> 'device_public_key') <> 'object'
                    OR p #>> '{device_public_key,kty}' IS DISTINCT FROM 'EC'
                    OR p #>> '{device_public_key,crv}' IS DISTINCT FROM 'P-256'
                    OR p #>> '{device_public_key,x}' !~ '^[A-Za-z0-9_-]{43}$'
                    OR p #>> '{device_public_key,y}' !~ '^[A-Za-z0-9_-]{43}$') THEN
                    RAISE EXCEPTION 'auth_login_complete: device_public_key must be null or a P-256 JWK' USING ERRCODE = '22023';
                END IF;
                IF jsonb_typeof(p -> 'rehash') <> 'null'
                    AND (jsonb_typeof(p -> 'rehash') <> 'string' OR p->>'rehash' !~ '^\$argon2id\$') THEN
                    RAISE EXCEPTION 'auth_login_complete: rehash must be null or an Argon2id hash' USING ERRCODE = '22023';
                END IF;

                v_device_id := (p->>'device_id')::uuid;

                SELECT org_id INTO v_org_id
                FROM login_attempts
                WHERE id = (p->>'attempt_id')::bigint AND device_id = v_device_id
                  AND membership_id = (p->>'membership_id')::uuid AND kind = 'login'
                  AND NOT succeeded AND at > now() - interval '2 minutes';

                SELECT id, role, permissions, display_name, username, pin_hash, pin_salt, rev INTO v_member
                FROM memberships
                WHERE id = (p->>'membership_id')::uuid AND org_id = v_org_id AND is_active;

                IF v_org_id IS NULL OR v_member.id IS NULL
                    OR NOT EXISTS (SELECT 1 FROM device WHERE id = v_device_id AND org_id = v_org_id AND revoked_at IS NULL) THEN
                    RAISE EXCEPTION 'auth: not allowed';
                END IF;

                IF jsonb_typeof(p -> 'rehash') = 'string' THEN
                    UPDATE member_passwords SET password_hash = p->>'rehash' WHERE membership_id = v_member.id;
                END IF;

                SELECT must_change INTO v_must_change FROM member_passwords WHERE membership_id = v_member.id;

                UPDATE member_credentials SET revoked_at = now(), revoke_reason = 'replaced'
                WHERE membership_id = v_member.id AND device_id = v_device_id AND revoked_at IS NULL;

                INSERT INTO member_credentials (id, org_id, membership_id, device_id, public_key, created_at)
                VALUES ((p->>'credential_id')::uuid, v_org_id, v_member.id, v_device_id,
                        jsonb_build_object('kty', 'EC', 'crv', 'P-256',
                                           'x', p #>> '{credential_public_key,x}', 'y', p #>> '{credential_public_key,y}'),
                        now());

                IF jsonb_typeof(p -> 'device_public_key') = 'object' THEN
                    UPDATE device
                    SET public_key = jsonb_build_object('kty', 'EC', 'crv', 'P-256',
                                                        'x', p #>> '{device_public_key,x}', 'y', p #>> '{device_public_key,y}'),
                        public_key_bound_at = now()
                    WHERE id = v_device_id AND public_key IS NULL;
                END IF;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
                VALUES ((p->>'audit_id')::uuid, v_org_id, v_member.id, 'member_credentials', (p->>'credential_id')::uuid,
                        'create', NULL, jsonb_build_object('device_id', v_device_id), now());

                PERFORM auth_attempt_succeeded(jsonb_build_object('attempt_id', (p->>'attempt_id')::bigint));

                RETURN jsonb_build_object(
                    'membership_id', v_member.id, 'role', v_member.role, 'permissions', to_jsonb(v_member.permissions),
                    'display_name', v_member.display_name, 'username', v_member.username,
                    'pin_hash', v_member.pin_hash, 'pin_salt', v_member.pin_salt, 'rev', v_member.rev,
                    'must_change_password', coalesce(v_must_change, true)
                );
            END;
            $$
        SQL);

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
                SELECT id, org_id, role, username INTO v_target
                FROM memberships WHERE id = (p->>'target_membership_id')::uuid;

                -- An active owner resets anyone else of the organization; a
                -- holder of staff.manage resets anyone else but an owner.
                -- Nobody resets themselves (they change their own password).
                IF v_caller.id IS NULL OR v_target.id IS NULL OR v_target.org_id <> v_caller.org_id OR v_target.id = v_caller.id
                    OR (v_caller.role <> 'owner' AND (v_target.role = 'owner' OR NOT ('staff.manage' = ANY (v_caller.permissions))))
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
                v_target_role text;
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
                SELECT role INTO v_target_role FROM memberships WHERE id = v_cred.membership_id;

                -- An active owner revokes any credential of the organization,
                -- their own included; a holder of staff.manage revokes anyone
                -- else's but an owner's.
                IF v_caller.id IS NULL OR v_cred.id IS NULL OR v_cred.org_id <> v_caller.org_id
                    OR (v_caller.role <> 'owner' AND (
                        v_target_role = 'owner' OR v_cred.membership_id = v_caller.id
                        OR NOT ('staff.manage' = ANY (v_caller.permissions))))
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

        DB::statement(<<<'SQL'
            CREATE FUNCTION auth_recover_owner(p jsonb) RETURNS jsonb
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

        foreach (self::FUNCTIONS as $function) {
            DB::statement("REVOKE EXECUTE ON FUNCTION {$function}(jsonb) FROM PUBLIC");
            DB::statement("GRANT EXECUTE ON FUNCTION {$function}(jsonb) TO clintra_app");
        }

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        foreach (array_reverse(self::FUNCTIONS) as $function) {
            DB::statement("DROP FUNCTION IF EXISTS {$function}(jsonb)");
        }
    }
};
