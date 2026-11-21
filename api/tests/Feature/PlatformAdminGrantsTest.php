<?php

use Illuminate\Database\QueryException;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

test('the nine admin roles match design 6.1 and only the eight function roles belong to the migration owner', function () {
    $rows = $this->asOwner()->select("SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolconfig::text AS config,pg_has_role('clintra_owner',oid,'MEMBER') AS member FROM pg_roles WHERE rolname LIKE 'clintra_admin_%' OR rolname='clintra_support' ORDER BY rolname");
    expect($rows)->toHaveCount(9);
    $bypass = ['clintra_admin_device', 'clintra_admin_org', 'clintra_admin_stats', 'clintra_admin_support', 'clintra_support'];
    foreach ($rows as $role) {
        $login = $role->rolname === 'clintra_admin_app';
        expect($role->rolcanlogin)->toBe($login)->and($role->rolsuper)->toBeFalse()
            ->and($role->rolcreatedb)->toBeFalse()->and($role->rolcreaterole)->toBeFalse()
            ->and($role->rolreplication)->toBeFalse()->and($role->rolbypassrls)->toBe(in_array($role->rolname, $bypass, true))
            ->and($role->rolinherit)->toBe(! $login)->and($role->member)->toBe(! $login);
        if ($login) {
            expect($role->config)->toBe('{log_parameter_max_length=0,log_parameter_max_length_on_error=0}');
        }
    }
    expect($this->asOwner()->select("SELECT 1 FROM pg_auth_members WHERE roleid='clintra_admin_app'::regrole OR member='clintra_app'::regrole"))->toBe([]);
});

