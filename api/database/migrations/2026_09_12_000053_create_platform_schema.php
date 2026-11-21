<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- Laravel's fresh drops the tables in the owner's search_path, but
            -- leaves schemas, standalone functions and extensions. Only a fully
            -- emptied test schema may be rebuilt; inconsistent states fail.
            DO $$
            BEGIN
                IF to_regnamespace('platform') IS NOT NULL OR to_regnamespace('platform_crypto') IS NOT NULL THEN
                    IF current_database() <> 'clintra_test'
                       OR to_regnamespace('platform') IS NULL OR to_regnamespace('platform_crypto') IS NULL
                       OR NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
                                      WHERE e.extname='pgcrypto' AND n.nspname='platform_crypto')
                       OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                                  WHERE n.nspname IN ('platform','platform_crypto'))
                       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                                  WHERE n.nspname='platform' AND p.proname NOT IN ('admin_log_refuse_change',
                                    'totp_at','admin_login','admin_logout','admin_change_password',
                                    'admin_session_actor','admin_session_state','admin_step_up','admin_log_write','admin_log_refusal','admin_log_cli'))
                       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                                  WHERE n.nspname='platform_crypto' AND NOT EXISTS (
                                    SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
                                    WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid
                                      AND d.deptype='e' AND e.extname='pgcrypto')) THEN
                        RAISE EXCEPTION 'platform schemas are not an empty migrate:fresh remainder' USING ERRCODE='55000';
                    END IF;
                    DROP SCHEMA platform CASCADE;
                    DROP EXTENSION pgcrypto;
                    DROP SCHEMA platform_crypto;
                END IF;
            END;
            $$;
            CREATE SCHEMA platform AUTHORIZATION clintra_owner;
            REVOKE ALL ON SCHEMA platform FROM PUBLIC;
            CREATE SCHEMA platform_crypto AUTHORIZATION clintra_owner;
            REVOKE ALL ON SCHEMA platform_crypto FROM PUBLIC;
            GRANT USAGE ON SCHEMA platform_crypto TO clintra_admin_auth;
            CREATE EXTENSION pgcrypto WITH SCHEMA platform_crypto;

            CREATE TABLE platform.admin_users (
                id uuid PRIMARY KEY,
                email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
                name varchar(120) NOT NULL,
                password_hash text NOT NULL,
                must_change_password boolean NOT NULL DEFAULT true,
                totp_secret bytea NOT NULL,
                last_totp_step bigint NULL,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_login_at timestamptz NULL
            );
            CREATE TABLE platform.admin_recovery_codes (
                id uuid PRIMARY KEY,
                admin_user_id uuid NOT NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
                code_hash text NOT NULL,
                used_at timestamptz NULL,
                UNIQUE (admin_user_id, code_hash)
            );
            CREATE TABLE platform.admin_sessions (
                id uuid PRIMARY KEY,
                admin_user_id uuid NOT NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_seen_at timestamptz NOT NULL DEFAULT now(),
                expires_at timestamptz NOT NULL,
                ended_at timestamptz NULL,
                ip inet NULL,
                user_agent varchar(400) NULL
            );
            CREATE TABLE platform.admin_log (
                seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                id uuid NOT NULL UNIQUE,
                at timestamptz NOT NULL DEFAULT now(),
                admin_user_id uuid NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
                action text NOT NULL CHECK (action IN (
                    'admin.login', 'admin.logout', 'admin.password_change', 'figures.view', 'org.provision',
                    'code.mint_request', 'code.mint_approve', 'device.revoke', 'org.disable', 'org.enable',
                    'support.open', 'cli.provision', 'cli.mint', 'cli.revoke', 'cli.admin_create')),
                org_id uuid NULL REFERENCES organizations(id) ON DELETE RESTRICT,
                target_id uuid NULL,
                succeeded boolean NOT NULL,
                reason text NULL,
                detail jsonb NOT NULL DEFAULT '{}'::jsonb,
                ip inet NULL,
                user_agent varchar(400) NULL
            );
            CREATE INDEX admin_log_org ON platform.admin_log (org_id, seq);
            CREATE INDEX admin_log_login_failures ON platform.admin_log (action, at) WHERE NOT succeeded;
            CREATE TABLE platform.admin_approvals (
                id uuid PRIMARY KEY,
                action text NOT NULL CHECK (action IN ('code.mint')),
                org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
                location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
                purpose text NOT NULL CHECK (purpose IN ('device', 'owner_recovery')),
                requested_by uuid NOT NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
                requested_at timestamptz NOT NULL DEFAULT now(),
                expires_at timestamptz NOT NULL,
                approved_by uuid NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
                approved_at timestamptz NULL,
                CHECK (approved_by IS NULL OR approved_by <> requested_by)
            );
            CREATE TABLE platform.support_exchanges (
                exchange_hash text PRIMARY KEY,
                device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
                expires_at timestamptz NOT NULL,
                used_at timestamptz NULL
            );
            CREATE FUNCTION platform.admin_log_refuse_change() RETURNS trigger
            LANGUAGE plpgsql SET search_path = public, platform, pg_temp AS $$
            BEGIN
                RAISE EXCEPTION 'admin_log is append-only' USING ERRCODE = '55000';
            END;
            $$;
            REVOKE EXECUTE ON FUNCTION platform.admin_log_refuse_change() FROM PUBLIC;
            CREATE TRIGGER admin_log_append_only BEFORE UPDATE OR DELETE ON platform.admin_log
                FOR EACH ROW EXECUTE FUNCTION platform.admin_log_refuse_change();
            CREATE TRIGGER admin_log_no_truncate BEFORE TRUNCATE ON platform.admin_log
                FOR EACH STATEMENT EXECUTE FUNCTION platform.admin_log_refuse_change();
            REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC, clintra_admin_app;
            REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA platform FROM PUBLIC;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TABLE platform.support_exchanges;
            DROP TABLE platform.admin_approvals;
            DROP TABLE platform.admin_log;
            DROP TABLE platform.admin_sessions;
            DROP TABLE platform.admin_recovery_codes;
            DROP TABLE platform.admin_users;
            DROP FUNCTION platform.admin_log_refuse_change();
            DROP EXTENSION pgcrypto;
            DROP SCHEMA platform_crypto;
            DROP SCHEMA platform;
        SQL);
    }
};
