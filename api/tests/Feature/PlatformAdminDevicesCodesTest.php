<?php

use App\Support\ActivationCode;
use App\Support\Sync\CodeNotices;
use App\Models\Device;
use Illuminate\Support\Facades\DB;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(fn () => $this->endPlatformFixtures());

function b5Call(string $name, array $args): array
{
    $signatures = [
        'admin_org_devices' => 'uuid,uuid', 'admin_org_approvals' => 'uuid,uuid',
        'admin_revoke_device' => 'uuid,text,uuid,uuid',
        'admin_request_code' => 'uuid,text,jsonb,uuid',
        'admin_approve_code' => 'uuid,text,uuid,text,uuid',
    ];
    if ($name === 'admin_request_code') $args[2] = json_encode($args[2], JSON_THROW_ON_ERROR);
    $types = explode(',', $signatures[$name]);
    $casts = implode(',', array_map(fn ($type) => '?::'.$type, $types));
    return json_decode(test()->panel()->selectOne('SELECT platform.'.$name.'('.$casts.') AS result', $args)->result, true, flags: JSON_THROW_ON_ERROR);
}

function b5Fixture(): array
{
    $org = test()->makeOrganization('B5 clinic');
    test()->cleanupFirst(function () use ($org) {
        test()->asOwner()->table('platform.admin_approvals')->where('org_id', $org)->delete();
        test()->fx()->table('audit_log')->where('org_id', $org)->whereIn('entity', ['activation_codes', 'device'])->delete();
        test()->fx()->table('activation_codes')->where('org_id', $org)->delete();
    });
    $location = test()->makeLocation($org, 'B5 location');
    $owner = test()->makeMembership(test()->makeUser(), $org, ['role' => 'owner']);
    return [$org, $location, $owner];
}

function b5RequestPayload(string $org, string $location, ?string $hash = null, string $purpose = 'device'): array
{
    $payload = ['approval_id' => test()->platformId(), 'org_id' => $org,
        'location_id' => $location, 'purpose' => $purpose];
    if ($hash !== null) $payload['code_hash'] = $hash;
    return $payload;
}

function b5Log(string $id): object
{
    return test()->asOwner()->table('platform.admin_log')->where('id', $id)->sole();
}

test('one active admin mints immediately while plaintext stays out of tables and logs', function () {
    [$org, $location] = b5Fixture();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.81', 'user_agent' => 'B5 mint']);
    $others = $this->asOwner()->table('platform.admin_users')->where('is_active', true)->where('id', '<>', $admin['id'])->pluck('id')->all();
    $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => false]);
    $this->cleanupFirst(fn () => $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => true]));
    expect($this->asOwner()->table('platform.admin_users')->where('is_active', true)->count())->toBe(1);
    $plain = ActivationCode::generate();
    $hash = hash('sha256', $plain);
    $payload = b5RequestPayload($org, $location, $hash);
    $log = $this->platformId();
    expect(b5Call('admin_request_code', [$session, $this->platformOtp($admin['secret']), $payload, $log]))
        ->toBe(['ok' => true, 'pending' => false]);
    $row = b5Log($log);
    expect($row->action)->toBe('code.mint_request')->and($row->org_id)->toBe($org)
        ->and($row->ip)->toBe('192.0.2.81')->and($row->user_agent)->toBe('B5 mint')
        ->and(json_decode($row->detail, true)['single_admin'])->toBeTrue();
    expect($this->asOwner()->table('platform.admin_approvals')->where('id', $payload['approval_id'])->sole()->approved_by)->toBeNull();
    expect($this->asOwner()->table('platform.admin_approvals')->where('id', $payload['approval_id'])->sole()->approved_at)->not->toBeNull();
    expect($this->fx()->table('activation_codes')->where('code_hash', $hash)->count())->toBe(1);
    expect($this->asOwner()->table('platform.admin_log')->where('detail', 'like', '%'.$plain.'%')->count())->toBe(0);
    expect($this->asOwner()->table('platform.admin_approvals')->where('id', $payload['approval_id'])->first()->purpose)->toBe('device');
    expect(json_encode($this->asOwner()->table('platform.admin_approvals')->where('id', $payload['approval_id'])->first()))->not->toContain($plain);
});

