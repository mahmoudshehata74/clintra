<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's visits table and its v3 additions (unique_scheduled_at).
// This carries audit history end to end, so none of its foreign keys cascade
// deletes — deleting a location or practitioner must never silently remove
// past visits (restrictOnDelete throughout).
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('visits', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            $table->foreignUuid('patient_id')->constrained('patients')->restrictOnDelete();
            $table->foreignUuid('service_id')->nullable()->constrained('services')->restrictOnDelete();
            // Left null in v1. No FK yet: care_plan_items.visit_id references
            // visits.id, so the two tables have a circular dependency and
            // this column is always null until the care-plan feature ships —
            // adding the constraint now would buy nothing but ordering pain.
            $table->uuid('care_plan_item_id')->nullable();
            $table->date('visit_date');
            // Ordering within the day — carries queue mode's position.
            $table->integer('position');
            // Null in queue mode.
            $table->timestampTz('scheduled_at')->nullable();
            // Equal to scheduled_at, except entirely absent (not merely null)
            // when is_overbooked is true — see the unique index below.
            $table->timestampTz('unique_scheduled_at')->nullable();
            $table->enum('status', [
                'booked', 'confirmed', 'arrived', 'in_room', 'completed',
                'cancelled', 'no_show', 'rescheduled',
            ]);
            $table->boolean('is_overbooked');
            $table->enum('source', ['phone', 'walkin', 'recovered']);
            $table->timestampTz('arrived_at')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('ended_at')->nullable();
            $table->enum('cancel_reason', ['patient', 'clinic', 'no_show', 'postpone'])->nullable();
            // Self-referencing FK added below, after the table (and its
            // primary key) fully exists — Postgres rejects a self-FK added
            // in the same CREATE TABLE batch as the primary key, because
            // Laravel's Postgres grammar adds PRIMARY KEY last, after
            // foreign keys.
            $table->uuid('rescheduled_from')->nullable();
            // Membership id — the acting membership, not the device.
            $table->foreignUuid('created_by')->constrained('memberships')->restrictOnDelete();
            $table->timestampTz('created_at');

            $table->index(['org_id', 'location_id', 'visit_date', 'status']);
            $table->index(['practitioner_id', 'visit_date']);
            $table->unique(['practitioner_id', 'visit_date', 'position']);
            // Postgres treats NULL as distinct in a unique index, so this
            // naturally allows unlimited overbooked/queue-mode rows (whose
            // unique_scheduled_at is null) while still enforcing the rule
            // for every slots-mode, non-overbooked visit.
            $table->unique(['practitioner_id', 'visit_date', 'unique_scheduled_at']);
        });

        Schema::table('visits', function (Blueprint $table) {
            $table->foreign('rescheduled_from')->references('id')->on('visits')->restrictOnDelete();
        });

        $this->enableRowLevelSecurity('visits');
    }

    public function down(): void
    {
        Schema::dropIfExists('visits');
    }
};
