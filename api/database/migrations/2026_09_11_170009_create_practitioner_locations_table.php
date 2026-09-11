<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's practitioner_locations table. Natural key is the
// composite practitioner_id+location_id; `id` is added as a synthetic
// primary key.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('practitioner_locations', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->boolean('is_active');

            $table->unique(['practitioner_id', 'location_id']);
        });

        $this->enableRowLevelSecurity('practitioner_locations');
    }

    public function down(): void
    {
        Schema::dropIfExists('practitioner_locations');
    }
};
