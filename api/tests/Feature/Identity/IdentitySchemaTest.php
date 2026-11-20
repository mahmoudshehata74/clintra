<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * Identity A1's schema (2026_09_12_000042 to 000047): every column, check,
 * index and RLS flag, who can touch the new tables, and who owns and may
 * call each function.
 */
function columnType(string $table, string $column): ?object
{
    return test()->asOwner()->selectOne(
        'SELECT data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = \'public\' AND table_name = ? AND column_name = ?',
        [$table, $column],
    );
}

test('the new columns, checks and indexes are in place', function () {
    $username = columnType('memberships', 'username');
    expect([$username->data_type, $username->character_maximum_length, $username->is_nullable])->toBe(['character varying', 32, 'YES']);
    $permissions = columnType('memberships', 'permissions');
    expect([$permissions->data_type, $permissions->is_nullable, $permissions->column_default])->toBe(['ARRAY', 'NO', "'{}'::text[]"]);
    expect(columnType('device', 'public_key')->data_type)->toBe('jsonb');
    expect(columnType('device', 'public_key_bound_at')->data_type)->toBe('timestamp with time zone');
    expect(columnType('organizations', 'identity_enforced_at')->is_nullable)->toBe('YES');
    foreach (['sync_ledger', 'device_audit_log'] as $table) {
        expect(columnType($table, 'credential_id')->data_type)->toBe('uuid');
        expect(columnType($table, 'proof')->data_type)->toBe('text');
    }
    expect(columnType('activation_codes', 'purpose')->column_default)->toBe("'device'::text");

    $index = $this->asOwner()->selectOne("SELECT indexdef FROM pg_indexes WHERE indexname = 'memberships_org_username_unique'")->indexdef;
    expect($index)->toBe('CREATE UNIQUE INDEX memberships_org_username_unique ON public.memberships USING btree (org_id, lower((username)::text)) WHERE (username IS NOT NULL)');
    expect($this->asOwner()->selectOne("SELECT indexdef FROM pg_indexes WHERE indexname = 'member_credentials_one_live'")->indexdef)
        ->toBe('CREATE UNIQUE INDEX member_credentials_one_live ON public.member_credentials USING btree (membership_id, device_id) WHERE (revoked_at IS NULL)');
});

test('usernames are stored lowercase from a-z 0-9 . _ -, 3 to 32, and permissions only from the catalogue', function () {
    $orgId = $this->makeOrganization();
    $insert = fn (array $values) => $this->makeMembership($this->makeUser(), $orgId, $values);

    $insert(['username' => 'mona.ahmed_1-x']);
    foreach (['Mona', 'ab', 'mona ahmed', 'منى'] as $bad) {
        expect(fn () => $insert(['username' => $bad]))->toThrow(QueryException::class, 'memberships_username_format');
    }
    expect(fn () => $insert(['username' => str_repeat('a', 33)]))->toThrow(QueryException::class, 'value too long');
    expect(fn () => $insert(['permissions' => '{reports.view,root}']))->toThrow(QueryException::class, 'memberships_permissions_catalogue');
    $insert(['permissions' => '{reports.view,services.manage,invoices.edit_items,invoices.void,cash.close,staff.manage,schedules.manage,clinical.view,patients.archive,messages.send}']);
});

test('the activation code purposes and the credential checks are enforced by the schema', function () {
    $orgId = $this->makeOrganization();
    $locationId = $this->makeLocation($orgId);

    expect(fn () => $this->makeActivationCode($orgId, $locationId, 'x', ['purpose' => 'admin']))->toThrow(QueryException::class, 'activation_codes_purpose_check');

    $memberId = $this->makeMembership($this->makeUser(), $orgId, ['role' => 'owner']);
    $deviceId = $this->makeDevice($orgId, $locationId, $memberId);
    $credential = fn (array $values) => $this->fx()->table('member_credentials')->insert(array_merge([
        'id' => (string) Str::uuid(), 'org_id' => $orgId, 'membership_id' => $memberId, 'device_id' => $deviceId,
        'public_key' => '{}', 'created_at' => now()->toIso8601String(),
    ], $values));

    expect(fn () => $credential(['revoked_at' => now()->toIso8601String()]))->toThrow(QueryException::class, 'check');
    expect(fn () => $credential(['algorithm' => 'RS256']))->toThrow(QueryException::class, 'check');
    expect(fn () => $credential(['revoke_reason' => 'bored', 'revoked_at' => now()->toIso8601String()]))->toThrow(QueryException::class, 'check');
    $credential([]);
    expect(fn () => $credential([]))->toThrow(QueryException::class, 'member_credentials_one_live');
});

