<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            DO $$
            DECLARE v_function text; v_role text;
            BEGIN
                FOREACH v_function IN ARRAY ARRAY[
                    'public.current_membership()', 'public.current_org()', 'public.allowed_locations()',
                    'public.allowed_practitioners()', 'public.device_exists(uuid)', 'public.enforce_row_rev()',
                    'public.prevent_closed_day_state_mutation()', 'public.visit_form_data_completed_guard()',
                    'public.visit_form_revision_check()'
                ] LOOP
                    FOREACH v_role IN ARRAY ARRAY['clintra_owner', 'clintra_app', 'clintra_rls', 'clintra_provision',
                        'clintra_mint', 'clintra_register', 'clintra_staff', 'clintra_auth', 'clintra_fixtures'] LOOP
                        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
                            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', v_function, v_role);
                        END IF;
                    END LOOP;
                    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_function);
                END LOOP;
            END;
            $$;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DO $$
            DECLARE v_function text; v_role text; v_owner name;
            BEGIN
                FOREACH v_function IN ARRAY ARRAY[
                    'public.current_membership()', 'public.current_org()', 'public.allowed_locations()',
                    'public.allowed_practitioners()', 'public.device_exists(uuid)', 'public.enforce_row_rev()',
                    'public.prevent_closed_day_state_mutation()', 'public.visit_form_data_completed_guard()',
                    'public.visit_form_revision_check()'
                ] LOOP
                    SELECT r.rolname INTO v_owner FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
                        WHERE p.oid=v_function::regprocedure;
                    FOREACH v_role IN ARRAY ARRAY['clintra_owner', 'clintra_app', 'clintra_rls', 'clintra_provision',
                        'clintra_mint', 'clintra_register', 'clintra_staff', 'clintra_auth', 'clintra_fixtures'] LOOP
                        IF v_role <> v_owner AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname=v_role) THEN
                            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', v_function, v_role);
                        END IF;
                    END LOOP;
                    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_function);
                END LOOP;
            END;
            $$;
            GRANT EXECUTE ON FUNCTION public.current_membership(), public.current_org(), public.allowed_locations(),
                public.allowed_practitioners(), public.device_exists(uuid) TO clintra_app, clintra_owner;
        SQL);
    }
};
