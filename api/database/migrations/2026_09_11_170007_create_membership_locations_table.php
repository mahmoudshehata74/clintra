<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's membership_locations table. Natural key is the
// composite membership_id+location_id; `id` is added as a synthetic primary
// key. Used only when a membership's location_scope is "listed" — an empty
// table never means "all" (see api/docs/rls.md).
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('membership_locations', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('membership_id')->constrained('memberships')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();

            $table->unique(['membership_id', 'location_id']);
        });

        $this->enableRowLevelSecurity('membership_locations');
    }

    public function down(): void
    {
        Schema::dropIfExists('membership_locations');
    }
};
