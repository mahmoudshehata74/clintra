<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * care_plans and care_plan_items become syncable (docs/schema.md's v20
 * additions). Both tables were declared in v1 with no writers
 * (2026_09_11_170024/170025), so this migration only changes what they
 * already have; each change mirrors what the prescriptions migration
 * (2026_09_12_000026_create_prescriptions_tables.php) gave its tables:
 *
 * - Policies. care_plans_scope was org only (`org_id = current_org()`) and
 *   care_plan_items_scope the same through its parent
 *   (2026_09_11_170029_enable_rls_policies.php). A care plan carries a
 *   practitioner_id and is clinical data about one patient's treatment, so
 *   it now uses the visits expression verbatim — org + allowed locations +
 *   allowed practitioners — exactly as prescriptions does, and
 *   care_plan_items embeds the same expression through care_plans. Both
 *   have USING and WITH CHECK (api/docs/rls.md's "How to add a new table").
 *   A membership that cannot see a practitioner's visits cannot see that
 *   practitioner's care plans either.
 * - care_plan_items.visit_id becomes NULLABLE: an item is a session that may
 *   not be booked yet (null) or is linked to the visit that books it. The
 *   foreign key to visits (RESTRICT) is kept. A plain index on it finds the
 *   item a visit is linked to.
 * - `rev` and the `{table}_enforce_rev` trigger on both, as every other
 *   syncable table (2026_09_12_000012_add_row_versioning.php). ENABLE +
 *   FORCE RLS and clintra_app's grant are already in place from the create
 *   migrations and do not change.
 *
 * The empty-table guard. Tightening a policy on a table that already holds
 * rows could hide rows from memberships that wrote them, so this migration
 * refuses to run unless both tables are empty — which they are everywhere
 * v1 runs, since nothing has ever written them. A plain SELECT cannot check
 * that: this migration runs as clintra_owner, which FORCE RLS binds and
 * which never has a membership, so it sees zero rows of any non-empty
 * table. Validating a CHECK constraint does not go through RLS — Postgres
 * scans the table itself — so the guard adds `CHECK (false)` to each table
 * and drops it again straight away: on an empty table that succeeds and
 * leaves nothing behind; on a table with any row it fails, and the
 * migration aborts before changing anything. No RLS flag, policy, role or
 * grant is touched to make the check.
 *
 * Re-runnable under migrate:fresh: both tables (and so their policies,
 * triggers and indexes) are dropped and recreated by their own migrations
 * earlier in the history, and enforce_row_rev() by its own.
 */
return new class extends Migration
{
    /** The visits policy expression (2026_09_11_170029_enable_rls_policies.php), verbatim, as prescriptions uses it. */
    private const CARE_PLANS_SCOPE = 'org_id = current_org() AND location_id IN (SELECT * FROM allowed_locations()) AND practitioner_id IN (SELECT * FROM allowed_practitioners())';

    /** The policies this migration replaces (2026_09_11_170029_enable_rls_policies.php), restored by down(). */
    private const OLD_CARE_PLANS_SCOPE = 'org_id = current_org()';

    private const OLD_CARE_PLAN_ITEMS_SCOPE = 'care_plan_id IN (SELECT id FROM care_plans WHERE org_id = current_org())';

    public function up(): void
    {
        // Items first: an item cannot exist without its plan, so a plan
        // with items reports the items.
        $this->assertEmpty('care_plan_items');
        $this->assertEmpty('care_plans');

        $this->replacePolicy('care_plans', self::CARE_PLANS_SCOPE);
        $this->replacePolicy('care_plan_items', 'care_plan_id IN (SELECT id FROM care_plans WHERE '.self::CARE_PLANS_SCOPE.')');

        DB::statement('ALTER TABLE care_plan_items ALTER COLUMN visit_id DROP NOT NULL');
        DB::statement('CREATE INDEX care_plan_items_visit_id_index ON care_plan_items (visit_id)');

        foreach (['care_plans', 'care_plan_items'] as $table) {
            // The same column and trigger every syncable table got in
            // 2026_09_12_000012_add_row_versioning.php.
            DB::statement("ALTER TABLE {$table} ADD COLUMN rev integer NOT NULL DEFAULT 1");
            DB::statement(
                "CREATE TRIGGER {$table}_enforce_rev BEFORE INSERT OR UPDATE ON {$table} ".
                'FOR EACH ROW EXECUTE FUNCTION enforce_row_rev()'
            );
        }
    }

    public function down(): void
    {
        foreach (['care_plan_items', 'care_plans'] as $table) {
            DB::statement("DROP TRIGGER IF EXISTS {$table}_enforce_rev ON {$table}");
            DB::statement("ALTER TABLE {$table} DROP COLUMN IF EXISTS rev");
        }

        DB::statement('DROP INDEX IF EXISTS care_plan_items_visit_id_index');
        DB::statement('ALTER TABLE care_plan_items ALTER COLUMN visit_id SET NOT NULL');

        $this->replacePolicy('care_plan_items', self::OLD_CARE_PLAN_ITEMS_SCOPE);
        $this->replacePolicy('care_plans', self::OLD_CARE_PLANS_SCOPE);
    }

    /**
     * Aborts unless $table holds no row at all, whoever could see it — see
     * this class's doc comment for why a CHECK constraint, not a SELECT.
     */
    private function assertEmpty(string $table): void
    {
        DB::statement(<<<SQL
            DO \$\$
            BEGIN
                ALTER TABLE {$table} ADD CONSTRAINT {$table}_empty_guard CHECK (false);
                ALTER TABLE {$table} DROP CONSTRAINT {$table}_empty_guard;
            EXCEPTION WHEN check_violation THEN
                RAISE EXCEPTION '{$table} is not empty: its policy can only be changed on an empty table';
            END
            \$\$
        SQL);
    }

    private function replacePolicy(string $table, string $expression): void
    {
        DB::statement("DROP POLICY IF EXISTS {$table}_scope ON {$table}");
        DB::statement("CREATE POLICY {$table}_scope ON {$table} USING ({$expression}) WITH CHECK ({$expression})");
    }
};
