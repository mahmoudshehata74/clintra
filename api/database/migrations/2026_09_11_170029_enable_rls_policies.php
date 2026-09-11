<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Helper functions and RLS policies for every table created so far. See
 * api/docs/rls.md for the full model. Short version:
 *
 * - Every request SETs LOCAL app.membership_id inside a transaction
 *   (App\Support\DatabaseSession). Every policy below ultimately resolves
 *   scope from that one value via current_membership()/current_org()/
 *   allowed_locations()/allowed_practitioners().
 * - When app.membership_id is unset, invalid, or doesn't resolve to an
 *   active membership, every helper returns an empty set/null — never an
 *   error — so every policy below correctly returns zero rows rather than
 *   throwing. Fail-safe, not fail-open.
 * - current_org(), allowed_locations() and allowed_practitioners() read
 *   memberships/locations/practitioners/membership_locations/
 *   membership_practitioners — tables that are THEMSELVES RLS-protected by
 *   policies that depend on current_org(). Resolving scope would deadlock
 *   against the very policies it feeds (the first read of `memberships`
 *   needs current_org(), but memberships' own policy needs current_org()
 *   to already be known). These three functions are therefore
 *   SECURITY DEFINER, owned by clintra_rls — a NOLOGIN role created
 *   specifically for this, with BYPASSRLS. clintra_owner and clintra_app
 *   both stay fully RLS-bound for every direct query they run; only these
 *   three narrow, read-only functions run with clintra_rls's bypass, and
 *   only to resolve the calling session's own declared membership's scope.
 */
