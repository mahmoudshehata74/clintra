<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's v8 additions: one row per browser, keyed by the
// device_id itself.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('device', function (Blueprint $table) {
            // The device_id itself — uuid v4, generated on the client, never
            // by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->timestampTz('registered_at');

            $table->index('org_id');
        });

        $this->enableRowLevelSecurity('device');
    }

    public function down(): void
    {
        Schema::dropIfExists('device');
    }
};
