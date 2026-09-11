<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's v2 additions. op_id is its own primary key, distinct
// from entity_id — the server ignores any duplicate op_id, which is what
// prevents duplication on retry. No org_id: scope is inherited via
// device_id -> device.org_id (see api/docs/rls.md).
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('sync_ops', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('op_id')->primary();
            $table->string('entity');
            $table->uuid('entity_id');
            $table->enum('action', ['create', 'update', 'delete']);
            $table->jsonb('payload');
            $table->foreignUuid('device_id')->constrained('device')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->timestampTz('synced_at')->nullable();

            $table->index('synced_at');
        });

        $this->enableRowLevelSecurity('sync_ops');
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_ops');
    }
};
