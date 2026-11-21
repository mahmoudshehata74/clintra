<?php

use App\Support\ActivationCode;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

function b2CliStatus(string $org, bool $disabled, ?string $reason = 'test suspension', ?string $log = null): array
{
    return json_decode(test()->asOwner()->selectOne(
        'SELECT platform.cli_set_org_disabled(?::uuid,?::boolean,?,?::uuid,?) AS result',
        [$org, $disabled ? 'true' : 'false', $reason, $log ?? (string) Str::uuid(), 'b2-test-host'],
    )->result, true);
}

function b2PanelStatus(string $session, string $org, ?bool $disabled, ?string $reason, string $otp, string $log): array
{
    return json_decode(test()->panel()->selectOne(
        'SELECT platform.admin_set_org_disabled(?::uuid,?,?::uuid,?::boolean,?,?::uuid) AS result',
        [$session, $otp, $org, $disabled === null ? null : ($disabled ? 'true' : 'false'), $reason, $log],
    )->result, true);
}

dataset('B2 device paths', [
    ['POST', '/api/sync/push'], ['GET', '/api/sync/pull'], ['GET', '/api/sync/bootstrap'],
    ['POST', '/api/audit/push'], ['GET', '/api/audit/pull'], ['POST', '/api/staff'],
    ['POST', '/api/auth/login'], ['POST', '/api/auth/password'], ['GET', '/api/auth/rollout'],
    ['POST', '/api/auth/rollout/enable'], ['GET', '/api/staff/credentials'],
    ['POST', '/api/staff/00000000-0000-0000-0000-000000000001/password-reset'],
    ['DELETE', '/api/staff/credentials/00000000-0000-0000-0000-000000000001'],
    ['POST', '/api/staff/00000000-0000-0000-0000-000000000001'],
    ['PUT', '/api/staff/00000000-0000-0000-0000-000000000001/username'],
]);

test('every token protected path refuses a disabled organization before validating its payload', function (string $method, string $path) {
    $org = IdentityHarness::org();
    b2CliStatus($org['orgId'], true);
    IdentityHarness::send($org, $method, $path)->assertStatus(403)->assertExactJson([
        'error' => 'org_disabled', 'message' => 'حساب العيادة موقوف. كلّم فريق كلينترا.',
    ]);
    $this->flushHeaders();
    $this->withToken('123456789|invalid-token')->json($method, $path)->assertUnauthorized()->assertExactJson([
        'error' => 'unauthenticated', 'message' => 'يجب تسجيل الدخول',
    ]);
})->with('B2 device paths');

test('disabling one organization retains its data and tokens and leaves another organization untouched', function () {
    $org = IdentityHarness::org();
    $other = IdentityHarness::org();
    $patient = $this->makePatient($org['orgId']);
    $foreignPatient = $this->makePatient($other['orgId']);
    b2CliStatus($org['orgId'], true);
    expect($this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->selectOne('SELECT current_org() AS id')->id))->toBeNull();
    expect($this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->table('patients')->count()))->toBe(0);
    expect($this->withMembership($this->asApp(), $other['ownerId'], fn ($db) => $db->table('patients')->pluck('id')->all()))->toBe([$foreignPatient]);
    IdentityHarness::send($other, 'GET', '/api/sync/pull')->assertOk();
    expect($this->fx()->table('patients')->where('id', $patient)->exists())->toBeTrue();
    expect($this->fx()->table('personal_access_tokens')->where('tokenable_id', $org['deviceId'])->exists())->toBeTrue();
    b2CliStatus($org['orgId'], false);
    IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk();
    expect($this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->table('patients')->pluck('id')->all()))->toBe([$patient]);
});

