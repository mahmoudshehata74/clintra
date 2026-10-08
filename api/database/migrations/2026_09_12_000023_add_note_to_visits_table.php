<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * visits.note — the doctor's quick free-text note on one visit. A nullable
 * column on visits rather than a separate table, by owner decision: it has
 * no history, no author or timestamp of its own beyond the visit row's, and
 * is edited in place like any other visit field.
 *
 * No RLS change is needed, confirmed by reading the visits policy rather
 * than assumed: `visits_scope`
 * (2026_09_11_170029_enable_rls_policies.php) is a single row-level
 * policy, `FOR ALL`, with the same expression for USING and WITH CHECK
 * (`org_id = current_org() AND location_id IN (SELECT * FROM
 * allowed_locations()) AND practitioner_id IN (SELECT * FROM
 * allowed_practitioners())`). It filters rows, never columns, so a new
 * column is covered by it automatically: a membership that cannot see a
 * visit row cannot see its note either. clintra_app's grant on visits is
 * table-level (`EnablesRowLevelSecurity`, no column-level grants on this
 * table anywhere), so it extends to the new column with no new GRANT.
 * The `visits_enforce_rev` trigger (2026_09_12_000012_add_row_versioning.php)
 * fires on every UPDATE of the row, so a note-only edit bumps rev like any
 * other field.
 *
 * Idempotent under CI's double `migrate:fresh`: migrate:fresh drops the
 * visits table itself before replaying history, and this migration creates
 * no standalone function or other object that outlives a dropped table
 * (api/docs/rls.md's "migrate:fresh is idempotent, not just re-runnable").
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE visits ADD COLUMN note text NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE visits DROP COLUMN IF EXISTS note');
    }
};