test('request enforces the hash rule for the current active admin count', function (bool $singleAdmin) {
    [$org, $location] = b5Fixture();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.88', 'user_agent' => 'B5 count rule']);
    if ($singleAdmin) {
        $others = $this->asOwner()->table('platform.admin_users')->where('is_active', true)->where('id', '<>', $admin['id'])->pluck('id')->all();
        $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => false]);
        $this->cleanupFirst(fn () => $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => true]));
    } else {
        $this->platformAdmin();
    }
    $payload = b5RequestPayload($org, $location, $singleAdmin ? null : hash('sha256', ActivationCode::generate()));
    $before = $this->asOwner()->table('platform.admin_log')->max('seq');
    $log = $this->platformId();
    expect(b5Call('admin_request_code', [$session, $this->platformOtp($admin['secret']), $payload, $log]))
        ->toBe(['ok' => false, 'reason' => 'invalid_payload']);
    expect(b5Log($log)->ip)->toBe('192.0.2.88');
    expect(b5Log($log)->user_agent)->toBe('B5 count rule');
    expect($this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->count())->toBe(1);
    expect($this->asOwner()->table('platform.admin_approvals')->where('id', $payload['approval_id'])->count())->toBe(0);
})->with([true, false]);

test('two active admins require another admin and log self approval and expiry refusals', function () {
    [$org, $location] = b5Fixture();
    $requester = $this->platformAdmin();
    $approver = $this->platformAdmin();
    $requestSession = $this->platformSession($requester, ['ip' => '192.0.2.82', 'user_agent' => 'B5 request']);
    $approveSession = $this->platformSession($approver, ['ip' => '192.0.2.83', 'user_agent' => 'B5 approve']);
    $payload = b5RequestPayload($org, $location);
    expect(b5Call('admin_request_code', [$requestSession, $this->platformOtp($requester['secret']), $payload, $this->platformId()])['pending'])->toBeTrue();
    expect($this->fx()->table('activation_codes')->where('org_id', $org)->count())->toBe(0);
    $plain = ActivationCode::generate();
    $hash = hash('sha256', $plain);
    $same = $this->platformId();
    expect(b5Call('admin_approve_code', [$requestSession, $this->platformOtp($requester['secret'], $this->platformStep() + 1), $payload['approval_id'], $hash, $same]))
        ->toBe(['ok' => false, 'reason' => 'same_admin']);
    expect(b5Log($same)->ip)->toBe('192.0.2.82');
    expect(b5Call('admin_approve_code', [$approveSession, $this->platformOtp($approver['secret']), $payload['approval_id'], $hash, $this->platformId()]))
        ->toBe(['ok' => true]);
    expect($this->fx()->table('activation_codes')->where('code_hash', $hash)->count())->toBe(1);
    $again = $this->platformId();
    expect(b5Call('admin_approve_code', [$approveSession, $this->platformOtp($approver['secret'], $this->platformStep() + 1), $payload['approval_id'], $hash, $again]))
        ->toBe(['ok' => false, 'reason' => 'unchanged']);
    $expiredPayload = b5RequestPayload($org, $location);
    $this->asOwner()->insert("INSERT INTO platform.admin_approvals(id,action,org_id,location_id,purpose,requested_by,requested_at,expires_at) VALUES (?::uuid,'code.mint',?::uuid,?::uuid,'device',?::uuid,now()-interval '2 hours',now()-interval '1 hour')",
        [$expiredPayload['approval_id'], $org, $location, $requester['id']]);
    $expired = $this->platformId();
    $this->asOwner()->table('platform.admin_users')->where('id', $approver['id'])->update(['last_totp_step' => null]);
    expect(b5Call('admin_approve_code', [$approveSession, $this->platformOtp($approver['secret']), $expiredPayload['approval_id'], $hash, $expired]))
        ->toBe(['ok' => false, 'reason' => 'expired']);
    expect(b5Log($expired)->reason)->toBe('expired');
});

test('request refuses another clinic location and unknown clinic with scoped logs', function () {
    [$org, $location] = b5Fixture();
    [$other] = b5Fixture();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.84', 'user_agent' => 'B5 refusal']);
    $payload = b5RequestPayload($other, $location, hash('sha256', 'plain'));
    $log = $this->platformId();
    expect(b5Call('admin_request_code', [$session, $this->platformOtp($admin['secret']), $payload, $log]))
        ->toBe(['ok' => false, 'reason' => 'location_mismatch']);
    expect(b5Log($log)->org_id)->toBe($other);
    $unknown = $this->platformId();
    $log = $this->platformId();
    $payload = b5RequestPayload($unknown, $location, hash('sha256', 'plain'));
    expect(b5Call('admin_request_code', [$session, $this->platformOtp($admin['secret'], $this->platformStep() + 1), $payload, $log]))
        ->toBe(['ok' => false, 'reason' => 'not_found']);
    expect(b5Log($log)->org_id)->toBeNull()->and(b5Log($log)->target_id)->toBe($unknown);
});