test('the panel can reach exactly its four B1 functions and no table or column', function () {
    expect($this->panel()->selectOne('SELECT current_user AS name')->name)->toBe('clintra_admin_app');
    $reachable = $this->asOwner()->select(<<<'SQL'
        SELECT n.nspname||'.'||p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')
          AND has_schema_privilege('clintra_admin_app',n.oid,'USAGE')
          AND has_function_privilege('clintra_admin_app',p.oid,'EXECUTE') ORDER BY name
    SQL);
    expect(array_column($reachable, 'name'))->toBe([
        'platform.admin_change_password', 'platform.admin_log_refusal', 'platform.admin_login', 'platform.admin_logout',
    ]);
    $tables = $this->asOwner()->select(<<<'SQL'
        SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','platform','platform_crypto') AND c.relkind IN ('r','p','v','m','f')
          AND (has_table_privilege('clintra_admin_app',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               OR has_any_column_privilege('clintra_admin_app',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    SQL);
    expect($tables)->toBe([]);
    foreach (['admin_users', 'admin_log'] as $table) {
        expect(fn () => $this->panel()->select('SELECT * FROM platform.'.$table))->toThrow(QueryException::class);
    }
});

test('no public or platform function exposes PUBLIC EXECUTE and crypto is schema gated', function () {
    $leaks = $this->asOwner()->select(<<<'SQL'
        SELECT n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','platform','platform_crypto')
          AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                     WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
          AND (n.nspname IN ('public','platform') OR EXISTS(
              SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
              WHERE a.grantee=0 AND a.privilege_type='USAGE'))
    SQL);
    expect($leaks)->toBe([]);
    $grants = $this->asOwner()->select(<<<'SQL'
        SELECT r.rolname,a.privilege_type FROM pg_namespace n,
        LATERAL aclexplode(n.nspacl) a JOIN pg_roles r ON r.oid=a.grantee
        WHERE n.nspname='platform_crypto' AND r.rolname<>'clintra_owner' ORDER BY 1,2
    SQL);
    expect(array_map(fn ($r) => $r->rolname.':'.$r->privilege_type, $grants))->toBe(['clintra_admin_auth:USAGE']);
    expect(fn () => $this->panel()->select("SELECT platform_crypto.crypt('value','salt')"))->toThrow(QueryException::class);
    $foreignObjects = $this->asOwner()->select(<<<'SQL'
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='platform_crypto' AND NOT EXISTS (
            SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
            WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e' AND e.extname='pgcrypto')
    SQL);
    expect($foreignObjects)->toBe([]);
});

test('every B1 function has the exact owner security settings and EXECUTE callers of 6.5', function () {
    $actions = ['clintra_admin_device', 'clintra_admin_mint', 'clintra_admin_org', 'clintra_admin_provision', 'clintra_admin_stats', 'clintra_admin_support'];
    $expected = [
        'totp_at' => [], 'admin_login' => ['clintra_admin_app'], 'admin_logout' => ['clintra_admin_app'],
        'admin_change_password' => ['clintra_admin_app'], 'admin_log_refusal' => ['clintra_admin_app'],
        'admin_log_cli' => ['clintra_owner'], 'admin_session_actor' => $actions, 'admin_log_write' => $actions,
        'admin_session_state' => [], 'admin_step_up' => [],
    ];
    foreach ($expected as $function => $callers) {
        $row = $this->asOwner()->selectOne(<<<'SQL'
            SELECT p.oid,r.rolname,p.prosecdef,p.proconfig::text AS config
            FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='platform' AND p.proname=?
        SQL, [$function]);
        expect($row->rolname)->toBe('clintra_admin_auth')->and($row->prosecdef)->toBeTrue()
            ->and($row->config)->toBe('{"search_path=public, platform, pg_temp"}');
        $acl = $this->asOwner()->select("SELECT r.rolname FROM pg_proc p,LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=? AND a.privilege_type='EXECUTE' ORDER BY r.rolname", [$row->oid]);
        $callers[] = 'clintra_admin_auth';
        sort($callers);
        expect(array_column($acl, 'rolname'))->toBe($callers);
    }
    foreach (['admin_session_actor' => 'uuid,text,boolean', 'admin_log_write' => 'uuid,uuid,text,uuid,uuid,boolean,text,jsonb,inet,text'] as $name => $signature) {
        expect($this->asOwner()->selectOne("SELECT has_function_privilege('clintra_admin_app',?,'EXECUTE') AS allowed", ['platform.'.$name.'('.$signature.')'])->allowed)->toBeFalse();
    }
});

test('the auth role has column-exact grants and all other new roles have no table grants in B1', function () {
    $expected = [
        'admin_users:SELECT' => ['created_at', 'email', 'id', 'is_active', 'last_login_at', 'last_totp_step', 'must_change_password', 'name', 'password_hash', 'totp_secret'],
        'admin_users:UPDATE' => ['last_login_at', 'last_totp_step', 'must_change_password', 'password_hash'],
        'admin_recovery_codes:SELECT' => ['admin_user_id', 'code_hash', 'id', 'used_at'],
        'admin_recovery_codes:UPDATE' => ['used_at'],
        'admin_sessions:SELECT' => ['admin_user_id', 'created_at', 'ended_at', 'expires_at', 'id', 'ip', 'last_seen_at', 'user_agent'],
        'admin_sessions:INSERT' => ['admin_user_id', 'created_at', 'ended_at', 'expires_at', 'id', 'ip', 'last_seen_at', 'user_agent'],
        'admin_sessions:UPDATE' => ['ended_at', 'last_seen_at'],
        'admin_log:SELECT' => ['action', 'admin_user_id', 'at', 'detail', 'id', 'ip', 'org_id', 'reason', 'seq', 'succeeded', 'target_id', 'user_agent'],
        'admin_log:INSERT' => ['action', 'admin_user_id', 'at', 'detail', 'id', 'ip', 'org_id', 'reason', 'seq', 'succeeded', 'target_id', 'user_agent'],
    ];
    $actual = [];
    foreach ($this->asOwner()->select("SELECT table_name,privilege_type,column_name FROM information_schema.role_column_grants WHERE grantee='clintra_admin_auth' ORDER BY table_name,privilege_type,column_name") as $row) {
        $actual[$row->table_name.':'.$row->privilege_type][] = $row->column_name;
    }
    ksort($expected);
    ksort($actual);
    expect($actual)->toBe($expected);
    $tableGrants = $this->asOwner()->select("SELECT table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee='clintra_admin_auth' ORDER BY 1,2");
    expect(array_map(fn ($r) => $r->table_name.':'.$r->privilege_type, $tableGrants))->toBe([
        'admin_log:INSERT', 'admin_log:SELECT', 'admin_recovery_codes:SELECT', 'admin_sessions:INSERT', 'admin_sessions:SELECT', 'admin_users:SELECT',
    ]);
    foreach (['clintra_admin_app', 'clintra_admin_provision', 'clintra_admin_mint', 'clintra_admin_device', 'clintra_admin_org', 'clintra_admin_stats', 'clintra_admin_support', 'clintra_support'] as $role) {
        expect($this->asOwner()->select('SELECT 1 FROM information_schema.role_column_grants WHERE grantee=?', [$role]))->toBe([]);
        expect($this->asOwner()->select('SELECT 1 FROM information_schema.role_table_grants WHERE grantee=?', [$role]))->toBe([]);
    }
});
