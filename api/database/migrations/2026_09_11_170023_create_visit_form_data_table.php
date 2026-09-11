<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's visit_form_data table and its v10 additions (the two
// indexes). Natural key is the composite visit_id+form_definition_id; `id`
// is added as a synthetic primary key.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('visit_form_data', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('visit_id')->constrained('visits')->restrictOnDelete();
            $table->foreignUuid('form_definition_id')->constrained('form_definitions')->restrictOnDelete();
            $table->jsonb('data');

            $table->index('visit_id');
            $table->unique(['visit_id', 'form_definition_id']);
        });

        $this->enableRowLevelSecurity('visit_form_data');
    }

    public function down(): void
    {
        Schema::dropIfExists('visit_form_data');
    }
};
