<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * device.clock_skew_ms was added as a plain `integer` (max ~2.1 billion),
 * which comfortably covers a skew of minutes or hours but overflows for
 * exactly the case this column exists to catch: a device far enough
 * outside the brief's 60-day window to be rejected outright. 60 days in
 * milliseconds is ~5.18 billion, already past int32's range before the
 * skew itself is even unusually large. Widened to `bigint` (max ~9.2
 * quintillion), which comfortably covers any skew this endpoint could
 * ever observe.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE device ALTER COLUMN clock_skew_ms TYPE bigint');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE device ALTER COLUMN clock_skew_ms TYPE integer');
    }
};
