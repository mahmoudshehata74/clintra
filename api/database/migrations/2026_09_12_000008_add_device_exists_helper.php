<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Closes a real gap found while hardening App\Http\Middleware\ApplyMembership:
 * it verifies a bearer token against personal_access_tokens (no RLS) and
 * never touched `device` at all, so a device row deleted after its token
 * was issued had no effect — the token kept working forever. `device`
 * carries FORCE ROW LEVEL SECURITY, so ApplyMembership can't read it
 * directly at the exact point it's still resolving which membership to
 * declare (the same bootstrapping circularity current_org() exists to
 * solve for reads that happen after a membership is already known).
 *
 * device_exists(uuid) is the same pattern as current_org() et al.:
 * SECURITY DEFINER, owned by clintra_rls (NOLOGIN, BYPASSRLS — already
 * exists, see 2026_09_11_170029_enable_rls_policies.php), granted EXECUTE
 * to clintra_app. It answers exactly one narrow question — does this
 * device id still exist at all — nothing else about the row.
 *
 * `device` has no `is_active` column (docs/schema.md's v8/v10 additions),
 * so "inactive" isn't a representable state yet; only "deleted" is
 * checked here. Adding an is_active column would be a real schema change
 * (docs/schema.md update, migration, a way to set it) — out of scope for
 * this hardening pass, which touches no schema shape, only closes a gap
 * in verification logic using tables/columns that already exist.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('GRANT SELECT ON device TO clintra_rls');

        DB::statement('SET ROLE clintra_rls');

        DB::statement('DROP FUNCTION IF EXISTS device_exists(uuid)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION device_exists(p_device_id uuid) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT EXISTS (SELECT 1 FROM device WHERE id = p_device_id)
            $$
        SQL);

        DB::statement('RESET ROLE');

        DB::statement('GRANT EXECUTE ON FUNCTION device_exists(uuid) TO clintra_app');
    }

    public function down(): void
    {
        DB::statement('SET ROLE clintra_rls');
        DB::statement('DROP FUNCTION IF EXISTS device_exists(uuid)');
        DB::statement('RESET ROLE');

        DB::statement('REVOKE SELECT ON device FROM clintra_rls');
    }
};
