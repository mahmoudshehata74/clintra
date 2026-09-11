<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's membership_practitioners table. Natural key is the
// composite membership_id+practitioner_id; `id` is added as a synthetic
// primary key. Used only when a membership's practitioner_scope is "listed".
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('membership_practitioners', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('membership_id')->constrained('memberships')->restrictOnDelete();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();

            $table->unique(['membership_id', 'practitioner_id']);
        });

        $this->enableRowLevelSecurity('membership_practitioners');
    }

    public function down(): void
    {
        Schema::dropIfExists('membership_practitioners');
    }
};