test('request returns and logs each target or payload refusal with session context', function (string $case, string $reason) {
    [$org, $location, $owner] = b5Fixture();
    $admin = $this->platformAdmin();
    $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.85', 'user_agent' => 'B5 request refusal']);
    $payload = b5RequestPayload($org, $location);
    if ($case === 'invalid_payload') $payload['purpose'] = 'invalid';
    if ($case === 'not_found') $payload['org_id'] = $this->platformId();
    if ($case === 'org_disabled') $this->fx()->table('organizations')->where('id', $org)->update(['disabled_at' => now()->toIso8601String(), 'disabled_reason' => 'test']);
    if ($case === 'location_mismatch') $payload['location_id'] = b5Fixture()[1];
    if ($case === 'no_owner') $this->fx()->table('memberships')->where('id', $owner)->update(['is_active' => false]);
    $before = $this->asOwner()->table('platform.admin_log')->max('seq');
    $log = $this->platformId();
    expect(b5Call('admin_request_code', [$session, $this->platformOtp($admin['secret']), $payload, $log]))
        ->toBe(['ok' => false, 'reason' => $reason]);
    $row = b5Log($log);
    expect($row->reason)->toBe($reason)->and($row->ip)->toBe('192.0.2.85')
        ->and($row->user_agent)->toBe('B5 request refusal')->and($row->org_id)->toBe($case === 'not_found' || $case === 'invalid_payload' ? null : $org);
    expect($this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->count())->toBe(1);
    expect($this->asOwner()->table('platform.admin_approvals')->where('id', $payload['approval_id'])->count())->toBe(0);
})->with([
    ['invalid_payload', 'invalid_payload'], ['not_found', 'not_found'], ['org_disabled', 'org_disabled'],
    ['location_mismatch', 'location_mismatch'], ['no_owner', 'no_owner'],
]);

test('approval returns and logs every refusal without minting', function (string $case, string $reason) {
    [$org, $location, $owner] = b5Fixture();
    $requester = $this->platformAdmin();
    $approver = $this->platformAdmin();
    $actor = $case === 'same_admin' ? $requester : $approver;
    $session = $this->platformSession($actor, ['ip' => '192.0.2.86', 'user_agent' => 'B5 approval refusal']);
    $approval = $this->platformId();
    if ($case === 'location_mismatch') $location = b5Fixture()[1];
    if ($case !== 'not_found') {
        $this->asOwner()->insert("INSERT INTO platform.admin_approvals(id,action,org_id,location_id,purpose,requested_by,expires_at,approved_at) VALUES (?::uuid,'code.mint',?::uuid,?::uuid,'device',?::uuid,?::timestamptz,?::timestamptz)",
            [$approval, $org, $location, $requester['id'], $case === 'expired' ? now()->toIso8601String() : now()->addHour()->toIso8601String(),
                $case === 'unchanged' ? now()->toIso8601String() : null]);
    }
    if ($case === 'org_disabled') $this->fx()->table('organizations')->where('id', $org)->update(['disabled_at' => now()->toIso8601String(), 'disabled_reason' => 'test']);
    if ($case === 'no_owner') $this->fx()->table('memberships')->where('id', $owner)->update(['is_active' => false]);
    if ($case === 'approval_unavailable') {
        $others = $this->asOwner()->table('platform.admin_users')->where('is_active', true)->where('id', '<>', $approver['id'])->pluck('id')->all();
        $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => false]);
        $this->cleanupFirst(fn () => $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => true]));
    }
    $hash = $case === 'invalid_payload' ? 'bad' : hash('sha256', ActivationCode::generate());
    $before = $this->asOwner()->table('platform.admin_log')->max('seq');
    $log = $this->platformId();
    expect(b5Call('admin_approve_code', [$session, $this->platformOtp($actor['secret']), $approval, $hash, $log]))
        ->toBe(['ok' => false, 'reason' => $reason]);
    $row = b5Log($log);
    expect($row->reason)->toBe($reason)->and($row->ip)->toBe('192.0.2.86')
        ->and($row->user_agent)->toBe('B5 approval refusal')->and($row->org_id)->toBe($case === 'not_found' || $case === 'invalid_payload' ? null : $org);
    expect($this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->count())->toBe(1);
    expect($this->fx()->table('activation_codes')->where('code_hash', $hash)->count())->toBe(0);
})->with([
    ['invalid_payload', 'invalid_payload'], ['not_found', 'not_found'], ['expired', 'expired'],
    ['unchanged', 'unchanged'], ['same_admin', 'same_admin'], ['org_disabled', 'org_disabled'],
    ['location_mismatch', 'location_mismatch'], ['no_owner', 'no_owner'], ['approval_unavailable', 'approval_unavailable'],
]);

