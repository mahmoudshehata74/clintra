<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            GRANT USAGE ON SCHEMA platform TO clintra_admin_app, clintra_admin_auth, clintra_admin_provision,
                clintra_admin_mint, clintra_admin_device, clintra_admin_org, clintra_admin_stats,
                clintra_admin_support, clintra_support;
            GRANT SELECT ON platform.admin_users TO clintra_admin_auth;
            GRANT UPDATE (last_totp_step, last_login_at, password_hash) ON platform.admin_users TO clintra_admin_auth;
            GRANT SELECT ON platform.admin_recovery_codes TO clintra_admin_auth;
            GRANT UPDATE (used_at) ON platform.admin_recovery_codes TO clintra_admin_auth;
            GRANT SELECT, INSERT ON platform.admin_sessions TO clintra_admin_auth;
            GRANT UPDATE (last_seen_at, ended_at) ON platform.admin_sessions TO clintra_admin_auth;
            GRANT SELECT, INSERT ON platform.admin_log TO clintra_admin_auth;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM clintra_admin_auth;
            REVOKE UPDATE (last_totp_step, last_login_at, password_hash) ON platform.admin_users FROM clintra_admin_auth;
            REVOKE UPDATE (used_at) ON platform.admin_recovery_codes FROM clintra_admin_auth;
            REVOKE UPDATE (last_seen_at, ended_at) ON platform.admin_sessions FROM clintra_admin_auth;
            REVOKE USAGE ON SCHEMA platform FROM clintra_admin_app, clintra_admin_auth, clintra_admin_provision,
                clintra_admin_mint, clintra_admin_device, clintra_admin_org, clintra_admin_stats,
                clintra_admin_support, clintra_support;
        SQL);
    }
};