test('registration reveals disabled status only for valid credentials and never consumes the valid code', function (string $problem) {
    $org = IdentityHarness::org();
    $code = ActivationCode::generate();
    $codeId = $this->makeActivationCode($org['orgId'], $org['locationId'], $code);
    b2CliStatus($org['orgId'], true);
    $body = ['device_id' => (string) Str::uuid(), 'phone' => $org['ownerPhone'], 'activation_code' => $code];
    $this->cleanupFirst(function () use ($body) {
        $this->fx()->table('personal_access_tokens')->where('tokenable_id', $body['device_id'])->delete();
        $this->fx()->table('device')->where('id', $body['device_id'])->delete();
    });
    $this->postJson('/api/devices/register', $body)->assertStatus(403)->assertExactJson([
        'error' => 'org_disabled', 'message' => 'حساب العيادة موقوف. كلّم فريق كلينترا.',
    ]);
    $invalid = $body;
    if ($problem === 'phone') $invalid['phone'] = '+201099999999';
    if ($problem === 'code') $invalid['activation_code'] = ActivationCode::generate();
    if ($problem === 'expired') $this->fx()->table('activation_codes')->where('id', $codeId)->update(['expires_at' => now()->subMinute()->toIso8601String()]);
    if ($problem === 'used') $this->fx()->table('activation_codes')->where('id', $codeId)->update(['used_at' => now()->subMinute()->toIso8601String()]);
    if ($problem === 'purpose') $this->fx()->table('activation_codes')->where('id', $codeId)->update(['purpose' => 'owner_recovery']);
    $this->postJson('/api/devices/register', $invalid)->assertUnauthorized()->assertJsonPath('error', 'registration_failed');
    if ($problem !== 'used') expect($this->fx()->table('activation_codes')->where('id', $codeId)->value('used_at'))->toBeNull();
    $this->fx()->table('activation_codes')->where('id', $codeId)->update(['used_at' => null, 'expires_at' => now()->addHour()->toIso8601String(), 'purpose' => 'device']);
    b2CliStatus($org['orgId'], false);
    $this->postJson('/api/devices/register', $body)->assertOk();
})->with(['phone', 'code', 'expired', 'used', 'purpose']);

test('owner recovery follows its credential first rule and keeps codes and passwords unchanged', function (string $problem) {
    $org = IdentityHarness::org(true);
    $code = ActivationCode::generate();
    $codeId = $this->makeActivationCode($org['orgId'], $org['locationId'], $code);
    $this->fx()->table('activation_codes')->where('id', $codeId)->update(['purpose' => 'owner_recovery']);
    $hash = $this->fx()->table('member_passwords')->where('membership_id', $org['ownerId'])->value('password_hash');
    b2CliStatus($org['orgId'], true);
    $body = ['phone' => $org['ownerPhone'], 'code' => $code, 'username' => 'owner', 'password' => 'a new owner password'];
    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', $body)->assertStatus(403)->assertExactJson([
        'error' => 'org_disabled', 'message' => 'حساب العيادة موقوف. كلّم فريق كلينترا.',
    ]);
    if ($problem === 'phone') $body['phone'] = '+201099999999';
    if ($problem === 'code') $body['code'] = ActivationCode::generate();
    if ($problem === 'username') $body['username'] = 'someone.else';
    if ($problem === 'expired') $this->fx()->table('activation_codes')->where('id', $codeId)->update(['expires_at' => now()->subMinute()->toIso8601String()]);
    if ($problem === 'used') $this->fx()->table('activation_codes')->where('id', $codeId)->update(['used_at' => now()->subMinute()->toIso8601String()]);
    if ($problem === 'purpose') $this->fx()->table('activation_codes')->where('id', $codeId)->update(['purpose' => 'device']);
    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', $body)->assertUnauthorized()->assertExactJson([
        'error' => 'recovery_failed', 'message' => 'بيانات الاسترداد غير صحيحة.',
    ]);
    expect($this->fx()->table('member_passwords')->where('membership_id', $org['ownerId'])->value('password_hash'))->toBe($hash);
    if ($problem !== 'used') expect($this->fx()->table('activation_codes')->where('id', $codeId)->value('used_at'))->toBeNull();
})->with(['phone', 'code', 'username', 'expired', 'used', 'purpose']);

test('recovery rate limits still apply before a valid code can reveal a disabled organization', function () {
    $org = IdentityHarness::org();
    $code = ActivationCode::generate();
    $codeId = $this->makeActivationCode($org['orgId'], $org['locationId'], $code);
    $this->fx()->table('activation_codes')->where('id', $codeId)->update(['purpose' => 'owner_recovery']);
    b2CliStatus($org['orgId'], true);
    $body = ['phone' => '+201099999999', 'code' => $code, 'username' => 'owner', 'password' => 'a new owner password'];
    for ($i = 0; $i < 5; $i++) IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', $body)->assertUnauthorized();
    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', [...$body, 'phone' => $org['ownerPhone']])->assertStatus(429);
    expect($this->fx()->table('activation_codes')->where('id', $codeId)->value('used_at'))->toBeNull();
    $this->flushHeaders();
    $this->withToken('1|invalid')->postJson('/api/auth/owner-recovery', $body)->assertUnauthorized()->assertJsonPath('error', 'unauthenticated');
});

