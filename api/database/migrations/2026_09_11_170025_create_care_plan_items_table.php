<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's care_plan_items table — declared now, no screens or
// writers yet in v1.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('care_plan_items', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('care_plan_id')->constrained('care_plans')->restrictOnDelete();
            $table->foreignUuid('service_id')->constrained('services')->restrictOnDelete();
            $table->integer('sequence');
            $table->foreignUuid('visit_id')->constrained('visits')->restrictOnDelete();
            $table->integer('min_gap_days');
            // Self-referencing FK added below, after the table (and its
            // primary key) fully exists — see the same pattern in the
            // visits migration for why.
            $table->uuid('depends_on_item_id')->nullable();
            // Piastres — integer, never a float.
            $table->bigInteger('price');
            $table->string('status');

            $table->index('care_plan_id');
        });

        Schema::table('care_plan_items', function (Blueprint $table) {
            $table->foreign('depends_on_item_id')->references('id')->on('care_plan_items')->restrictOnDelete();
        });

        $this->enableRowLevelSecurity('care_plan_items');
    }

    public function down(): void
    {
        Schema::dropIfExists('care_plan_items');
    }
};
