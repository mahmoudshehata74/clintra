<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * cash_close.opening_amount — the drawer's opening float, in piastres
 * (docs/schema.md's v24 additions). A close's total_expected is the opening
 * amount plus the paid sum of the day's invoices, and its difference is the
 * counted cash minus that. Every existing close reads 0: the DEFAULT fills
 * the column without an UPDATE, so no row is rewritten, no rev changes and
 * no RLS policy is involved. CHECK (opening_amount >= 0).
 *
 * No RLS or grant change is needed, confirmed by reading the cash_close
 * policy rather than assumed: `cash_close_scope`
 * (2026_09_11_170029_enable_rls_policies.php) is a single row-level policy,
 * `FOR ALL` (`location_id IN (SELECT * FROM allowed_locations())`). It
 * filters rows, never columns, so the new column is covered by it.
 * clintra_app's grant on cash_close is table-level
 * (`EnablesRowLevelSecurity`), so it extends to the new column with no new
 * GRANT. Push and pull carry whole rows, so the column syncs with no change
 * to SyncOpApplier or SyncPayload; an op without it (a device not yet
 * updated) stores 0.
 *
 * Idempotent under CI's double `migrate:fresh`: migrate:fresh drops the
 * cash_close table itself before replaying history, and this migration
 * creates no standalone object that outlives a dropped table.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE cash_close ADD COLUMN opening_amount integer NOT NULL DEFAULT 0');
        DB::statement('ALTER TABLE cash_close ADD CONSTRAINT cash_close_opening_amount_check CHECK (opening_amount >= 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE cash_close DROP CONSTRAINT IF EXISTS cash_close_opening_amount_check');
        DB::statement('ALTER TABLE cash_close DROP COLUMN IF EXISTS opening_amount');
    }
};