test('five step up refusals through the organization action commit their rows and end all admin sessions', function (bool $knownOrg) {
    $org = IdentityHarness::org();
    $target = $knownOrg ? $org['orgId'] : $this->platformId();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $second = $this->platformSession($admin);
    $other = $this->platformAdmin();
    $foreign = $this->platformSession($other);
    for ($i = 1; $i <= 5; $i++) {
        $logId = $this->platformId();
        expect(b2PanelStatus($session, $target, true, 'test', 'wrong-code', $logId))->toBe(['ok' => false, 'reason' => 'step_up_failed']);
        $log = $this->asOwner()->table('platform.admin_log')->where('id', $logId)->sole();
        expect($log->org_id)->toBe($knownOrg ? $target : null)->and($log->target_id)->toBe($target)->and($log->admin_user_id)->toBe($admin['id']);
        expect($log->succeeded)->toBeFalse()->and(json_decode($log->detail, true)['all_sessions_ended'])->toBe($i === 5);
        expect($this->asOwner()->table('platform.admin_sessions')->whereIn('id', [$session, $second])->whereNotNull('ended_at')->count())->toBe($i === 5 ? 2 : 0);
    }
    expect(b2PanelStatus($session, $target, true, 'test', $this->platformOtp($admin['secret']), $this->platformId()))->toBe(['ok' => false, 'reason' => 'session_invalid']);
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $foreign)->value('ended_at'))->toBeNull();
    expect(b2PanelStatus($foreign, $org['orgId'], true, 'test', $this->platformOtp($other['secret']), $this->platformId()))->toBe(['ok' => true]);
})->with([true, false]);

test('a valid step up for a guessed organization logs not found and consumes the code before lookup', function () {
    $org = IdentityHarness::org();
    $unknown = $this->platformId();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $logId = $this->platformId();
    $otp = $this->platformOtp($admin['secret']);
    expect(b2PanelStatus($session, $unknown, true, 'test', $otp, $logId))->toBe(['ok' => false, 'reason' => 'not_found']);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $logId)->sole();
    expect($log->org_id)->toBeNull()->and($log->target_id)->toBe($unknown)->and($log->reason)->toBe('not_found')->and($log->admin_user_id)->toBe($admin['id']);
    expect(b2PanelStatus($session, $org['orgId'], true, 'test', $otp, $this->platformId()))->toBe(['ok' => false, 'reason' => 'step_up_failed']);
});

test('the organization action logs success enable and each refusal exactly once', function (string $case) {
    $org = IdentityHarness::org();
    $admin = $this->platformAdmin(['must_change_password' => $case === 'password_change_required']);
    $session = $this->platformSession($admin);
    if (in_array($case, ['enable', 'unchanged'], true)) b2CliStatus($org['orgId'], true);
    $logId = $this->platformId();
    $before = $this->asOwner()->table('platform.admin_log')->count();
    $disabled = $case === 'null_disabled' ? null : $case !== 'enable';
    $reason = match ($case) { 'blank' => '  ', 'long' => str_repeat('x', 201), default => 'test' };
    $expected = match ($case) {
        'blank', 'long' => 'reason_required', 'null_disabled' => 'invalid_payload', 'unchanged' => 'unchanged',
        'password_change_required' => 'password_change_required', 'session_invalid' => 'session_invalid', default => null,
    };
    $result = b2PanelStatus($case === 'session_invalid' ? $this->platformId() : $session, $org['orgId'], $disabled, $reason, $this->platformOtp($admin['secret']), $logId);
    expect($result)->toBe($expected === null ? ['ok' => true] : ['ok' => false, 'reason' => $expected]);
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before + 1);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $logId)->sole();
    expect($log->org_id)->toBe($org['orgId'])->and($log->reason)->toBe($expected)->and($log->action)->toBe($disabled === false ? 'org.enable' : 'org.disable');
    expect($log->admin_user_id)->toBe($case === 'session_invalid' ? null : $admin['id']);
    if ($case === 'enable') {
        $row = $this->fx()->table('organizations')->where('id', $org['orgId'])->first(['disabled_at', 'disabled_reason']);
        expect($row->disabled_at)->toBeNull()->and($row->disabled_reason)->toBeNull();
    }
})->with(['disable', 'enable', 'unchanged', 'blank', 'long', 'null_disabled', 'password_change_required', 'session_invalid']);

