<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * schedule_exceptions becomes syncable (docs/schema.md's v26 additions): the
 * owner adds a doctor's closed dates and one-day hours from settings, and
 * every device's booking honours them.
 *
 * - `rev` and the `schedule_exceptions_enforce_rev` trigger, exactly as
 *   2026_09_12_000012_add_row_versioning.php gave every other syncable
 *   table: `DEFAULT 1` backfills any existing row in one metadata-only step,
 *   and the shared `enforce_row_rev()` (created there) overwrites any
 *   client-supplied value on insert and update.
 *
 * Nothing about access changes: `schedule_exceptions_scope` (`practitioner_id
 * IN (SELECT id FROM practitioners WHERE org_id = current_org())`, USING and
 * WITH CHECK, 2026_09_11_170029_enable_rls_policies.php) — the same
 * expression `schedules` uses — and clintra_app's table-level grant stay
 * exactly as they were. Who may edit (the owner) is enforced on the device,
 * as for every other settings write.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE schedule_exceptions ADD COLUMN rev integer NOT NULL DEFAULT 1');
        DB::statement(
            'CREATE TRIGGER schedule_exceptions_enforce_rev BEFORE INSERT OR UPDATE ON schedule_exceptions '.
            'FOR EACH ROW EXECUTE FUNCTION enforce_row_rev()'
        );
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS schedule_exceptions_enforce_rev ON schedule_exceptions');
        DB::statement('ALTER TABLE schedule_exceptions DROP COLUMN IF EXISTS rev');
    }
};
