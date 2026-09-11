<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's service_price_overrides table. No separate service
// per practitioner — the price is overridden here instead (see the CLI
// brief's warning against creating one service per practitioner).
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('service_price_overrides', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('service_id')->constrained('services')->restrictOnDelete();
            $table->foreignUuid('practitioner_id')->nullable()->constrained('practitioners')->restrictOnDelete();
            $table->foreignUuid('location_id')->nullable()->constrained('locations')->restrictOnDelete();
            // Piastres — integer, never a float.
            $table->bigInteger('price');

            $table->index('service_id');
        });

        $this->enableRowLevelSecurity('service_price_overrides');
    }

    public function down(): void
    {
        Schema::dropIfExists('service_price_overrides');
    }
};
