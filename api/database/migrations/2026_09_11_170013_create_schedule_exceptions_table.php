<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's schedule_exceptions table.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('schedule_exceptions', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            $table->date('date');
            $table->enum('type', ['closed', 'extra', 'shifted']);
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();
            $table->integer('shift_minutes')->nullable();

            $table->index('practitioner_id');
        });

        $this->enableRowLevelSecurity('schedule_exceptions');
    }

    public function down(): void
    {
        Schema::dropIfExists('schedule_exceptions');
    }
};
