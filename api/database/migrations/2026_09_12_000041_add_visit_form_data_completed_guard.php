<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * visit_form_data_completed_guard (docs/design-clinical-corrections.md's
 * second trigger in 6.3, and its decision 7): a completed visit's form
 * changes only through a revision written just before, for exactly this
 * change. An insert on a completed visit must carry only empty values; an
 * update that changes data must match a revision naming the row's current
 * rev and the new data. Its 55000 message, correction_required, is mapped
 * by SyncOpApplier.
 *
 * A separate, second migration: it is deployed once every device runs the
 * web release that writes corrections, since until then an older device
 * still saves a late edit by autosave. SyncOpApplier's own
 * correction_required rule follows it: the applier enforces the rule only
 * while this trigger is installed.
 *
 * It runs as the invoker, so its reads go through the caller's own RLS. It
 * fires before visit_form_data_enforce_rev (triggers fire in name order),
 * so OLD.rev is the row's real rev. No trigger blocks deletes: the applier
 * refuses a delete of a completed visit's form (correction_required), and
 * clintra_fixtures deletes through for the test cleanup.
 */
return new class extends Migration
{
    public function up(): void
    {
        // migrate:fresh drops tables (and their triggers), not functions.
        DB::statement('DROP FUNCTION IF EXISTS visit_form_data_completed_guard()');
        DB::statement(<<<'SQL'
            CREATE FUNCTION visit_form_data_completed_guard() RETURNS trigger
            LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM visits WHERE id = NEW.visit_id AND status = 'completed') THEN
                RETURN NEW;
              END IF;
              IF TG_OP = 'INSERT' THEN
                IF EXISTS (SELECT 1 FROM jsonb_each_text(NEW.data) AS e WHERE e.value <> '') THEN
                  RAISE EXCEPTION 'correction_required' USING ERRCODE = '55000';
                END IF;
                RETURN NEW;
              END IF;
              IF NEW.data IS NOT DISTINCT FROM OLD.data THEN
                RETURN NEW;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM visit_form_revisions r
                             WHERE r.visit_form_data_id = OLD.id AND r.replaced_rev = OLD.rev AND r.new_data = NEW.data) THEN
                RAISE EXCEPTION 'correction_required' USING ERRCODE = '55000';
              END IF;
              RETURN NEW;
            END;
            $$
            SQL);
        DB::statement(<<<'SQL'
            CREATE TRIGGER visit_form_data_completed_guard BEFORE INSERT OR UPDATE ON visit_form_data
              FOR EACH ROW EXECUTE FUNCTION visit_form_data_completed_guard()
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS visit_form_data_completed_guard ON visit_form_data');
        DB::statement('DROP FUNCTION IF EXISTS visit_form_data_completed_guard()');
    }
};
