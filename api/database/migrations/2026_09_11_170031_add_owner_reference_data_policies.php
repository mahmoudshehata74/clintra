<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Opens a narrow, owner-only path to write system-wide reference rows
 * (org_id IS NULL) on specialty_templates and form_definitions — needed so
 * the next migration (2026_09_11_170032_seed_reference_data.php) can seed
 * contract/reference-data.json's rows as clintra_owner, without granting
 * BYPASSRLS or any new privilege to clintra_app. clintra_app's own policies
 * (2026_09_11_170029/170030) are unchanged: it still has no path at all to
 * write a system-wide row, only to read one once a membership resolves.
 *
 * INSERT and UPDATE both restrict WITH CHECK to org_id IS NULL (or, for
 * form_definitions, a template whose org_id IS NULL) — clintra_owner can
 * still never write an org-scoped row through these. There is deliberately
 * no DELETE policy: system-wide reference rows are never removed by a
 * migration, only upserted.
 *
 * A SELECT policy is included too, though the task that produced this
 * migration only asked for INSERT/UPDATE: Postgres requires the target row
 * to be visible under a SELECT policy for INSERT ... ON CONFLICT DO UPDATE
 * to work at all — confirmed empirically (a plain INSERT succeeded without
 * it; the same statement with ON CONFLICT DO UPDATE failed with "new row
 * violates row-level security policy" until this SELECT policy existed) —
 * and the seed migration needs that upsert shape to stay idempotent across
 * repeated runs and migrate:fresh. Scoped identically to org_id IS NULL, so
 * it grants no broader read access than the write policies below do.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE POLICY specialty_templates_owner_select ON specialty_templates FOR SELECT TO clintra_owner USING (org_id IS NULL)');
        DB::statement('CREATE POLICY specialty_templates_owner_insert ON specialty_templates FOR INSERT TO clintra_owner WITH CHECK (org_id IS NULL)');
        DB::statement('CREATE POLICY specialty_templates_owner_update ON specialty_templates FOR UPDATE TO clintra_owner USING (org_id IS NULL) WITH CHECK (org_id IS NULL)');

        DB::statement(<<<'SQL'
            CREATE POLICY form_definitions_owner_select ON form_definitions
            FOR SELECT TO clintra_owner
            USING (template_id IN (SELECT id FROM specialty_templates WHERE org_id IS NULL))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY form_definitions_owner_insert ON form_definitions
            FOR INSERT TO clintra_owner
            WITH CHECK (template_id IN (SELECT id FROM specialty_templates WHERE org_id IS NULL))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY form_definitions_owner_update ON form_definitions
            FOR UPDATE TO clintra_owner
            USING (template_id IN (SELECT id FROM specialty_templates WHERE org_id IS NULL))
            WITH CHECK (template_id IN (SELECT id FROM specialty_templates WHERE org_id IS NULL))
        SQL);
    }

    public function down(): void
    {
        DB::statement('DROP POLICY IF EXISTS specialty_templates_owner_select ON specialty_templates');
        DB::statement('DROP POLICY IF EXISTS specialty_templates_owner_insert ON specialty_templates');
        DB::statement('DROP POLICY IF EXISTS specialty_templates_owner_update ON specialty_templates');

        DB::statement('DROP POLICY IF EXISTS form_definitions_owner_select ON form_definitions');
        DB::statement('DROP POLICY IF EXISTS form_definitions_owner_insert ON form_definitions');
        DB::statement('DROP POLICY IF EXISTS form_definitions_owner_update ON form_definitions');
    }
};