test('CLI break glass logs successful and refused actions without attributing a clinic audit row', function () {
    $org = IdentityHarness::org();
    $beforeAudit = $this->fx()->table('audit_log')->where('org_id', $org['orgId'])->count();
    $this->artisan('clintra:organization-status', ['org_id' => $org['orgId'], 'status' => 'disabled', '--reason' => 'test'])->assertSuccessful();
    $this->artisan('clintra:organization-status', ['org_id' => $org['orgId'], 'status' => 'enabled'])->assertSuccessful();
    $rows = $this->asOwner()->table('platform.admin_log')->where('target_id', $org['orgId'])->orderBy('seq')->get();
    expect($rows)->toHaveCount(2);
    expect($rows->pluck('action')->all())->toBe(['cli.org_disable', 'cli.org_enable']);
    foreach ($rows as $row) {
        expect($row->admin_user_id)->toBeNull()->and($row->org_id)->toBe($org['orgId'])->and($row->succeeded)->toBeTrue();
        expect(json_decode($row->detail, true)['host_user'])->toBeString()->not->toBe('');
    }
    expect($this->fx()->table('audit_log')->where('org_id', $org['orgId'])->count())->toBe($beforeAudit);
    $unknown = $this->platformId();
    $logId = $this->platformId();
    expect(b2CliStatus($unknown, true, 'test', $logId))->toBe(['ok' => false, 'reason' => 'not_found']);
    $row = $this->asOwner()->table('platform.admin_log')->where('id', $logId)->sole();
    expect($row->org_id)->toBeNull()->and($row->admin_user_id)->toBeNull()->and($row->target_id)->toBe($unknown)->and($row->reason)->toBe('not_found');
    expect(json_decode($row->detail, true)['host_user'])->toBe('b2-test-host');
    $this->artisan('clintra:organization-status', ['org_id' => $unknown, 'status' => 'enabled'])->assertFailed();
    expect($this->asOwner()->table('platform.admin_log')->where('target_id', $unknown)->count())->toBe(2);
});

test('CLI refusal validation returns and persists its log rather than raising', function (?bool $disabled, ?string $reason, string $expected) {
    $org = IdentityHarness::org();
    $logId = $this->platformId();
    $result = json_decode($this->asOwner()->selectOne('SELECT platform.cli_set_org_disabled(?::uuid,?::boolean,?,?::uuid,?) AS result', [$org['orgId'], $disabled === null ? null : ($disabled ? 'true' : 'false'), $reason, $logId, 'operator'])->result, true);
    expect($result)->toBe(['ok' => false, 'reason' => $expected]);
    expect($this->asOwner()->table('platform.admin_log')->where('id', $logId)->sole()->reason)->toBe($expected);
})->with([[null, 'test', 'invalid_payload'], [true, '', 'reason_required'], [true, str_repeat('x', 201), 'reason_required']]);

test('break glass needs no clinic owner and accepts a two hundred character Arabic reason', function () {
    $org = $this->makeOrganization('b2-without-owner');
    $reason = str_repeat('س', 200);
    expect(b2CliStatus($org, true, $reason))->toBe(['ok' => true]);
    expect($this->fx()->table('organizations')->where('id', $org)->value('disabled_reason'))->toBe($reason);
    expect(b2CliStatus($org, false))->toBe(['ok' => true]);
    expect($this->fx()->table('organizations')->where('id', $org)->value('disabled_reason'))->toBeNull();
    expect($this->fx()->table('audit_log')->where('org_id', $org)->count())->toBe(0);
});

test('the disable shape enforces both null or both set and a reason length of one through two hundred', function (array $fields) {
    $org = IdentityHarness::org();
    expect(fn () => $this->fx()->table('organizations')->where('id', $org['orgId'])->update($fields))->toThrow(QueryException::class);
})->with([
    [['disabled_at' => '2026-11-21T10:00:00+00:00']], [['disabled_reason' => 'test']],
    [['disabled_at' => '2026-11-21T10:00:00+00:00', 'disabled_reason' => '']],
    [['disabled_at' => '2026-11-21T10:00:00+00:00', 'disabled_reason' => str_repeat('x', 201)]],
]);

