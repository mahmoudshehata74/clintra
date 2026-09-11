<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's payments table and its v7 additions (location_id,
// after_close, the receipt_number unique index). No org_id column — payments
// was never given one in docs/schema.md, only location_id (denormalised
// from the invoice at write time). Its RLS policy scopes on location_id
// alone; allowed_locations() is itself already scoped to the caller's org,
// so this is not a weaker guarantee — see api/docs/rls.md.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('invoice_id')->constrained('invoices')->restrictOnDelete();
            // Denormalised from the invoice at write time so receipt_number's
            // per-location sequence can be indexed and enforced directly here.
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            // Piastres — integer, never a float.
            $table->bigInteger('amount');
            $table->enum('method', ['cash', 'card', 'wallet', 'transfer']);
            // Sequential per location, across all time — never reused.
            $table->string('receipt_number');
            $table->text('note')->nullable();
            // True when a cash_close already existed for this payment's
            // location and day at the moment it was recorded.
            $table->boolean('after_close');
            // Membership id.
            $table->foreignUuid('created_by')->constrained('memberships')->restrictOnDelete();
            $table->timestampTz('created_at');

            $table->index('invoice_id');
            $table->index('location_id');
            $table->unique(['location_id', 'receipt_number']);
        });

        $this->enableRowLevelSecurity('payments');
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
