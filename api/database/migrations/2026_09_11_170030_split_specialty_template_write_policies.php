<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Closes a cross-tenant write hole found by the RLS isolation test suite
 * (tests/Feature/Rls). specialty_templates' and form_definitions' original
 * policies (2026_09_11_170029_enable_rls_policies.php) used the same
 * expression for USING and WITH CHECK:
 *
 *     org_id = current_org() OR org_id IS NULL
 *
 * `org_id IS NULL` doesn't depend on current_org() at all, so it isn't just
 * a read hole (any session, even with no membership declared, could SELECT
 * a system-wide template) — because the identical expression also backed
 * WITH CHECK, ANY org's membership could INSERT a new org_id-NULL row, or
 * UPDATE/DELETE an existing system-wide row, corrupting shared reference
 * data for every other org. Verified against local Postgres before writing
 * this migration: a real, active membership in org A could UPDATE the
 * shared "general" specialty_templates row's name and DELETE it outright.
 *
 * The fix splits each table's single policy into one per command:
 * - SELECT keeps "or it's system-wide" (org_id IS NULL), but only once a
 *   membership actually resolves (current_org() IS NOT NULL) — the
 *   no-membership read hole closes because an unset/invalid membership
 *   still yields zero rows, matching every other table's fail-safe.
 * - INSERT/UPDATE/DELETE drop the OR entirely: org_id = current_org(),
 *   full stop. A membership can only ever write its own org's rows, never
 *   a system-wide one. There is deliberately no path left for clintra_app
 *   to write an org_id-NULL row at all — seeding system-wide reference
 *   data (e.g. the "general" specialty template) needs a different,
 *   owner-run bootstrap step, not this connection. Left open on purpose;
 *   see docs/session-handoff.md.
 *
 * form_definitions has no org_id of its own — its scope has always been
 * "whatever specialty_templates row it points at is visible/writable" — so
 * its four policies below are the same split, expressed through template_id.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP POLICY IF EXISTS specialty_templates_scope ON specialty_templates');

        DB::statement(<<<'SQL'
            CREATE POLICY specialty_templates_select ON specialty_templates
            FOR SELECT USING (
                org_id = current_org()
                OR (org_id IS NULL AND current_org() IS NOT NULL)
            )
        SQL);
        DB::statement('CREATE POLICY specialty_templates_insert ON specialty_templates FOR INSERT WITH CHECK (org_id = current_org())');
        DB::statement('CREATE POLICY specialty_templates_update ON specialty_templates FOR UPDATE USING (org_id = current_org()) WITH CHECK (org_id = current_org())');
        DB::statement('CREATE POLICY specialty_templates_delete ON specialty_templates FOR DELETE USING (org_id = current_org())');

        DB::statement('DROP POLICY IF EXISTS form_definitions_scope ON form_definitions');

        DB::statement(<<<'SQL'
            CREATE POLICY form_definitions_select ON form_definitions
            FOR SELECT USING (
                template_id IN (
                    SELECT id FROM specialty_templates
                    WHERE org_id = current_org()
                       OR (org_id IS NULL AND current_org() IS NOT NULL)
                )
            )
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY form_definitions_insert ON form_definitions
            FOR INSERT WITH CHECK (
                template_id IN (SELECT id FROM specialty_templates WHERE org_id = current_org())
            )
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY form_definitions_update ON form_definitions
            FOR UPDATE
            USING (template_id IN (SELECT id FROM specialty_templates WHERE org_id = current_org()))
            WITH CHECK (template_id IN (SELECT id FROM specialty_templates WHERE org_id = current_org()))
        SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY form_definitions_delete ON form_definitions
            FOR DELETE USING (
                template_id IN (SELECT id FROM specialty_templates WHERE org_id = current_org())
            )
        SQL);
    }

    public function down(): void
    {
        DB::statement('DROP POLICY IF EXISTS specialty_templates_select ON specialty_templates');
        DB::statement('DROP POLICY IF EXISTS specialty_templates_insert ON specialty_templates');
        DB::statement('DROP POLICY IF EXISTS specialty_templates_update ON specialty_templates');
        DB::statement('DROP POLICY IF EXISTS specialty_templates_delete ON specialty_templates');
        DB::statement('CREATE POLICY specialty_templates_scope ON specialty_templates USING (org_id = current_org() OR org_id IS NULL) WITH CHECK (org_id = current_org() OR org_id IS NULL)');

        DB::statement('DROP POLICY IF EXISTS form_definitions_select ON form_definitions');
        DB::statement('DROP POLICY IF EXISTS form_definitions_insert ON form_definitions');
        DB::statement('DROP POLICY IF EXISTS form_definitions_update ON form_definitions');
        DB::statement('DROP POLICY IF EXISTS form_definitions_delete ON form_definitions');
        DB::statement('CREATE POLICY form_definitions_scope ON form_definitions USING (template_id IN (SELECT id FROM specialty_templates WHERE org_id = current_org() OR org_id IS NULL)) WITH CHECK (template_id IN (SELECT id FROM specialty_templates WHERE org_id = current_org() OR org_id IS NULL))');
    }
};