test('failed step ups across revoke request and approval share the five in fifteen budget', function () {
    [$org, $location, $owner] = b5Fixture();
    $device = $this->makeDevice($org, $location, $owner);
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.87', 'user_agent' => 'B5 budget']);
    $payload = b5RequestPayload($org, $location);
    $calls = [
        ['admin_revoke_device', [$session, 'bad', $device]],
        ['admin_request_code', [$session, 'bad', $payload]],
        ['admin_approve_code', [$session, 'bad', $this->platformId(), hash('sha256', ActivationCode::generate())]],
        ['admin_revoke_device', [$session, 'bad', $device]],
        ['admin_request_code', [$session, 'bad', $payload]],
    ];
    foreach ($calls as $index => [$name, $args]) {
        $log = $this->platformId();
        $result = b5Call($name, [...$args, $log]);
        expect($result['reason'])->toBe('step_up_failed');
        expect($result['all_sessions_ended'] ?? false)->toBe($index === 4);
        expect(b5Log($log)->ip)->toBe('192.0.2.87');
    }
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $session)->value('ended_at'))->not->toBeNull();
    expect(b5Call('admin_revoke_device', [$session, $this->platformOtp($admin['secret']), $device, $this->platformId()]))
        ->toBe(['ok' => false, 'reason' => 'session_invalid']);
});

test('devices reader lists only the requested clinic and revoke returns unchanged on repetition', function () {
    [$org, $location, $owner] = b5Fixture();
    [$other, $otherLocation, $otherOwner] = b5Fixture();
    $device = $this->makeDevice($org, $location, $owner);
    $this->makeDevice($other, $otherLocation, $otherOwner);
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $rows = b5Call('admin_org_devices', [$session, $org])['devices'];
    expect($rows)->toHaveCount(1)->and($rows[0]['id'])->toBe($device)->and(array_keys($rows[0]))->not->toContain('membership_id');
    expect(b5Call('admin_revoke_device', [$session, $this->platformOtp($admin['secret']), $device, $this->platformId()]))->toBe(['ok' => true]);
    expect($this->fx()->table('device')->where('id', $device)->value('revoked_at'))->not->toBeNull();
    expect(b5Call('admin_revoke_device', [$session, $this->platformOtp($admin['secret'], $this->platformStep() + 1), $device, $this->platformId()]))
        ->toBe(['ok' => false, 'reason' => 'unchanged']);
});

test('device actions log unknown targets and missing owner without raising', function () {
    [$org, $location, $owner] = b5Fixture();
    $device = $this->makeDevice($org, $location, $owner);
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.89', 'user_agent' => 'B5 device refusal']);
    $unknown = $this->platformId();
    $before = $this->asOwner()->table('platform.admin_log')->max('seq');
    expect(b5Call('admin_org_devices', [$session, $unknown]))->toBe(['ok' => false, 'reason' => 'not_found']);
    $row = $this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->sole();
    expect($row->org_id)->toBeNull()->and($row->target_id)->toBe($unknown)
        ->and($row->ip)->toBe('192.0.2.89')->and($row->user_agent)->toBe('B5 device refusal');
    $log = $this->platformId();
    expect(b5Call('admin_revoke_device', [$session, $this->platformOtp($admin['secret']), $unknown, $log]))
        ->toBe(['ok' => false, 'reason' => 'not_found']);
    expect(b5Log($log)->org_id)->toBeNull();
    $this->fx()->table('memberships')->where('id', $owner)->update(['is_active' => false]);
    $log = $this->platformId();
    expect(b5Call('admin_revoke_device', [$session, $this->platformOtp($admin['secret'], $this->platformStep() + 1), $device, $log]))
        ->toBe(['ok' => false, 'reason' => 'no_owner']);
    expect(b5Log($log)->org_id)->toBe($org);
    expect($this->fx()->table('device')->where('id', $device)->value('revoked_at'))->toBeNull();
});

