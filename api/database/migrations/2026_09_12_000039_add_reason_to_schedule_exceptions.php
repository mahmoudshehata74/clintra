<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * schedule_exceptions.reason — a closure's optional reason ("سبب الإجازة"),
 * null when none was given (docs/schema.md's v27 additions). The settings
 * form stores it on a closed date only; the exceptions list, tomorrow's
 * sheet and the day screen show it there. Every existing exception reads
 * null: the column is added with no DEFAULT and no UPDATE, so no row is
 * rewritten and no rev changes.
 *
 * No RLS or grant change is needed, confirmed by reading the policy rather
 * than assumed: `schedule_exceptions_scope`
 * (2026_09_11_170029_enable_rls_policies.php) is one row-level policy for
 * every command, filtering rows, never columns, so the new column is
 * covered by it. clintra_app's grant on schedule_exceptions is table-level
 * (`EnablesRowLevelSecurity`), so it extends to the new column with no new
 * GRANT. Push, pull and bootstrap carry whole rows, so the column syncs
 * with no change to SyncOpApplier, SyncPuller, SyncBootstrapPuller or
 * SyncPayload (a pushed "" arrives as null through Laravel's
 * ConvertEmptyStringsToNull); an op without it (a device not yet updated)
 * leaves it as it is. A value over 200 characters is refused by Postgres;
 * the device never sends one (its writer refuses it first).
 *
 * Idempotent under CI's double `migrate:fresh`: migrate:fresh drops the
 * table itself before replaying history, and this migration creates no
 * standalone object that outlives a dropped table.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE schedule_exceptions ADD COLUMN reason varchar(200) NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE schedule_exceptions DROP COLUMN IF EXISTS reason');
    }
};
