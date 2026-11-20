<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Identity phase A1: never grant what you don't hold, in the database
 * (docs/design-identity-permissions.md, 6.3). The applier and the endpoints
 * refuse first with a clean reason (`permission_escalation`); this trigger is
 * the backstop for every writer that acts as a person.
 *
 * Differences from the design's 6.3:
 * - SECURITY DEFINER, owned by clintra_auth (which already reads memberships'
 *   role, permissions and is_active): every writer of memberships —
 *   clintra_app under RLS, clintra_staff inside add_staff_member — then
 *   needs no new grant to run it.
 * - It applies only to an organization whose identity_enforced_at is set
 *   ("A1 decisions", 4): until then nobody is proven, permissions are not in
 *   use, and every membership write behaves exactly as before.
 *
 * Migrations, the CLI and the provisioning functions act as no person
 * (current_membership() is null) and are never checked.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS memberships_permission_guard ON memberships');
        DB::statement('DROP FUNCTION IF EXISTS membership_permission_guard()');

        DB::statement('SET ROLE clintra_auth');

        DB::statement(<<<'SQL'
            CREATE FUNCTION membership_permission_guard() RETURNS trigger
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
            DECLARE
                v_actor uuid := current_membership();
                v_actor_role text;
                v_actor_perms text[];
                v_old_perms text[] := CASE WHEN TG_OP = 'UPDATE' THEN OLD.permissions ELSE '{}'::text[] END;
            BEGIN
                IF v_actor IS NULL THEN
                    RETURN NEW;
                END IF;
                IF TG_OP = 'UPDATE' AND NEW.permissions IS NOT DISTINCT FROM OLD.permissions AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
                    RETURN NEW;
                END IF;
                IF (SELECT identity_enforced_at FROM organizations WHERE id = NEW.org_id) IS NULL THEN
                    RETURN NEW;
                END IF;

                SELECT role, permissions INTO v_actor_role, v_actor_perms
                FROM memberships WHERE id = v_actor AND is_active;

                IF v_actor_role IS NULL OR NEW.id = v_actor THEN
                    RAISE EXCEPTION 'permission_escalation' USING ERRCODE = '42501';
                END IF;
                IF v_actor_role = 'owner' THEN
                    RETURN NEW;
                END IF;
                IF NOT ('staff.manage' = ANY (v_actor_perms))
                    OR NEW.role = 'owner'
                    OR (TG_OP = 'UPDATE' AND (OLD.role = 'owner' OR NEW.role IS DISTINCT FROM OLD.role))
                    OR NOT (ARRAY(SELECT unnest(NEW.permissions) EXCEPT SELECT unnest(v_old_perms)) <@ v_actor_perms)
                    OR NOT (ARRAY(SELECT unnest(v_old_perms) EXCEPT SELECT unnest(NEW.permissions)) <@ v_actor_perms) THEN
                    RAISE EXCEPTION 'permission_escalation' USING ERRCODE = '42501';
                END IF;

                RETURN NEW;
            END;
            $$
        SQL);

        DB::statement('REVOKE EXECUTE ON FUNCTION membership_permission_guard() FROM PUBLIC');

        DB::statement('RESET ROLE');

        DB::statement(<<<'SQL'
            CREATE TRIGGER memberships_permission_guard
                BEFORE INSERT OR UPDATE OF permissions, role ON memberships
                FOR EACH ROW EXECUTE FUNCTION membership_permission_guard()
        SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS memberships_permission_guard ON memberships');
        DB::statement('DROP FUNCTION IF EXISTS membership_permission_guard()');
    }
};