test('panel revoke waits for a running push and makes the next device request 401', function () {
    [$org, $location, $owner] = b5Fixture();
    $deviceId = $this->makeDevice($org, $location, $owner);
    $token = (new Device(['id' => $deviceId]))->createToken('b5-device', ['membership:'.$owner])->plainTextToken;
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $log = $this->platformId();
    $db = $this->fx();
    $db->beginTransaction();
    $process = null;
    try {
        $db->select("SELECT pg_advisory_xact_lock(hashtextextended('sync_seq:' || ?::text,0))", [$org]);
        $code = <<<'PHP'
            require 'vendor/autoload.php';
            $app = require 'bootstrap/app.php';
            $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
            $config = config('database.connections.pgsql_owner');
            $config['url'] = null;
            $config['username'] = 'clintra_admin_app';
            $config['password'] = env('DB_ADMIN_APP_PASSWORD');
            $config['search_path'] = 'platform';
            config(['database.connections.platform_panel' => $config]);
            $row = Illuminate\Support\Facades\DB::connection('platform_panel')->selectOne(
                'SELECT platform.admin_revoke_device(?::uuid,?::text,?::uuid,?::uuid) AS result',
                array_slice($argv, 1)
            );
            echo $row->result;
        PHP;
        $process = proc_open([PHP_BINARY, '-r', $code, $session, $this->platformOtp($admin['secret']), $deviceId, $log],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), array_merge(getenv(), ['DB_DATABASE' => 'clintra_test']));
        expect($process)->not->toBeFalse();
        fclose($pipes[0]);
        $deadline = microtime(true) + 10;
        do {
            $waiting = $db->selectOne("SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted")->n > 0;
            if ($waiting) break;
            usleep(10_000);
        } while (microtime(true) < $deadline && proc_get_status($process)['running']);
        expect($waiting)->toBeTrue('Revoke must wait for the organization sync lock');
        expect($db->table('device')->where('id', $deviceId)->value('revoked_at'))->toBeNull();
        $db->commit();
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        expect(proc_close($process))->toBe(0, $errors.$output);
        $process = null;
        expect(json_decode($output, true, flags: JSON_THROW_ON_ERROR))->toBe(['ok' => true]);
        expect($this->fx()->table('device')->where('id', $deviceId)->value('revoked_at'))->not->toBeNull();
        expect($this->fx()->table('personal_access_tokens')->where('tokenable_id', $deviceId)->count())->toBe(0);
        $this->withToken($token)->getJson('/api/isolation-probe')->assertStatus(401);
    } finally {
        if ($db->transactionLevel()) $db->rollBack();
        if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    }
});

test('approval reader returns scoped pending requests and active admin count', function () {
    [$org, $location] = b5Fixture();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    expect(b5Call('admin_org_approvals', [$session, $org]))->toMatchArray(['ok' => true, 'approvals' => []]);
});

test('a panel mint notice reaches only its clinic and drops out after seven days', function () {
    [$org, $location, $owner] = b5Fixture();
    [$foreign, , $foreignOwner] = b5Fixture();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $others = $this->asOwner()->table('platform.admin_users')->where('is_active', true)->where('id', '<>', $admin['id'])->pluck('id')->all();
    $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => false]);
    $this->cleanupFirst(fn () => $this->asOwner()->table('platform.admin_users')->whereIn('id', $others)->update(['is_active' => true]));
    $payload = b5RequestPayload($org, $location, hash('sha256', ActivationCode::generate()));
    expect(b5Call('admin_request_code', [$session, $this->platformOtp($admin['secret']), $payload, $this->platformId()])['ok'])->toBeTrue();
    $own = $this->withMembership($this->asApp(), $owner, fn () => CodeNotices::current());
    expect($own)->toHaveCount(1)->and($own[0]['purpose'])->toBe('device');
    expect($this->withMembership($this->asApp(), $foreignOwner, fn () => CodeNotices::current()))->toBe([]);
    $this->asPlatformRole('clintra_admin_mint', fn ($db) => $db->insert("INSERT INTO admin_code_notices(id,org_id,purpose,issued_at) VALUES (?::uuid,?::uuid,'owner_recovery',now()-interval '7 days' - interval '1 second')", [$this->platformId(), $org]));
    expect($this->withMembership($this->asApp(), $owner, fn () => CodeNotices::current()))->toHaveCount(1);
});

