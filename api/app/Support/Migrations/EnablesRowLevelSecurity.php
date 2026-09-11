<?php

namespace App\Support\Migrations;

use Illuminate\Support\Facades\DB;

/**
 * Every table in this schema is isolated by Postgres RLS, not application
 * code. FORCE is what makes the policy apply even to clintra_owner, the
 * role that creates and owns every table — without it, RLS is a decoration
 * (table owners bypass RLS silently by default). See api/docs/rls.md.
 */
trait EnablesRowLevelSecurity
{
    protected function enableRowLevelSecurity(string $table): void
    {
        DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
        DB::statement("ALTER TABLE {$table} FORCE ROW LEVEL SECURITY");
        DB::statement("GRANT SELECT, INSERT, UPDATE, DELETE ON {$table} TO clintra_app");
    }

    /**
     * For Laravel's own infrastructure tables (sessions, cache, jobs,
     * personal_access_tokens, ...) — not part of the org-scoped domain
     * schema, carry no org_id, and get no RLS policy. clintra_app still
     * needs ordinary CRUD grants here, since clintra_owner (who creates
     * every table) grants nothing to clintra_app by default.
     */
    protected function grantAppAccessWithoutRls(string $table): void
    {
        DB::statement("GRANT SELECT, INSERT, UPDATE, DELETE ON {$table} TO clintra_app");
    }
}
