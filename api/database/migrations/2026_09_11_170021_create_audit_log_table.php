<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's audit_log table and its v11 additions (seq). entity
// is a table name and entity_id a row in it — polymorphic across every
// audited table, so entity_id carries no foreign key. seq is assigned by
// application code inside the same transaction as the row itself (the same
// pattern invoices.number and payments.receipt_number use), not a native
// Postgres sequence.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('audit_log', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->foreignUuid('actor_membership_id')->constrained('memberships')->restrictOnDelete();
            $table->string('entity');
            $table->uuid('entity_id');
            $table->enum('action', ['create', 'update', 'delete']);
            $table->jsonb('before')->nullable();
            $table->jsonb('after')->nullable();
            $table->timestampTz('at');
            // Strictly monotonic, globally-unique write counter — what
            // "most recent mutation" is decided by, never `at` (millisecond
            // resolution, can tie).
            $table->bigInteger('seq');

            $table->index('org_id');
            $table->index(['entity', 'entity_id']);
            $table->unique('seq');
        });

        $this->enableRowLevelSecurity('audit_log');
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_log');
    }
};