test('B5 functions and grants are limited to their declared owners callers and columns', function () {
    $functions = [
        'admin_active_count()' => ['clintra_admin_auth', ['clintra_admin_auth', 'clintra_admin_mint']],
        'admin_org_devices(uuid,uuid)' => ['clintra_admin_device', ['clintra_admin_app', 'clintra_admin_device']],
        'admin_revoke_device(uuid,text,uuid,uuid)' => ['clintra_admin_device', ['clintra_admin_app', 'clintra_admin_device']],
        'admin_org_approvals(uuid,uuid)' => ['clintra_admin_mint', ['clintra_admin_app', 'clintra_admin_mint']],
        'admin_request_code(uuid,text,jsonb,uuid)' => ['clintra_admin_mint', ['clintra_admin_app', 'clintra_admin_mint']],
        'admin_approve_code(uuid,text,uuid,text,uuid)' => ['clintra_admin_mint', ['clintra_admin_app', 'clintra_admin_mint']],
    ];
    foreach ($functions as $signature => [$owner, $callers]) {
        $row = $this->asOwner()->selectOne("SELECT p.oid,r.rolname AS owner,p.prosecdef,p.proconfig::text AS config FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=?::regprocedure", ['platform.'.$signature]);
        expect($row->owner)->toBe($owner)->and($row->prosecdef)->toBeTrue()
            ->and($row->config)->toBe('{"search_path=public, platform, pg_temp"}');
        $actual = array_column($this->asOwner()->select("SELECT r.rolname FROM pg_proc p,LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=? AND a.privilege_type='EXECUTE' ORDER BY r.rolname", [$row->oid]), 'rolname');
        expect($actual)->toBe($callers);
    }
    expect($this->asOwner()->selectOne("SELECT has_function_privilege('clintra_admin_app','platform.admin_active_count()','EXECUTE') AS allowed")->allowed)->toBeFalse();
    expect($this->asOwner()->selectOne("SELECT has_table_privilege('clintra_admin_mint','platform.admin_users','SELECT') AS allowed")->allowed)->toBeFalse();
    $expected = [
        'clintra_admin_mint' => [
            'organizations' => ['id', 'disabled_at'], 'locations' => ['id', 'org_id'],
            'memberships' => ['org_id', 'role', 'is_active'],
        ],
        'clintra_admin_device' => [
            'organizations' => ['id'], 'locations' => ['id', 'org_id', 'name'],
            'memberships' => ['id', 'org_id', 'role', 'is_active'],
            'device' => ['id', 'org_id', 'location_id', 'series', 'registered_at', 'revoked_at'],
            'sync_ledger' => ['device_id', 'applied_at'],
            'personal_access_tokens' => ['tokenable_type', 'tokenable_id'],
        ],
    ];
    foreach ($expected as $role => $tables) {
        foreach ($this->asOwner()->select("SELECT table_name,column_name FROM information_schema.role_column_grants WHERE grantee=? AND table_schema='public' AND privilege_type='SELECT'", [$role]) as $grant) {
            expect($grant->column_name, $role.'.'.$grant->table_name)->toBeIn($tables[$grant->table_name] ?? []);
        }
        foreach ($tables as $table => $columns) {
            foreach ($columns as $column) {
                expect($this->asOwner()->selectOne('SELECT has_column_privilege(?, ?, ?, ?) AS allowed', [$role, $table, $column, 'SELECT'])->allowed)->toBeTrue();
            }
        }
    }
    foreach (['patients','users','visit_form_data','prescriptions','prescription_items','messages','message_templates','care_plans','care_plan_items','device_audit_log'] as $table) {
        foreach (['clintra_admin_mint','clintra_admin_device'] as $role) {
            expect($this->asOwner()->selectOne('SELECT has_any_column_privilege(?, ?, ?) AS allowed', [$role, $table, 'SELECT'])->allowed)->toBeFalse();
        }
    }
    foreach (['clintra_admin_mint','clintra_admin_device'] as $role) {
        expect($this->asOwner()->selectOne('SELECT has_table_privilege(?, ?, ?) AS allowed', [$role, 'audit_log', 'SELECT'])->allowed)->toBeFalse();
    }
});
