<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's invoice_items table and its v7 additions (invoice_id
// index). Carries financial history, so its foreign keys don't cascade.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('invoice_items', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('invoice_id')->constrained('invoices')->restrictOnDelete();
            $table->foreignUuid('service_id')->constrained('services')->restrictOnDelete();
            $table->string('description');
            $table->integer('qty');
            // Piastres — integer, never a float.
            $table->bigInteger('unit_price');
            $table->bigInteger('total');

            $table->index('invoice_id');
        });

        $this->enableRowLevelSecurity('invoice_items');
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_items');
    }
};
