<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's services table.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('services', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->string('name');
            $table->integer('duration_minutes');
            // Piastres — integer, never a float.
            $table->bigInteger('default_price');
            $table->boolean('is_active');

            $table->index('org_id');
        });

        $this->enableRowLevelSecurity('services');
    }

    public function down(): void
    {
        Schema::dropIfExists('services');
    }
};
