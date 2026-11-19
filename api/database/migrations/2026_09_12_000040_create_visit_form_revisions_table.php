<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * visit_form_revisions (docs/design-clinical-corrections.md, sections 6.1,
 * 6.2 and the first trigger of 6.3; docs/schema.md's v28 additions): once a
 * visit is completed, its doctor or the owner corrects the visit form only
 * with a reason, and the version it replaces is kept here, append-only and
 * synced.
 *
 * Append-only, as device_audit_log: clintra_app is granted SELECT and
 * INSERT only and no UPDATE or DELETE policy exists, so a refused statement
 * fails on the grant (42501). No trigger refuses deletes for every role,
 * because clintra_fixtures (test-only) deletes through it for the Pest
 * cleanup and the live run's organization removal. Each IN of the policies
 * sits inside an AND with org_id = current_org(), so nothing is reachable
 * without a membership.
 *
 * visit_form_revision_check() holds the revision to the stored row: on a
 * completed visit, naming the row's current rev and data, the next number,
 * and written by the visit's doctor or an owner. It runs as the invoker, so
 * its reads go through the caller's own RLS. Its 55000 messages
 * (correction_invalid, correction_not_allowed) are mapped to rejection
 * reasons by SyncOpApplier.
 *
 * The guard that refuses a completed visit's form change without a revision
 * (visit_form_data_completed_guard) is the separate, second migration
 * (2026_09_12_000041), deployed once every device runs the web release that
 * writes corrections (the design's decision 7).
 *
 * A new, empty table: no backfill. Re-runnable under migrate:fresh: the
 * table's policies, index, triggers and grants are dropped with it, and the
 * function, which outlives a dropped table, is dropped before it is created.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE visit_form_revisions (
              id uuid PRIMARY KEY,
              org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
              visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
              visit_form_data_id uuid NOT NULL REFERENCES visit_form_data(id) ON DELETE RESTRICT,
              revision_no integer NOT NULL CHECK (revision_no >= 1),
              replaced_rev integer NOT NULL CHECK (replaced_rev >= 1),
              previous_data jsonb NOT NULL,
              new_data jsonb NOT NULL,
              reason varchar(500) NOT NULL CHECK (char_length(btrim(reason)) >= 3 AND reason = btrim(reason)),
              corrected_by uuid NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
              corrected_at timestamptz NOT NULL,
              device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
              rev integer NOT NULL DEFAULT 1,
              CONSTRAINT visit_form_revisions_number_unique UNIQUE (visit_form_data_id, revision_no),
              CHECK (new_data IS DISTINCT FROM previous_data)
            )
            SQL);
        DB::statement('CREATE INDEX visit_form_revisions_visit ON visit_form_revisions (visit_id)');
        DB::statement(<<<'SQL'
            CREATE TRIGGER visit_form_revisions_enforce_rev BEFORE INSERT OR UPDATE ON visit_form_revisions
              FOR EACH ROW EXECUTE FUNCTION enforce_row_rev()
            SQL);

        DB::statement('ALTER TABLE visit_form_revisions ENABLE ROW LEVEL SECURITY');
        DB::statement('ALTER TABLE visit_form_revisions FORCE ROW LEVEL SECURITY');
        DB::statement('REVOKE ALL ON visit_form_revisions FROM PUBLIC');
        DB::statement('GRANT SELECT, INSERT ON visit_form_revisions TO clintra_app');

        DB::statement(<<<'SQL'
            CREATE POLICY visit_form_revisions_select ON visit_form_revisions FOR SELECT
              USING (org_id = current_org()
                     AND visit_id IN (SELECT id FROM visits WHERE org_id = current_org()
                                      AND location_id IN (SELECT * FROM allowed_locations())
                                      AND practitioner_id IN (SELECT * FROM allowed_practitioners())))
            SQL);
        DB::statement(<<<'SQL'
            CREATE POLICY visit_form_revisions_insert ON visit_form_revisions FOR INSERT
              WITH CHECK (org_id = current_org()
                          AND visit_id IN (SELECT id FROM visits WHERE org_id = current_org()
                                           AND location_id IN (SELECT * FROM allowed_locations())
                                           AND practitioner_id IN (SELECT * FROM allowed_practitioners()))
                          AND corrected_by IN (SELECT id FROM memberships WHERE org_id = current_org())
                          AND device_id IN (SELECT id FROM device WHERE org_id = current_org()))
            SQL);

        // migrate:fresh drops tables, not functions: a function left by an
        // earlier run is dropped first, as every function migration here does.
        DB::statement('DROP FUNCTION IF EXISTS visit_form_revision_check()');
        DB::statement(<<<'SQL'
            CREATE FUNCTION visit_form_revision_check() RETURNS trigger
            LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
            DECLARE
              v_form_id uuid;
              v_form_visit uuid;
              v_form_data jsonb;
              v_form_rev integer;
              v_visit record;
              v_actor record;
            BEGIN
              SELECT id, visit_id, data, rev INTO v_form_id, v_form_visit, v_form_data, v_form_rev
                FROM visit_form_data WHERE id = NEW.visit_form_data_id FOR UPDATE;
              SELECT id, org_id, status, practitioner_id INTO v_visit FROM visits WHERE id = v_form_visit;
              IF v_form_id IS NULL OR v_visit.id IS NULL OR v_visit.id <> NEW.visit_id OR v_visit.org_id <> NEW.org_id
                 OR v_visit.status <> 'completed'
                 OR v_form_rev <> NEW.replaced_rev
                 OR v_form_data IS DISTINCT FROM NEW.previous_data
                 OR NEW.revision_no <> coalesce((SELECT max(revision_no) FROM visit_form_revisions
                                                 WHERE visit_form_data_id = NEW.visit_form_data_id), 0) + 1 THEN
                RAISE EXCEPTION 'correction_invalid' USING ERRCODE = '55000';
              END IF;
              SELECT id, org_id, role, practitioner_id INTO v_actor FROM memberships WHERE id = NEW.corrected_by AND is_active;
              IF v_actor.id IS NULL OR v_actor.org_id <> NEW.org_id
                 OR NOT (v_actor.role = 'owner' OR v_actor.practitioner_id IS NOT DISTINCT FROM v_visit.practitioner_id) THEN
                RAISE EXCEPTION 'correction_not_allowed' USING ERRCODE = '55000';
              END IF;
              RETURN NEW;
            END;
            $$
            SQL);
        DB::statement(<<<'SQL'
            CREATE TRIGGER visit_form_revisions_check BEFORE INSERT ON visit_form_revisions
              FOR EACH ROW EXECUTE FUNCTION visit_form_revision_check()
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS visit_form_revisions');
        DB::statement('DROP FUNCTION IF EXISTS visit_form_revision_check()');
    }
};