return new class extends Migration
{
    public function up(): void
    {
        // --- Helper functions -------------------------------------------------

        // Created while acting as clintra_rls (clintra_owner is a granted
        // member of it — see local database setup / CI provisioning), so
        // clintra_rls owns them directly rather than needing a separate
        // ALTER ... OWNER TO step afterward. SECURITY DEFINER is still what
        // makes them actually RUN as clintra_rls for any caller — ownership
        // alone would not. DROP FUNCTION IF EXISTS first makes this
        // migration idempotent across migrate:fresh, which drops tables but
        // not standalone functions.
        DB::statement('SET ROLE clintra_rls');

        DB::statement('DROP FUNCTION IF EXISTS current_membership()');
        DB::statement(<<<'SQL'
            CREATE FUNCTION current_membership() RETURNS uuid
            LANGUAGE plpgsql STABLE AS $$
            BEGIN
                RETURN NULLIF(current_setting('app.membership_id', true), '')::uuid;
            EXCEPTION WHEN invalid_text_representation THEN
                RETURN NULL;
            END;
            $$
        SQL);

        DB::statement('DROP FUNCTION IF EXISTS current_org()');
        DB::statement(<<<'SQL'
            CREATE FUNCTION current_org() RETURNS uuid
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT org_id FROM memberships
                WHERE id = current_membership() AND is_active = true
            $$
        SQL);

        DB::statement('DROP FUNCTION IF EXISTS allowed_locations()');
        DB::statement(<<<'SQL'
            CREATE FUNCTION allowed_locations() RETURNS SETOF uuid
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT l.id FROM locations l
                WHERE l.org_id = current_org()
                  AND EXISTS (
                      SELECT 1 FROM memberships m
                      WHERE m.id = current_membership() AND m.location_scope = 'all'
                  )
                UNION
                SELECT ml.location_id FROM membership_locations ml
                JOIN memberships m ON m.id = ml.membership_id
                WHERE m.id = current_membership() AND m.location_scope = 'listed'
            $$
        SQL);

        DB::statement('DROP FUNCTION IF EXISTS allowed_practitioners()');
        DB::statement(<<<'SQL'
            CREATE FUNCTION allowed_practitioners() RETURNS SETOF uuid
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
                SELECT p.id FROM practitioners p
                WHERE p.org_id = current_org()
                  AND EXISTS (
                      SELECT 1 FROM memberships m
                      WHERE m.id = current_membership() AND m.practitioner_scope = 'all'
                  )
                UNION
                SELECT mp.practitioner_id FROM membership_practitioners mp
                JOIN memberships m ON m.id = mp.membership_id
                WHERE m.id = current_membership() AND m.practitioner_scope = 'listed'
                UNION
                SELECT m.practitioner_id FROM memberships m
                WHERE m.id = current_membership()
                  AND m.practitioner_scope = 'self'
                  AND m.practitioner_id IS NOT NULL
            $$
        SQL);

        DB::statement('RESET ROLE');

        // BYPASSRLS exempts row-security policies, not ordinary privilege
        // checks — clintra_rls still needs plain SELECT to read these tables.
        DB::statement('GRANT SELECT ON memberships, locations, practitioners, membership_locations, membership_practitioners TO clintra_rls');

        DB::statement('GRANT EXECUTE ON FUNCTION current_membership() TO clintra_app, clintra_owner');
        DB::statement('GRANT EXECUTE ON FUNCTION current_org() TO clintra_app, clintra_owner');
        DB::statement('GRANT EXECUTE ON FUNCTION allowed_locations() TO clintra_app, clintra_owner');
        DB::statement('GRANT EXECUTE ON FUNCTION allowed_practitioners() TO clintra_app, clintra_owner');

        // --- Policies ------------------------------------------------------

        // organizations: a membership sees only its own org row. Note this
        // means org creation itself cannot go through the ordinary
        // clintra_app connection (no membership exists yet to grant scope) —
        // out of scope here; bootstrap/onboarding is a future task's problem.
        $this->policy('organizations', 'id = current_org()');

        $this->policy('locations', 'org_id = current_org()');

        // users has no org_id of its own (a user's organizations are its
        // memberships) — visible if it holds a membership in the caller's org.
        $this->policy('users', 'id IN (SELECT user_id FROM memberships WHERE org_id = current_org())');

        $this->policy('memberships', 'org_id = current_org()');

        // Join tables: scope comes from the parent they link, never from an
        // empty-table-means-all reading (see api/docs/rls.md).
        $this->policy('membership_locations', 'membership_id IN (SELECT id FROM memberships WHERE org_id = current_org())');
        $this->policy('membership_practitioners', 'membership_id IN (SELECT id FROM memberships WHERE org_id = current_org())');

        $this->policy('practitioners', 'org_id = current_org()');
        $this->policy('practitioner_locations', 'practitioner_id IN (SELECT id FROM practitioners WHERE org_id = current_org())');

        $this->policy('services', 'org_id = current_org()');
        $this->policy('service_price_overrides', 'service_id IN (SELECT id FROM services WHERE org_id = current_org())');

        $this->policy('schedules', 'practitioner_id IN (SELECT id FROM practitioners WHERE org_id = current_org())');
        $this->policy('schedule_exceptions', 'practitioner_id IN (SELECT id FROM practitioners WHERE org_id = current_org())');

        // patients belong to the org: any staff member who can see any
        // location sees all patients (docs/schema.md).
        $this->policy('patients', 'org_id = current_org()');

        // visits, day_state: full org + location + practitioner scope.
        $this->policy('visits', 'org_id = current_org() AND location_id IN (SELECT * FROM allowed_locations()) AND practitioner_id IN (SELECT * FROM allowed_practitioners())');
        $this->policy('day_state', 'location_id IN (SELECT * FROM allowed_locations()) AND practitioner_id IN (SELECT * FROM allowed_practitioners())');

        // invoices: org + location scope (no practitioner restriction — an
        // assistant with "self" practitioner scope still handles billing for
        // every practitioner at their location).
        $this->policy('invoices', 'org_id = current_org() AND location_id IN (SELECT * FROM allowed_locations())');
        $this->policy('invoice_items', 'invoice_id IN (SELECT id FROM invoices WHERE org_id = current_org() AND location_id IN (SELECT * FROM allowed_locations()))');

        // payments, cash_close: no org_id column exists on either table in
        // docs/schema.md — only location_id. allowed_locations() is itself
        // already scoped to the caller's own org, so filtering on location
        // alone is still fully org-isolated, not a weaker guarantee.
        $this->policy('payments', 'location_id IN (SELECT * FROM allowed_locations())');
        $this->policy('cash_close', 'location_id IN (SELECT * FROM allowed_locations())');

        // audit_log: org-scoped reads. INSERT is deliberately open beyond
        // location/practitioner scope (still org-scoped) — an acting
        // membership must be able to write an audit row even when the entity
        // it's auditing sits outside that membership's own location/
        // practitioner scope. No UPDATE/DELETE policy is defined at all:
        // with RLS forced and no matching policy, every UPDATE/DELETE
        // affects zero rows — audit history is immutable by construction,
        // not just by convention.
        DB::statement('CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (org_id = current_org())');
        DB::statement('CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (org_id = current_org())');

        // specialty_templates: null org_id means system-wide, visible to
        // every org.
        $this->policy('specialty_templates', 'org_id = current_org() OR org_id IS NULL');
        $this->policy('form_definitions', 'template_id IN (SELECT id FROM specialty_templates WHERE org_id = current_org() OR org_id IS NULL)');
        $this->policy('visit_form_data', 'visit_id IN (SELECT id FROM visits WHERE org_id = current_org() AND location_id IN (SELECT * FROM allowed_locations()) AND practitioner_id IN (SELECT * FROM allowed_practitioners()))');

        $this->policy('care_plans', 'org_id = current_org()');
        $this->policy('care_plan_items', 'care_plan_id IN (SELECT id FROM care_plans WHERE org_id = current_org())');

        $this->policy('device', 'org_id = current_org()');
        $this->policy('sync_ops', 'device_id IN (SELECT id FROM device WHERE org_id = current_org())');
        $this->policy('sync_review', 'op_id IN (SELECT so.op_id FROM sync_ops so JOIN device d ON d.id = so.device_id WHERE d.org_id = current_org())');
    }

    public function down(): void
    {
        foreach ([
            'organizations', 'locations', 'users', 'memberships',
            'membership_locations', 'membership_practitioners',
            'practitioners', 'practitioner_locations', 'services',
            'service_price_overrides', 'schedules', 'schedule_exceptions',
            'patients', 'visits', 'day_state', 'invoices', 'invoice_items',
            'payments', 'cash_close', 'specialty_templates',
            'form_definitions', 'visit_form_data', 'care_plans',
            'care_plan_items', 'device', 'sync_ops', 'sync_review',
        ] as $table) {
            DB::statement("DROP POLICY IF EXISTS {$table}_scope ON {$table}");
        }

        DB::statement('DROP POLICY IF EXISTS audit_log_select ON audit_log');
        DB::statement('DROP POLICY IF EXISTS audit_log_insert ON audit_log');

        // These four are owned by clintra_rls (see up()) — clintra_owner
        // can only drop them by temporarily assuming that role too.
        DB::statement('SET ROLE clintra_rls');
        DB::statement('DROP FUNCTION IF EXISTS allowed_practitioners()');
        DB::statement('DROP FUNCTION IF EXISTS allowed_locations()');
        DB::statement('DROP FUNCTION IF EXISTS current_org()');
        DB::statement('DROP FUNCTION IF EXISTS current_membership()');
        DB::statement('RESET ROLE');
    }

    private function policy(string $table, string $expression): void
    {
        DB::statement("CREATE POLICY {$table}_scope ON {$table} USING ({$expression}) WITH CHECK ({$expression})");
    }
};
