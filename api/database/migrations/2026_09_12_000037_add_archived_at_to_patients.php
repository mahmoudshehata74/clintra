<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * patients.archived_at — when the patient was archived, null while they
 * are not (docs/schema.md's v25 additions). An archived patient is left
 * out of the booking sheet's search and, unless asked for, the patients
 * screen; their visits, invoices and audit rows stay as they are. Every
 * existing patient reads null: the column is added with no DEFAULT and
 * no UPDATE, so no row is rewritten and no rev changes.
 *
 * No RLS or grant change is needed, confirmed by reading the patients
 * policy rather than assumed: `patients_scope`
 * (2026_09_11_170029_enable_rls_policies.php) is a single row-level policy
 * for every command (`org_id = current_org()`), filtering rows, never
 * columns, so the new column is covered by it. clintra_app's grant on
 * patients is table-level (`EnablesRowLevelSecurity`), so it extends to the
 * new column with no new GRANT. Push and pull carry whole rows, so the
 * column syncs with no change to SyncOpApplier or SyncPayload (a pulled
 * timestamptz is already sent as ISO 8601 UTC); an op without it (a device
 * not yet updated) leaves it as it is.
 *
 * Idempotent under CI's double `migrate:fresh`: migrate:fresh drops the
 * patients table itself before replaying history, and this migration
 * creates no standalone object that outlives a dropped table.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE patients ADD COLUMN archived_at timestamptz NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE patients DROP COLUMN IF EXISTS archived_at');
    }
};
