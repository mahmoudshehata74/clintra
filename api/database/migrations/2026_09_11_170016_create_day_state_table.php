<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's day_state table and its v5 additions (natural key
// enforced). Natural key is the composite practitioner_id+location_id+date;
// `id` is added as a synthetic primary key.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('day_state', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->date('date');
            $table->integer('delay_minutes');
            $table->boolean('is_closed');
            // Derived from started_at to ended_at (median, see docs/schema.md's
            // Decisions section).
            $table->integer('avg_consult_minutes')->nullable();

            $table->unique(['practitioner_id', 'location_id', 'date']);
        });

        $this->enableRowLevelSecurity('day_state');
    }

    public function down(): void
    {
        Schema::dropIfExists('day_state');
    }
};
