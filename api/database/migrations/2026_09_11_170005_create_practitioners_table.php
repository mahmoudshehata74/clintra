<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's practitioners table.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('practitioners', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            // May not have a login account.
            $table->foreignUuid('user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('full_name');
            $table->foreignUuid('specialty_id')->constrained('specialty_templates')->restrictOnDelete();
            $table->string('title');
            $table->boolean('is_active');

            $table->index('org_id');
        });

        $this->enableRowLevelSecurity('practitioners');
    }

    public function down(): void
    {
        Schema::dropIfExists('practitioners');
    }
};
