<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's cash_close table and its v7 additions (the
// location_id+date unique index). No org_id column, only location_id — see
// payments' migration for why that's still fully org-isolated under RLS.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('cash_close', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->date('date');
            // Piastres — integer, never a float. difference may be negative.
            $table->bigInteger('total_expected');
            $table->bigInteger('total_collected');
            $table->bigInteger('difference');
            // Required when difference is not zero.
            $table->text('difference_note')->nullable();
            // Membership id.
            $table->foreignUuid('closed_by')->constrained('memberships')->restrictOnDelete();
            $table->timestampTz('closed_at');

            $table->unique(['location_id', 'date']);
        });

        $this->enableRowLevelSecurity('cash_close');
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_close');
    }
};
