<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's schedules table.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('schedules', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->smallInteger('weekday');
            $table->time('start_time');
            $table->time('end_time');
            $table->enum('mode', ['slots', 'queue']);
            // Slots mode only.
            $table->integer('slot_minutes')->nullable();
            // Queue mode only.
            $table->integer('max_capacity')->nullable();
            // Beds/chairs/etc. Defaults to 1.
            $table->integer('resource_count')->default(1);

            $table->index('practitioner_id');
            $table->index('location_id');
        });

        DB::statement('ALTER TABLE schedules ADD CONSTRAINT schedules_weekday_range CHECK (weekday BETWEEN 0 AND 6)');

        $this->enableRowLevelSecurity('schedules');
    }

    public function down(): void
    {
        Schema::dropIfExists('schedules');
    }
};
