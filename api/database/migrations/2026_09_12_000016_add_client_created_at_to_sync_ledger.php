<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The push endpoint's slot-conflict rule (docs/sync-plan.md's Q5:
 * "the chronologically older wins") needs to compare the client-claimed
 * `created_at` of the op that's currently occupying a slot against the
 * incoming op's own `created_at` — but not every syncable table carries
 * its own `created_at` column (`day_state` doesn't; `visits` does, but
 * relying on a per-table column would mean the comparison mechanism
 * differs table to table for no real reason). `sync_ledger` already
 * records one row per accepted op; adding the op's own `created_at` here
 * makes it the single, uniform place to look up "when did the device that
 * currently holds this row say it made this change," for any table,
 * without needing one.
 *
 * No rows exist yet in any environment (nothing writes to sync_ledger
 * until this endpoint), so this lands as NOT NULL directly — no backfill,
 * no default.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE sync_ledger ADD COLUMN client_created_at timestamptz NOT NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE sync_ledger DROP COLUMN IF EXISTS client_created_at');
    }
};
