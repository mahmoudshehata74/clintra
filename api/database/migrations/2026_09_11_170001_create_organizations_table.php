<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's organizations table.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('organizations', function (Blueprint $table) {
            // uuid v4, generated on the client (app.client_generated_ids) —
            // never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->string('name');
            $table->enum('plan_tier', ['small', 'medium', 'large']);
            $table->timestampTz('created_at');
        });

        $this->enableRowLevelSecurity('organizations');
    }

    public function down(): void
    {
        Schema::dropIfExists('organizations');
    }
};
