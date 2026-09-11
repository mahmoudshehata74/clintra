<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's memberships table and v9 additions (pin_salt,
// is_active index). This is the table Row-Level Security keys off of: every
// request carries a membership id, and every policy in the RLS migration
// ultimately resolves org_id/location/practitioner scope from this row.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('memberships', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->enum('role', ['owner', 'practitioner', 'assistant', 'manager']);
            $table->enum('location_scope', ['all', 'listed']);
            $table->enum('practitioner_scope', ['all', 'listed', 'self']);
            // Required only when practitioner_scope is "self".
            $table->foreignUuid('practitioner_id')->nullable()->constrained('practitioners')->restrictOnDelete();
            $table->string('pin_hash');
            // Nullable: rows written before v9, or any membership whose PIN
            // has not been set yet.
            $table->string('pin_salt')->nullable();
            $table->boolean('is_active');

            $table->index('org_id');
            $table->index('is_active');
        });

        $this->enableRowLevelSecurity('memberships');
    }

    public function down(): void
    {
        Schema::dropIfExists('memberships');
    }
};
