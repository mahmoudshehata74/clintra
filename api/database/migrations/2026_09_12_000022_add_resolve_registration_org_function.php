<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A third layer on top of registration's existing IP-keyed and
 * code-keyed rate limits (App\Http\Controllers\DeviceRegistrationController) —
 * one that doesn't depend on the caller's claimed identity at all.
 * docs/deployment.md's "HTTPS and reverse proxies" names exactly why the
 * other two aren't enough on their own: the code-keyed half only ever
 * limits repeats against one code (a real attacker trying many different
 * codes never repeats one), which leaves the IP-keyed half doing the
 * real work — and that's exactly what a forged X-Forwarded-For defeats
 * if this app is ever directly reachable.
 *
 * `resolve_registration_org(jsonb)` answers one question, read-only:
 * given a phone and a code hash, which org (if any) do they point at?
 * Needs no new role or grant — `clintra_register` already holds `SELECT`
 * on exactly the two tables this reads (`activation_codes`, and
 * `memberships`/`users` for the phone path), the same footprint
 * `register_device` itself already has (api/docs/rls.md's "One role per
 * provisioning function"). Owned by `clintra_register`, `EXECUTE`
 * granted to `clintra_app` — the same shape as `register_device` itself,
 * since this exists purely to support that same live, unauthenticated
 * endpoint.
 *
 * Code takes priority over phone when both would resolve: a code names
 * exactly one org unambiguously, while a phone can belong to a user
 * holding memberships in several (docs/schema.md — "a user can hold
 * memberships in several orgs"), so preferring code avoids picking
 * arbitrarily among a phone's several orgs. Returns NULL, never an
 * error, when neither resolves — a value this function's only caller
 * (DeviceRegistrationController) treats as "no org-level limiting
 * applies to this attempt," not a failure.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('SET ROLE clintra_register');

        DB::statement('DROP FUNCTION IF EXISTS resolve_registration_org(jsonb)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION resolve_registration_org(payload jsonb) RETURNS uuid
            LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_phone text := payload->>'phone';
                v_code_hash text := payload->>'code_hash';
                v_org_id uuid;
            BEGIN
                SELECT org_id INTO v_org_id FROM activation_codes WHERE code_hash = v_code_hash;

                IF v_org_id IS NOT NULL THEN
                    RETURN v_org_id;
                END IF;

                SELECT m.org_id INTO v_org_id
                FROM memberships m
                JOIN users u ON u.id = m.user_id
                WHERE u.phone = v_phone AND m.role = 'owner' AND m.is_active = true
                LIMIT 1;

                RETURN v_org_id;
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION resolve_registration_org(jsonb) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION resolve_registration_org(jsonb) TO clintra_app');

        DB::statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('SET ROLE clintra_register');
        DB::statement('DROP FUNCTION IF EXISTS resolve_registration_org(jsonb)');
        DB::statement('RESET ROLE');
    }
};
