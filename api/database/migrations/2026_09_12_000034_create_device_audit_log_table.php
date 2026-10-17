<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * device_audit_log (docs/audit-sync.md, docs/schema.md's v22 additions):
 * every device's local audit rows, as the device wrote them, so each device
 * of the organization sees who did what on any of them.
 *
 * A table of its own, not rows in audit_log: audit_log is the server's own
 * evidence, whose actor is the token's membership (audit_log_insert checks
 * it); here the actor is the device's claim — the PIN-signed-in member the
 * server cannot see — while the device and the pushing membership are the
 * server's (pushed_by_membership_id = current_membership() in WITH CHECK,
 * device_id from the token). api/docs/rls.md's "Device audit rows".
 *
 * Append-only: clintra_app is granted SELECT and INSERT only (not the
 * EnablesRowLevelSecurity trait's four privileges) and no UPDATE or DELETE
 * policy exists, two independent layers as on audit_log. seq is the pull
 * cursor, GENERATED ALWAYS so no writer supplies one; its writers take the
 * organization's sync lock first (App\Support\Sync\SyncSeqLock).
 *
 * The scope tags location_id and practitioner_id are nullable — null means
 * organization-wide — and each OR branch of the policies sits inside an AND
 * with org_id = current_org().
 *
 * A new, empty table: no backfill, so no NO FORCE step. Re-runnable under
 * migrate:fresh: the table's policies, indexes and grants are dropped with it.
 */
return new class extends Migration
{
    private const SCOPE = 'org_id = current_org()'
        .' AND (location_id IS NULL OR location_id IN (SELECT * FROM allowed_locations()))'
        .' AND (practitioner_id IS NULL OR practitioner_id IN (SELECT * FROM allowed_practitioners()))';

    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE device_audit_log (
                id uuid PRIMARY KEY,
                org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
                location_id uuid NULL REFERENCES locations (id) ON DELETE RESTRICT,
                practitioner_id uuid NULL REFERENCES practitioners (id) ON DELETE RESTRICT,
                actor_membership_id uuid NOT NULL REFERENCES memberships (id) ON DELETE RESTRICT,
                pushed_by_membership_id uuid NOT NULL REFERENCES memberships (id) ON DELETE RESTRICT,
                device_id uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
                entity varchar(64) NOT NULL,
                entity_id uuid NOT NULL,
                action varchar(6) NOT NULL,
                before jsonb NULL,
                after jsonb NULL,
                at timestamptz NOT NULL,
                received_at timestamptz NOT NULL DEFAULT now(),
                seq bigint GENERATED ALWAYS AS IDENTITY,
                CONSTRAINT device_audit_log_action_check CHECK (action IN ('create', 'update', 'delete')),
                CONSTRAINT device_audit_log_seq_unique UNIQUE (seq)
            )
            SQL);

        DB::statement('CREATE INDEX device_audit_log_org_id_seq_index ON device_audit_log (org_id, seq)');
        DB::statement('CREATE INDEX device_audit_log_org_id_at_index ON device_audit_log (org_id, at)');
        DB::statement('CREATE INDEX device_audit_log_entity_entity_id_index ON device_audit_log (entity, entity_id)');

        DB::statement('ALTER TABLE device_audit_log ENABLE ROW LEVEL SECURITY');
        DB::statement('ALTER TABLE device_audit_log FORCE ROW LEVEL SECURITY');

        DB::statement('GRANT SELECT, INSERT ON device_audit_log TO clintra_app');

        DB::statement('CREATE POLICY device_audit_log_select ON device_audit_log FOR SELECT USING ('.self::SCOPE.')');
        DB::statement(
            'CREATE POLICY device_audit_log_insert ON device_audit_log FOR INSERT WITH CHECK ('.self::SCOPE
            .' AND pushed_by_membership_id = current_membership()'
            .' AND actor_membership_id IN (SELECT id FROM memberships WHERE org_id = current_org())'
            .' AND device_id IN (SELECT id FROM device WHERE org_id = current_org()))'
        );
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS device_audit_log');
    }
};