test('the new tables are RLS-forced; clintra_app has nothing on passwords and attempts, and only SELECT on credentials', function () {
    $tables = $this->asOwner()->select(
        "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relname IN ('member_passwords', 'member_credentials', 'login_attempts') ORDER BY relname"
    );
    expect(collect($tables)->map(fn ($t) => [$t->relname, $t->relrowsecurity, $t->relforcerowsecurity])->all())->toBe([
        ['login_attempts', true, true], ['member_credentials', true, true], ['member_passwords', true, true],
    ]);

    $policies = $this->asOwner()->select(
        "SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE tablename IN ('member_passwords', 'member_credentials', 'login_attempts')"
    );
    expect(collect($policies)->map(fn ($p) => [$p->tablename, $p->policyname, $p->cmd, $p->qual])->all())
        ->toBe([['member_credentials', 'member_credentials_select', 'SELECT', '(org_id = current_org())']]);

    foreach (['member_passwords' => [], 'login_attempts' => [], 'member_credentials' => ['SELECT']] as $table => $expected) {
        $privileges = collect(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
            ->filter(fn ($p) => $this->asOwner()->selectOne('SELECT has_table_privilege(?, ?, ?) AS ok', ['clintra_app', $table, $p])->ok)
            ->values()->all();
        expect($privileges)->toBe($expected, $table);
        expect($this->asOwner()->selectOne('SELECT has_any_column_privilege(?, ?, ?) AS ok', ['clintra_app', $table, 'UPDATE'])->ok)->toBeFalse();
    }
});

test('each auth function is clintra_auth\'s, SECURITY DEFINER with a pinned search_path, and callable by clintra_app only', function () {
    $functions = [
        'auth_login_begin', 'auth_login_complete', 'auth_attempt_succeeded', 'auth_set_password',
        'auth_reset_member_password', 'auth_revoke_credential', 'auth_recover_owner', 'auth_set_username',
        'auth_consume_staff_step_up',
    ];

    foreach ($functions as $function) {
        $row = $this->asOwner()->selectOne(
            'SELECT r.rolname AS owner, p.prosecdef AS definer, p.proconfig AS config FROM pg_proc p
             JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = ?', [$function]
        );
        expect([$row->owner, $row->definer, $row->config])->toBe(['clintra_auth', true, '{"search_path=public, pg_temp"}'], $function);

        $callers = collect($this->asOwner()->select(
            "SELECT grantee FROM information_schema.role_routine_grants WHERE routine_name = ? AND privilege_type = 'EXECUTE' ORDER BY grantee",
            [$function],
        ))->pluck('grantee')->all();
        expect($callers)->toBe(['clintra_app', 'clintra_auth'], $function);
    }

    $guard = $this->asOwner()->selectOne(
        "SELECT r.rolname AS owner, p.prosecdef AS definer FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'membership_permission_guard'"
    );
    expect([$guard->owner, $guard->definer])->toBe(['clintra_auth', true]);
    expect($this->asOwner()->selectOne(
        "SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'memberships_permission_guard'"
    )->def)->toBe('CREATE TRIGGER memberships_permission_guard BEFORE INSERT OR UPDATE OF permissions, role ON public.memberships FOR EACH ROW EXECUTE FUNCTION membership_permission_guard()');
});

test('clintra_app cannot read a password hash or an attempt, with any membership', function () {
    $orgId = $this->makeOrganization();
    $memberId = $this->makeMembership($this->makeUser(), $orgId, ['role' => 'owner']);

    foreach (['member_passwords', 'login_attempts'] as $table) {
        expect(fn () => $this->withMembership($this->asApp(), $memberId, fn ($db) => $db->table($table)->count()))
            ->toThrow(QueryException::class, 'permission denied');
    }
});
