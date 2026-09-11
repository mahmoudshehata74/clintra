<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Mints a fresh activation code for an EXISTING org — devices get
 * replaced, so provisioning-time's one code (provision_organization)
 * can't be the only way to get one. Owned by clintra_provision, EXECUTE
 * granted only to clintra_owner: minting a registration credential goes
 * through the same CLI-only, provisioning-function path as everything
 * else that can create org-scoped secrets, never through clintra_app
 * (see api/docs/rls.md).
 *
 * The plaintext code is generated in PHP
 * (App\Console\Commands\MintActivationCode) and never reaches this
 * function — only its SHA-256 hash does, same as provisioning's.
 */
return new class extends Migration
{
    public function up(): void
    {
        // locations: verify the given location actually belongs to the
        // given org. memberships: find the org's active owner, to
        // attribute the audit_log row to — this command has no acting
        // membership of its own (it's a bare CLI invocation against an
        // already-existing org), so the org's own owner is the only
        // sensible actor.
        DB::statement('GRANT SELECT ON locations, memberships TO clintra_provision');

        DB::statement('SET ROLE clintra_provision');

        DB::statement('DROP FUNCTION IF EXISTS mint_activation_code(jsonb)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION mint_activation_code(payload jsonb) RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_allowed_keys text[] := ARRAY['id', 'org_id', 'location_id', 'code_hash', 'expires_at', 'audit_id'];
                v_unknown_keys text[];
                v_key text;

                v_id uuid;
                v_org_id uuid;
                v_location_id uuid;
                v_code_hash text;
                v_expires_at timestamptz;
                v_owner_membership_id uuid;
                v_seq bigint;
                v_now timestamptz := now();
            BEGIN
                SELECT array_agg(k) INTO v_unknown_keys
                FROM jsonb_object_keys(payload) AS k
                WHERE k <> ALL (v_allowed_keys);

                IF v_unknown_keys IS NOT NULL THEN
                    RAISE EXCEPTION 'mint_activation_code: unknown payload key(s): %', array_to_string(v_unknown_keys, ', ')
                        USING ERRCODE = '22023';
                END IF;

                FOREACH v_key IN ARRAY v_allowed_keys LOOP
                    IF NOT jsonb_exists(payload, v_key) OR jsonb_typeof(payload -> v_key) = 'null' THEN
                        RAISE EXCEPTION 'mint_activation_code: missing or null required key "%"', v_key
                            USING ERRCODE = '22023';
                    END IF;
                END LOOP;

                v_org_id := (payload->>'org_id')::uuid;
                v_location_id := (payload->>'location_id')::uuid;
                v_code_hash := payload->>'code_hash';
                v_expires_at := (payload->>'expires_at')::timestamptz;

                IF v_code_hash !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'mint_activation_code: code_hash must be 64 lowercase hex characters' USING ERRCODE = '22023';
                END IF;

                IF v_expires_at <= v_now THEN
                    RAISE EXCEPTION 'mint_activation_code: expires_at must be in the future' USING ERRCODE = '22023';
                END IF;

                IF NOT EXISTS (SELECT 1 FROM locations WHERE id = v_location_id AND org_id = v_org_id) THEN
                    RAISE EXCEPTION 'mint_activation_code: location_id must belong to org_id' USING ERRCODE = '22023';
                END IF;

                SELECT id INTO v_owner_membership_id
                FROM memberships
                WHERE org_id = v_org_id AND role = 'owner' AND is_active = true
                ORDER BY id
                LIMIT 1;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'mint_activation_code: org_id has no active owner membership' USING ERRCODE = '22023';
                END IF;

                v_id := (payload->>'id')::uuid;

                INSERT INTO activation_codes (id, org_id, location_id, code_hash, expires_at, used_at, used_by_device_id, created_at)
                VALUES (v_id, v_org_id, v_location_id, v_code_hash, v_expires_at, NULL, NULL, v_now);

                SELECT COALESCE(MAX(seq), 0) INTO v_seq FROM audit_log;
                v_seq := v_seq + 1;

                INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at, seq)
                VALUES (
                    (payload->>'audit_id')::uuid, v_org_id, v_owner_membership_id, 'activation_codes', v_id, 'create', NULL,
                    jsonb_build_object(
                        'id', v_id, 'org_id', v_org_id, 'location_id', v_location_id,
                        'expires_at', v_expires_at, 'used_at', NULL, 'used_by_device_id', NULL
                    ),
                    v_now, v_seq
                );

                RETURN jsonb_build_object('id', v_id, 'org_id', v_org_id, 'location_id', v_location_id, 'expires_at', v_expires_at);
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION mint_activation_code(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION mint_activation_code(jsonb) TO clintra_owner');

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('SET ROLE clintra_provision');
        DB::statement('DROP FUNCTION IF EXISTS mint_activation_code(jsonb)');
        DB::statement('RESET ROLE');

        DB::statement('REVOKE SELECT ON locations, memberships FROM clintra_provision');
    }
};
