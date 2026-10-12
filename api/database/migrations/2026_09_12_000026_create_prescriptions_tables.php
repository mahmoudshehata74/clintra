<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * prescriptions and prescription_items (docs/schema.md's v17 additions).
 * Each table gets every per-table object its counterpart already has, so
 * nothing about them is new in kind:
 *
 * - prescriptions mirrors invoices: a direct org_id, a number minted on the
 *   device inside its own series (UNIQUE (location_id, issued_year, series,
 *   number), as 2026_09_12_000024_add_device_number_series.php gave
 *   invoices), foreign keys that never cascade, a rev column with the shared
 *   enforce_row_rev() trigger (2026_09_12_000012_add_row_versioning.php),
 *   ENABLE + FORCE RLS and clintra_app's standard grant
 *   (EnablesRowLevelSecurity). Unlike invoices, at most one per visit
 *   (UNIQUE visit_id) and a created_by membership.
 * - prescription_items mirrors invoice_items: scoped through its parent,
 *   indexed on the parent id, a foreign key to it that does not cascade
 *   (invoice_items' restrictOnDelete), rev + trigger, FORCE RLS, the same
 *   grant.
 *
 * Policies. prescriptions carries a practitioner_id, and a prescription is
 * clinical data about one visit, so its policy is the visits policy
 * verbatim (org + location + practitioner scope), not the invoices one
 * (org + location only, which exists so an assistant with "self"
 * practitioner scope can still bill every practitioner at their location —
 * a reason that does not apply to a prescription). Anyone who can see a
 * visit sees its prescription, and no one else does. prescription_items
 * embeds the same expression through its parent, exactly as invoice_items
 * embeds the invoices expression and visit_form_data the visits one. Both
 * have USING and WITH CHECK (api/docs/rls.md's "How to add a new table").
 *
 * Who may write a prescription (only the visit's own practitioner) is NOT
 * enforced here: the policy admits anyone in scope of the visit, as it does
 * for the visit itself. That rule lives in the web writers
 * (web/src/db/prescriptions.ts) for v1 — a known gap, documented in
 * api/docs/rls.md and docs/schema.md.
 *
 * Re-runnable under migrate:fresh: both tables (and so their policies,
 * triggers and grants) are dropped with them, and enforce_row_rev() is
 * recreated by its own migration earlier in the history.
 */
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    /** The visits policy expression (2026_09_11_170029_enable_rls_policies.php), verbatim. */
    private const PRESCRIPTIONS_SCOPE = 'org_id = current_org() AND location_id IN (SELECT * FROM allowed_locations()) AND practitioner_id IN (SELECT * FROM allowed_practitioners())';

    public function up(): void
    {
        Schema::create('prescriptions', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->foreignUuid('visit_id')->constrained('visits')->restrictOnDelete();
            $table->foreignUuid('patient_id')->constrained('patients')->restrictOnDelete();
            $table->foreignUuid('practitioner_id')->constrained('practitioners')->restrictOnDelete();
            // The minting device's number series (device.series).
            $table->smallInteger('series');
            // The Africa/Cairo calendar year the number belongs to.
            $table->integer('issued_year');
            // Sequential per location per calendar year within one series.
            $table->integer('number');
            // The visit's diagnosis, snapshotted at the first print.
            $table->text('diagnosis')->nullable();
            // Set once, by the first print; locks the prescription.
            $table->timestampTz('printed_at')->nullable();
            // Membership id — the acting membership, not the device.
            $table->foreignUuid('created_by')->constrained('memberships')->restrictOnDelete();
            $table->timestampTz('created_at');

            $table->index('org_id');
            $table->index('location_id');
            $table->unique('visit_id');
            $table->unique(['location_id', 'issued_year', 'series', 'number']);
        });

        Schema::create('prescription_items', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('prescription_id')->constrained('prescriptions')->restrictOnDelete();
            $table->text('name');
            $table->text('form')->nullable();
            // The Arabic dosage line.
            $table->text('instructions');
            $table->text('duration')->nullable();
            $table->text('note')->nullable();
            // 1-based, in append order; removing an item does not renumber.
            $table->integer('position');

            $table->index('prescription_id');
        });

        foreach (['prescriptions', 'prescription_items'] as $table) {
            // The same column and trigger every syncable table got in
            // 2026_09_12_000012_add_row_versioning.php.
            DB::statement("ALTER TABLE {$table} ADD COLUMN rev integer NOT NULL DEFAULT 1");
            DB::statement(
                "CREATE TRIGGER {$table}_enforce_rev BEFORE INSERT OR UPDATE ON {$table} ".
                'FOR EACH ROW EXECUTE FUNCTION enforce_row_rev()'
            );

            $this->enableRowLevelSecurity($table);
        }

        $this->policy('prescriptions', self::PRESCRIPTIONS_SCOPE);
        $this->policy('prescription_items', 'prescription_id IN (SELECT id FROM prescriptions WHERE '.self::PRESCRIPTIONS_SCOPE.')');
    }

    public function down(): void
    {
        Schema::dropIfExists('prescription_items');
        Schema::dropIfExists('prescriptions');
    }

    private function policy(string $table, string $expression): void
    {
        DB::statement("CREATE POLICY {$table}_scope ON {$table} USING ({$expression}) WITH CHECK ({$expression})");
    }
};
