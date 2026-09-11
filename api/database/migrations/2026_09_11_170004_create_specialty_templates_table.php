<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's specialty_templates table. Created before
// practitioners, which references it (specialty_id) — in v1 every
// practitioner points at the single system-wide row keyed "general".
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('specialty_templates', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            // Null means a system-wide template, visible to every org.
            $table->foreignUuid('org_id')->nullable()->constrained('organizations')->restrictOnDelete();
            $table->string('key');
            $table->string('name');
            $table->enum('generation', ['none', 'repeat', 'sequence', 'interval']);
            $table->integer('default_count')->nullable();
            $table->integer('gap_days')->nullable();
            $table->string('resource_type')->nullable();
            $table->enum('pricing_mode', ['per_item', 'package']);
            $table->integer('stall_days')->nullable();
            $table->string('unit_label');
            $table->string('provider_label');

            $table->index('org_id');
        });

        $this->enableRowLevelSecurity('specialty_templates');
    }

    public function down(): void
    {
        Schema::dropIfExists('specialty_templates');
    }
};