test('B2 roles have exact column grants and only the intended function callers', function () {
    $columns = $this->asOwner()->select("SELECT privilege_type,column_name FROM information_schema.role_column_grants WHERE grantee='clintra_admin_org' ORDER BY table_name,privilege_type,column_name");
    expect(array_map(fn ($r) => $r->privilege_type.':'.$r->column_name, $columns))->toBe(['SELECT:disabled_at', 'SELECT:id', 'UPDATE:disabled_at', 'UPDATE:disabled_reason']);
    expect($this->asOwner()->select("SELECT 1 FROM information_schema.role_table_grants WHERE grantee='clintra_admin_org'"))->toBe([]);
    foreach ([
        ['platform.admin_set_org_disabled(uuid,text,uuid,boolean,text,uuid)', 'clintra_admin_org', ['clintra_admin_app', 'clintra_admin_org']],
        ['platform.cli_set_org_disabled(uuid,boolean,text,uuid,text)', 'clintra_admin_org', ['clintra_admin_org', 'clintra_owner']],
        ['device_org_disabled(uuid)', 'clintra_rls', ['clintra_app', 'clintra_rls']],
    ] as [$signature, $owner, $callers]) {
        $row = $this->asOwner()->selectOne('SELECT p.oid,r.rolname,p.prosecdef FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=?::regprocedure', [$signature]);
        expect($row->rolname)->toBe($owner)->and($row->prosecdef)->toBeTrue();
        $acl = $this->asOwner()->select("SELECT r.rolname FROM pg_proc p,LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=? ORDER BY r.rolname", [$row->oid]);
        expect(array_column($acl, 'rolname'))->toBe($callers);
    }
    expect(fn () => $this->asApp()->select('SELECT platform.admin_set_org_disabled(NULL,NULL,NULL,true,NULL,NULL)'))->toThrow(QueryException::class);
    expect(fn () => $this->panel()->select('SELECT platform.cli_set_org_disabled(NULL,true,NULL,NULL,NULL)'))->toThrow(QueryException::class);
});

/** Wait for the second transaction to reach the advisory lock, without a timing guess. */
function b2WaitForLock($process): void
{
    $deadline = microtime(true) + 10;
    do {
        if (test()->fx()->selectOne("SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted")->n > 0) return;
        usleep(10_000);
    } while (microtime(true) < $deadline && proc_get_status($process)['running']);
    test()->fail('The second transaction did not reach the organization sync lock');
}

test('disable waits for a running push to finish and commit', function () {
    $org = IdentityHarness::org();
    $db = $this->fx();
    $db->beginTransaction();
    $process = null;
    try {
        $db->select("SELECT pg_advisory_xact_lock(hashtextextended('sync_seq:' || ?::text,0))", [$org['orgId']]);
        $process = proc_open([PHP_BINARY, base_path('artisan'), 'clintra:organization-status', $org['orgId'], 'disabled', '--reason=test lock'],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), array_merge(getenv(), ['DB_DATABASE' => 'clintra_test']));
        expect($process)->not->toBeFalse();
        fclose($pipes[0]);
        b2WaitForLock($process);
        expect($db->table('organizations')->where('id', $org['orgId'])->value('disabled_at'))->toBeNull();
        $db->commit();
        $output = stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        expect(proc_close($process))->toBe(0, $output);
        $process = null;
        expect($this->fx()->table('organizations')->where('id', $org['orgId'])->value('disabled_at'))->not->toBeNull();
    } finally {
        if ($db->transactionLevel()) $db->rollBack();
        if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    }
});

test('a push waits for disable to commit then rechecks before any controller work', function (string $path) {
    $org = IdentityHarness::org();
    $db = $this->asOwner();
    $db->beginTransaction();
    $process = null;
    try {
        b2CliStatus($org['orgId'], true);
        $code = <<<'PHP'
            require 'vendor/autoload.php';
            $app = require 'bootstrap/app.php';
            $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
            $request = Illuminate\Http\Request::create($argv[2], 'POST', [], [], [], [
                'CONTENT_TYPE'=>'application/json', 'HTTP_ACCEPT'=>'application/json',
                'HTTP_AUTHORIZATION'=>'Bearer '.$argv[1],
            ], '{}');
            $response = $kernel->handle($request);
            echo $response->getStatusCode().' '.$response->getContent();
            $kernel->terminate($request,$response);
        PHP;
        $process = proc_open([PHP_BINARY, '-r', $code, $org['token'], $path],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), array_merge(getenv(), ['DB_DATABASE' => 'clintra_test']));
        expect($process)->not->toBeFalse();
        fclose($pipes[0]);
        b2WaitForLock($process);
        expect(proc_get_status($process)['running'])->toBeTrue();
        $db->commit();
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        expect(proc_close($process))->toBe(0, $errors.$output);
        $process = null;
        expect($output)->toStartWith('403 ')->toContain('org_disabled');
        expect($this->fx()->table('sync_ledger')->where('org_id', $org['orgId'])->count())->toBe(0);
    } finally {
        if ($db->transactionLevel()) $db->rollBack();
        if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    }
})->with(['/api/sync/push', '/api/audit/push', '/api/staff']);
