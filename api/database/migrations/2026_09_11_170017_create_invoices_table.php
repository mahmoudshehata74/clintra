<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's invoices table and its v7 additions (issued_year,
// the corrected per-year numbering, visit_id/location_id indexes). Carries
// audit/financial history, so no foreign key here cascades deletes.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            // Sequential per location per calendar year (see issued_year).
            $table->integer('number');
            // The Africa/Cairo calendar year issued_at falls in — a real,
            // indexed column (not derived on read), since the unique index
            // below needs an actual key path.
            $table->integer('issued_year');
            $table->foreignUuid('patient_id')->constrained('patients')->restrictOnDelete();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            $table->foreignUuid('visit_id')->nullable()->constrained('visits')->restrictOnDelete();
            // Piastres — integer, never a float.
            $table->bigInteger('total');
            $table->bigInteger('paid');
            $table->enum('status', ['unpaid', 'partial', 'paid', 'void']);
            $table->timestampTz('issued_at');

            $table->index('org_id');
            $table->index('location_id');
            $table->index('visit_id');
            $table->unique(['location_id', 'issued_year', 'number']);
        });

        $this->enableRowLevelSecurity('invoices');
    }

    public function down(): void
    {
        Schema::dropIfExists('invoices');
    }
};
