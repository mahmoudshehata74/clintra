<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `clintra_app` has held full SELECT/INSERT/UPDATE/DELETE on `audit_log`
 * and `sync_ledger` since each table was created, via the standard
 * `EnablesRowLevelSecurity` grant every table gets. Both tables are
 * meant to be append-only: neither has an `UPDATE`/`DELETE` policy, so
 * with `FORCE ROW LEVEL SECURITY` those two privileges have never
 * actually taken effect — a grant with no matching policy affects zero
 * rows.
 *
 * That made the immutability guarantee correct in practice but fragile in
 * structure: it depended on nobody ever adding an `UPDATE`/`DELETE`
 * policy later for an unrelated reason, which would silently reactivate
 * a grant that was never meant to be live. The audit trail is the only
 * record of who did what (`audit_log`) and the only receipt of what
 * actually synced (`sync_ledger`) — one policy away from a forgeable
 * history is not the same guarantee as two independent layers both
 * saying no.
 *
 * Revokes `UPDATE`/`DELETE` on both tables from `clintra_app` directly,
 * so immutability no longer depends solely on the absence of a policy.
 * `SELECT`/`INSERT` are untouched — both tables are still meant to be
 * read and appended to through the ordinary connection.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('REVOKE UPDATE, DELETE ON audit_log FROM clintra_app');
        DB::statement('REVOKE UPDATE, DELETE ON sync_ledger FROM clintra_app');
    }

    public function down(): void
    {
        DB::statement('GRANT UPDATE, DELETE ON audit_log TO clintra_app');
        DB::statement('GRANT UPDATE, DELETE ON sync_ledger TO clintra_app');
    }
};
