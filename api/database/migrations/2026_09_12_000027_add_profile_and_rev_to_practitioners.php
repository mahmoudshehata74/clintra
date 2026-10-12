<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Practitioners become syncable (docs/schema.md's v18 additions): the owner
 * edits each practitioner's name, title and syndicate number from settings,
 * and the printed prescription shows the syndicate number.
 *
 * - `syndicate_number varchar(50) NULL`: the practitioner's medical
 *   syndicate registration number; null means none is on record.
 * - `rev` and the `practitioners_enforce_rev` trigger, exactly as
 *   2026_09_12_000012_add_row_versioning.php gave every other syncable
 *   table: `DEFAULT 1` backfills every existing row in one metadata-only
 *   step, and the shared `enforce_row_rev()` (created there) overwrites any
 *   client-supplied value on insert and update.
 *
 * Nothing about access changes: `practitioners_scope` (`org_id =
 * current_org()`, 2026_09_11_170029_enable_rls_policies.php) and
 * clintra_app's table-level grant stay exactly as they were — a table-level
 * grant already covers a new column, and the policy filters rows, not
 * columns. Who may edit (the owner) is enforced on the device, as for every
 * other settings write (api/docs/rls.md's "Practitioners").
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE practitioners ADD COLUMN syndicate_number varchar(50) NULL');
        DB::statement('ALTER TABLE practitioners ADD COLUMN rev integer NOT NULL DEFAULT 1');
        DB::statement(
            'CREATE TRIGGER practitioners_enforce_rev BEFORE INSERT OR UPDATE ON practitioners '.
            'FOR EACH ROW EXECUTE FUNCTION enforce_row_rev()'
        );
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS practitioners_enforce_rev ON practitioners');
        DB::statement('ALTER TABLE practitioners DROP COLUMN IF EXISTS rev');
        DB::statement('ALTER TABLE practitioners DROP COLUMN IF EXISTS syndicate_number');
    }
};
