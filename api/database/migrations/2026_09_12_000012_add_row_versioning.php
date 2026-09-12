<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `rev` — a server-assigned, per-row revision counter — is the mechanism
 * docs/sync-plan.md's Q5 decided for "edit conflicts" (the same row edited
 * on two devices): a future push endpoint will reject any op whose
 * `base_rev` doesn't match the row's current `rev`. For that rejection to
 * mean anything, `rev` must be genuinely un-forgeable by the client — a
 * device that could set its own `rev` could simply always "win."
 *
 * Enforced with a single shared trigger function, not column-level grants.
 * A column-level GRANT INSERT/UPDATE (col, col, ...) excluding `rev` would
 * only stop a client from *naming* `rev` in its own column list — it does
 * nothing to actually compute the increment on every accepted update, so a
 * trigger is needed regardless. And a BEFORE INSERT OR UPDATE trigger
 * unconditionally overwrites NEW.rev before the row is ever written,
 * regardless of what the client's statement contained (including an
 * explicit attempt to set it) — column-level privileges would add nothing
 * a trigger doesn't already guarantee. Chosen because it requires **no
 * grant changes at all**: every one of these tables already has its
 * standing `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO clintra_app`
 * from `EnablesRowLevelSecurity` (unchanged here), and the trigger fires
 * for every role — including clintra_fixtures and the BYPASSRLS
 * provisioning roles — since triggers are a separate mechanism from RLS
 * policies and BYPASSRLS/FORCE only ever affect the latter.
 *
 * Syncable tables (see docs/sync-plan.md's checklist and this migration's
 * own PR description for how the list was derived — every entity string
 * `web/src/db/mutate.ts` callers actually pass to `mutate()`/`applyEntityWrite()`
 * today, cross-checked against docs/schema.md and the CLI brief's section 9
 * rule 10): cash_close, day_state, invoice_items, invoices,
 * membership_locations, membership_practitioners, memberships, patients,
 * payments, schedules, service_price_overrides, services, visit_form_data,
 * visits. `users` is deliberately excluded — see this migration's own
 * report for why it's ambiguous, not omitted by oversight.
 */
return new class extends Migration
{
    private const SYNCABLE_TABLES = [
        'cash_close', 'day_state', 'invoice_items', 'invoices',
        'membership_locations', 'membership_practitioners', 'memberships',
        'patients', 'payments', 'schedules', 'service_price_overrides',
        'services', 'visit_form_data', 'visits',
    ];

    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE FUNCTION enforce_row_rev() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    NEW.rev := 1;
                ELSIF TG_OP = 'UPDATE' THEN
                    NEW.rev := OLD.rev + 1;
                END IF;
                RETURN NEW;
            END;
            $$
        SQL);

        foreach (self::SYNCABLE_TABLES as $table) {
            // DEFAULT 1 is a redundant safety net, not the enforcement
            // mechanism — the trigger below always overwrites it on
            // INSERT regardless. Kept anyway so an ALTER TABLE ADD COLUMN
            // backfills every existing row to 1 in one metadata-only
            // operation (Postgres 11+), satisfying "existing rows get 1"
            // without a separate UPDATE statement.
            DB::statement("ALTER TABLE {$table} ADD COLUMN rev integer NOT NULL DEFAULT 1");
            DB::statement(
                "CREATE TRIGGER {$table}_enforce_rev BEFORE INSERT OR UPDATE ON {$table} ".
                'FOR EACH ROW EXECUTE FUNCTION enforce_row_rev()'
            );
        }
    }

    public function down(): void
    {
        foreach (self::SYNCABLE_TABLES as $table) {
            DB::statement("DROP TRIGGER IF EXISTS {$table}_enforce_rev ON {$table}");
            DB::statement("ALTER TABLE {$table} DROP COLUMN IF EXISTS rev");
        }

        DB::statement('DROP FUNCTION IF EXISTS enforce_row_rev()');
    }
};
