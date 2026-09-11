<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's form_definitions table. No org_id of its own — scope
// is inherited from template_id's specialty_templates row (system-wide or
// org-owned), same as visit_form_data inherits from its visit.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('form_definitions', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('template_id')->constrained('specialty_templates')->restrictOnDelete();
            // Increments with every edit — a stored version, never
            // overwritten, so old visit_form_data rows stay readable against
            // the schema they were actually filled out with.
            $table->integer('version');
            $table->jsonb('schema');
            $table->boolean('is_current');

            $table->index('template_id');
        });

        $this->enableRowLevelSecurity('form_definitions');
    }

    public function down(): void
    {
        Schema::dropIfExists('form_definitions');
    }
};
