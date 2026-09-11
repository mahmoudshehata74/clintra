<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's locations table.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('locations', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->string('name');
            $table->string('address');
            $table->string('phone');
            $table->boolean('is_active');

            $table->index('org_id');
        });

        $this->enableRowLevelSecurity('locations');
    }

    public function down(): void
    {
        Schema::dropIfExists('locations');
    }
};
