<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP POLICY visit_form_revisions_insert ON visit_form_revisions');
        DB::statement(<<<'SQL'
            CREATE POLICY visit_form_revisions_insert ON visit_form_revisions FOR INSERT
              WITH CHECK (org_id = current_org()
                          AND visit_id IN (SELECT id FROM visits WHERE org_id = current_org()
                                           AND location_id IN (SELECT * FROM allowed_locations())
                                           AND practitioner_id IN (SELECT * FROM allowed_practitioners()))
                          AND corrected_by IN (SELECT id FROM memberships WHERE org_id = current_org()
                                               AND ((SELECT identity_enforced_at FROM organizations WHERE id = current_org()) IS NULL
                                                    OR id = current_membership()))
                          AND device_id IN (SELECT id FROM device WHERE org_id = current_org()))
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP POLICY visit_form_revisions_insert ON visit_form_revisions');
        DB::statement(<<<'SQL'
            CREATE POLICY visit_form_revisions_insert ON visit_form_revisions FOR INSERT
              WITH CHECK (org_id = current_org()
                          AND visit_id IN (SELECT id FROM visits WHERE org_id = current_org()
                                           AND location_id IN (SELECT * FROM allowed_locations())
                                           AND practitioner_id IN (SELECT * FROM allowed_practitioners()))
                          AND corrected_by IN (SELECT id FROM memberships WHERE org_id = current_org())
                          AND device_id IN (SELECT id FROM device WHERE org_id = current_org()))
            SQL);
    }
};
