<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's patients table. phone is deliberately NOT unique —
// families share phone numbers. Any future migration must not add a unique
// index here.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('patients', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->string('full_name');
            $table->string('phone')->nullable();
            $table->string('gender')->nullable();
            $table->integer('birth_year')->nullable();
            $table->text('note')->nullable();
            $table->timestampTz('created_at');

            $table->index('org_id');
        });

        // text_pattern_ops backs fast prefix search (LIKE 'foo%') on
        // full_name — not expressible via Laravel's schema builder.
        DB::statement('CREATE INDEX patients_org_full_name_pattern_idx ON patients (org_id, full_name text_pattern_ops)');

        $this->enableRowLevelSecurity('patients');
    }

    public function down(): void
    {
        Schema::dropIfExists('patients');
    }
};
