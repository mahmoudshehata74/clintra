<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-device number series (docs/schema.md's v16 additions). Every device
 * minted invoices.number and payments.receipt_number as "local max + 1", so
 * two devices at one location that minted before syncing produced the same
 * number, and the second push died on the unique index. Each device now
 * holds a series number, unique per location, and mints only inside it.
 *
 * - device.series: 1, 2, 3 ... per location, never reused (a revoked
 *   device keeps its own). Existing rows are numbered per location_id in
 *   registered_at order, then id; register_device(jsonb) assigns every
 *   later one (2026_09_12_000025_assign_device_series_at_registration.php).
 * - invoices.series, payments.series: every existing row gets 1. The
 *   DEFAULT exists only so ADD COLUMN fills existing rows in storage; it is
 *   dropped straight after, so every new row must carry its own series.
 * - The unique constraints gain series: (location_id, issued_year, series,
 *   number) and (location_id, series, receipt_number). Every existing row
 *   is series 1, so rows that were unique under the old key stay unique
 *   under the new one.
 * - clintra_register gets SELECT on exactly two device columns, location_id
 *   and series: what register_device needs to compute the next series for
 *   a location, nothing more. It is BYPASSRLS, so that read sees every
 *   device row despite FORCE ROW LEVEL SECURITY (api/docs/rls.md's "One
 *   role per provisioning function"). Granted here, beside the column it is
 *   on, so this migration's down()/up() restores it together with the
 *   column.
 *
 * Why the backfill turns FORCE off for a moment. This migration runs as
 * clintra_owner, which is bound by device's own RLS (FORCE) and never has a
 * membership, so an ordinary UPDATE sees zero device rows: the backfill
 * would silently number nothing and SET NOT NULL would then fail on any
 * database that already holds devices. NO FORCE lets the table owner past
 * RLS for the one UPDATE that numbers existing rows; FORCE is restored
 * before this migration's transaction commits. Laravel runs every pgsql
 * migration inside one transaction (PostgresGrammar supports schema
 * transactions and this class does not opt out of $withinTransaction), and
 * ALTER TABLE holds an ACCESS EXCLUSIVE lock on device until commit, so no
 * other session can ever read or write device while FORCE is off. Policies
 * and every other grant are untouched (tests/Feature/Rls/DeviceSeriesTest.php
 * asserts both RLS flags and the policy are unchanged afterwards).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE device ADD COLUMN IF NOT EXISTS series smallint');

        // NO FORCE, the numbering UPDATE, SET NOT NULL, the unique
        // constraint and FORCE again all run inside this migration's one
        // transaction — see this class's doc comment.
        DB::statement('ALTER TABLE device NO FORCE ROW LEVEL SECURITY');
        DB::statement(<<<'SQL'
            UPDATE device d
            SET series = numbered.series
            FROM (
                SELECT id, row_number() OVER (PARTITION BY location_id ORDER BY registered_at, id) AS series
                FROM device
            ) AS numbered
            WHERE d.id = numbered.id
        SQL);
        DB::statement('ALTER TABLE device ALTER COLUMN series SET NOT NULL');
        DB::statement('ALTER TABLE device DROP CONSTRAINT IF EXISTS device_location_id_series_unique');
        DB::statement('ALTER TABLE device ADD CONSTRAINT device_location_id_series_unique UNIQUE (location_id, series)');
        DB::statement('ALTER TABLE device FORCE ROW LEVEL SECURITY');

        DB::statement('GRANT SELECT (location_id, series) ON device TO clintra_register');

        DB::statement('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS series smallint NOT NULL DEFAULT 1');
        DB::statement('ALTER TABLE invoices ALTER COLUMN series DROP DEFAULT');
        DB::statement('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_location_id_issued_year_number_unique');
        DB::statement('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_location_id_issued_year_series_number_unique');
        DB::statement('ALTER TABLE invoices ADD CONSTRAINT invoices_location_id_issued_year_series_number_unique UNIQUE (location_id, issued_year, series, number)');

        DB::statement('ALTER TABLE payments ADD COLUMN IF NOT EXISTS series smallint NOT NULL DEFAULT 1');
        DB::statement('ALTER TABLE payments ALTER COLUMN series DROP DEFAULT');
        DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_location_id_receipt_number_unique');
        DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_location_id_series_receipt_number_unique');
        DB::statement('ALTER TABLE payments ADD CONSTRAINT payments_location_id_series_receipt_number_unique UNIQUE (location_id, series, receipt_number)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_location_id_series_receipt_number_unique');
        DB::statement('ALTER TABLE payments ADD CONSTRAINT payments_location_id_receipt_number_unique UNIQUE (location_id, receipt_number)');
        DB::statement('ALTER TABLE payments DROP COLUMN IF EXISTS series');

        DB::statement('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_location_id_issued_year_series_number_unique');
        DB::statement('ALTER TABLE invoices ADD CONSTRAINT invoices_location_id_issued_year_number_unique UNIQUE (location_id, issued_year, number)');
        DB::statement('ALTER TABLE invoices DROP COLUMN IF EXISTS series');

        // Dropping the column drops its column grant with it.
        DB::statement('ALTER TABLE device DROP CONSTRAINT IF EXISTS device_location_id_series_unique');
        DB::statement('ALTER TABLE device DROP COLUMN IF EXISTS series');
    }
};
