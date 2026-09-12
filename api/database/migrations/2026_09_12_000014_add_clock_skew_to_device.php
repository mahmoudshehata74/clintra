<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Storage only — no enforcement. docs/sync-plan.md's Q5 decided that slot
 * conflicts (visits' unique slot keys, day_state) are resolved by
 * "earliest created_at wins," and that resolving it safely requires the
 * server to reject future-dated ops, reject ops outside the 60-day
 * window, and record per-device clock skew so a badly-set device is
 * visible rather than silently winning or losing every race it's in. The
 * rejection rules belong with the push endpoint (a later step, per this
 * migration's own task scope); this migration adds only the place to
 * record the observation.
 *
 * Added to `device` rather than a new table: `device` is already the
 * per-device row this measurement is inherently about (docs/schema.md's
 * v8/v10 additions), and skew is a property of a device, not a standalone
 * entity with its own lifecycle. Nullable throughout — no device has ever
 * had its skew measured yet, since nothing computes it until a push
 * endpoint exists to compare a device's claimed `created_at` against the
 * server's own clock.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE device ADD COLUMN clock_skew_ms integer NULL');
        DB::statement('ALTER TABLE device ADD COLUMN clock_skew_observed_at timestamptz NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE device DROP COLUMN IF EXISTS clock_skew_ms');
        DB::statement('ALTER TABLE device DROP COLUMN IF EXISTS clock_skew_observed_at');
    }
};
