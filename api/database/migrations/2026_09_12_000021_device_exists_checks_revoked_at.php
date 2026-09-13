<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `device_exists()` (2026_09_12_000008_add_device_exists_helper.php) only
 * ever checked "deleted," because `device` had no other state to check —
 * its own doc comment named this as the anticipated follow-up the moment
 * an `is_active`/`revoked_at` column existed. It now does
 * (2026_09_12_000020_add_revoked_at_to_device_table.php): a revoked device
 * must fail `ApplyMembership`'s check on its very next request, identically
 * to a deleted one — this is the second, independent layer that makes
 * `App\Console\Commands\RevokeDevice`'s own token deletion not the only
 * thing standing between a revoked device and the clinic's data.
 *
 * Same SET ROLE / DROP FUNCTION / CREATE FUNCTION / RESET ROLE idiom as
 * every other function-owning migration; no grant changes needed —
 * `clintra_rls` already holds SELECT on `device` in full (not per-column),
 * so reading one more column requires nothing new.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('SET ROLE clintra_rls');

        DB::statement('DROP FUNCTION IF EXISTS device_exists(uuid)');
        DB::statement(<<<'SQL'
            CREATE FUNCTION device_exists(p_device_id uuid) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT EXISTS (SELECT 1 FROM device WHERE id = p_device_id AND revoked_at IS NULL)
            $$
        SQL);

        DB::statement('RESET ROLE');

        DB::statement('GRANT EXECUTE ON FUNCTION device_exists(uuid) TO clintra_app');
    }

    public function down(): void
    {
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
};
