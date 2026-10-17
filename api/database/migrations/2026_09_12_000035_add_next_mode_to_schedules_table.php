<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * schedules.next_mode and schedules.next_mode_from — a doctor's slots/queue
 * switch, dated (docs/bug-hunt.md's A-03, docs/schema.md's v23 additions).
 * A date's effective mode is next_mode when next_mode_from is set and the
 * date is on or after it, else mode; the working-hours editor writes
 * next_mode_from as tomorrow, so today and its visits keep today's mode.
 * Both are null on every row with no switch pending.
 *
 * next_mode has mode's own type (the varchar Laravel's enum() gives
 * Postgres) and the same two values, held by its own CHECK. The device
 * writes and clears the two together (web/src/db/scheduleModeSwitch.ts).
 *
 * No RLS change is needed, confirmed by reading the schedules policy
 * rather than assumed: `schedules_scope`
 * (2026_09_11_170029_enable_rls_policies.php) is a single row-level policy,
 * `FOR ALL`, with the same expression for USING and WITH CHECK
 * (`practitioner_id IN (SELECT id FROM practitioners WHERE org_id =
 * current_org())`). It filters rows, never columns, so both new columns
 * are covered by it: a membership that cannot see a schedule row cannot
 * see or set its next mode either. clintra_app's grant on schedules is
 * table-level (`EnablesRowLevelSecurity`), so it extends to the new
 * columns with no new GRANT, and the same roles that edit mode edit them.
 * The `schedules_enforce_rev` trigger
 * (2026_09_12_000012_add_row_versioning.php) fires on every UPDATE of the
 * row, so a switch bumps rev like any other schedule edit.
 *
 * Idempotent under CI's double `migrate:fresh`: migrate:fresh drops the
 * schedules table itself before replaying history, and this migration
 * creates no standalone object that outlives a dropped table.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE schedules ADD COLUMN next_mode varchar(255) NULL');
        DB::statement('ALTER TABLE schedules ADD COLUMN next_mode_from date NULL');
        DB::statement("ALTER TABLE schedules ADD CONSTRAINT schedules_next_mode_check CHECK (next_mode IN ('slots', 'queue'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_next_mode_check');
        DB::statement('ALTER TABLE schedules DROP COLUMN IF EXISTS next_mode_from');
        DB::statement('ALTER TABLE schedules DROP COLUMN IF EXISTS next_mode');
    }
};
