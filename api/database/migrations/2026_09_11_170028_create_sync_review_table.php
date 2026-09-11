<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's v6 additions. op_id is not unique here — the same op
// could in principle be reviewed more than once, each as its own row. No
// org_id: scope is inherited via op_id -> sync_ops.device_id -> device.org_id.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('sync_review', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('op_id')->constrained('sync_ops', 'op_id')->restrictOnDelete();
            $table->string('entity');
            $table->uuid('entity_id');
            $table->string('reason');
            $table->jsonb('payload');
            $table->boolean('needs_review');
            $table->timestampTz('created_at');

            $table->index('op_id');
            $table->index('needs_review');
        });

        $this->enableRowLevelSecurity('sync_review');
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_review');
    }
};
