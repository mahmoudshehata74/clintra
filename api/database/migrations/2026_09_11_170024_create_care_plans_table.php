<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's care_plans table — declared now, no screens or
// writers yet in v1.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('care_plans', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->foreignUuid('template_id')->constrained('specialty_templates')->restrictOnDelete();
            $table->foreignUuid('patient_id')->constrained('patients')->restrictOnDelete();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            $table->text('goal');
            $table->text('diagnosis');
            $table->integer('planned_count');
            // Piastres — integer, never a float.
            $table->bigInteger('total_price');
            $table->bigInteger('paid');
            $table->string('status');
            $table->timestampTz('started_at');
            $table->timestampTz('expected_end');

            $table->index('org_id');
        });

        $this->enableRowLevelSecurity('care_plans');
    }

    public function down(): void
    {
        Schema::dropIfExists('care_plans');
    }
};
