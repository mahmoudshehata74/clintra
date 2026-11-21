<?php

use Illuminate\Database\QueryException;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

test('TOTP matches RFC 6238 SHA1 vectors truncated to six digits', function (int $time, string $expected) {
    $row = $this->asOwner()->selectOne("SELECT platform.totp_at(decode(?,'hex'),?::bigint) AS otp", [bin2hex('12345678901234567890'), intdiv($time, 30)]);
    expect($row->otp)->toBe($expected);
})->with([[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]);

test('sign in requires password and TOTP and returns an eight hour session with one log row', function () {
    $admin = $this->platformAdmin();
    $p = $this->platformLoginPayload($admin);
    expect($this->platformCall('admin_login', $p))->toBe(['ok' => true, 'name' => 'Test admin', 'session_id' => $p['session_id']]);
    $session = $this->asOwner()->selectOne('SELECT *,extract(epoch FROM expires_at-created_at)::integer AS lifetime FROM platform.admin_sessions WHERE id=?', [$p['session_id']]);
    expect($session->admin_user_id)->toBe($admin['id'])->and($session->lifetime)->toBe(28800);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
    expect($log->admin_user_id)->toBe($admin['id'])->and($log->succeeded)->toBeTrue()->and($log->action)->toBe('admin.login');
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('last_login_at'))->not->toBeNull();
});

test('credential refusals have the same shape and exactly one failed log', function (string $case) {
    $admin = $this->platformAdmin($case === 'inactive' ? ['is_active' => false] : []);
    $p = $this->platformLoginPayload($admin);
    if ($case === 'password') {
        $p['password'] = 'Wrong-admin-password';
    }
    if ($case === 'totp') {
        $p['otp'] = 'invalid-otp';
    }
    if ($case === 'unknown') {
        $p['email'] = 'unknown-'.$this->platformId().'@example.invalid';
    }
    if ($case === 'reused') {
        expect($this->platformCall('admin_login', $p)['ok'])->toBeTrue();
        $p['session_id'] = $this->platformId();
        $p['log_id'] = $this->platformId();
    }
    $before = $this->asOwner()->table('platform.admin_log')->count();
    expect($this->platformCall('admin_login', $p))->toBe(['ok' => false, 'reason' => 'bad_credentials']);
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before + 1);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
    expect($log->succeeded)->toBeFalse()->and($log->admin_user_id)->toBeNull()->and($log->reason)->toBe('bad_credentials');
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $p['session_id'])->exists())->toBeFalse();
})->with(['password', 'totp', 'unknown', 'inactive', 'reused']);

test('the previous and next TOTP steps are accepted and cannot be reused', function (int $offset) {
    $admin = $this->platformAdmin();
    $otp = $this->platformOtp($admin['secret'], $this->platformStep() + $offset);
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['otp' => $otp]))['ok'])->toBeTrue();
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['otp' => $otp])))
        ->toBe(['ok' => false, 'reason' => 'bad_credentials']);
})->with([-1, 1]);

test('a recovery code needs the password and works only once', function () {
    $admin = $this->platformAdmin();
    $code = 'single-use-recovery-code';
    $this->asOwner()->table('platform.admin_recovery_codes')->insert(['id' => $this->platformId(), 'admin_user_id' => $admin['id'], 'code_hash' => hash('sha256', $code)]);
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['otp' => $code, 'password' => 'wrong']))['ok'])->toBeFalse();
    expect($this->asOwner()->table('platform.admin_recovery_codes')->where('admin_user_id', $admin['id'])->value('used_at'))->toBeNull();
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['otp' => $code]))['ok'])->toBeTrue();
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['otp' => $code])))
        ->toBe(['ok' => false, 'reason' => 'bad_credentials']);
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('last_login_at'))->not->toBeNull();
});

test('five failures in fifteen minutes limit email independently of changing IPs', function () {
    $admin = $this->platformAdmin();
    for ($i = 0; $i < 5; $i++) {
        expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['password' => 'wrong']))['reason'])->toBe('bad_credentials');
    }
    $p = $this->platformLoginPayload($admin);
    expect($this->platformCall('admin_login', $p))->toBe(['ok' => false, 'reason' => 'rate_limited']);
    expect($this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->value('reason'))->toBe('rate_limited');
});

test('five failures in fifteen minutes limit IP independently of changing emails', function () {
    $admin = $this->platformAdmin();
    $ip = $this->platformIp();
    for ($i = 0; $i < 5; $i++) {
        expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, [
            'email' => 'unknown-'.$this->platformId().'@example.invalid', 'ip' => $ip]))['reason'])->toBe('bad_credentials');
    }
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['ip' => $ip])))
        ->toBe(['ok' => false, 'reason' => 'rate_limited']);
});

test('email and IP limits do not combine unrelated failures below either threshold', function () {
    $admin = $this->platformAdmin();
    $ip = $this->platformIp();
    for ($i = 0; $i < 3; $i++) {
        $this->platformCall('admin_login', $this->platformLoginPayload($admin, ['password' => 'wrong']));
    }
    for ($i = 0; $i < 2; $i++) {
        $this->platformCall('admin_login', $this->platformLoginPayload($admin, ['email' => 'unknown-'.$this->platformId().'@example.invalid', 'ip' => $ip]));
    }
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['ip' => $ip]))['ok'])->toBeTrue();
});

test('failures older than fifteen minutes do not limit sign in', function () {
    $admin = $this->platformAdmin();
    $ip = $this->platformIp();
    for ($i = 0; $i < 5; $i++) {
        $this->asOwner()->insert("INSERT INTO platform.admin_log(id,action,succeeded,reason,detail,ip,at) VALUES (?::uuid,'admin.login',false,'bad_credentials',?::jsonb,?::inet,now()-interval '16 minutes')", [$this->platformId(), json_encode(['email' => $admin['email']]), $ip]);
    }
    expect($this->platformCall('admin_login', $this->platformLoginPayload($admin, ['ip' => $ip]))['ok'])->toBeTrue();
});

test('expired inactive ended and unknown sessions refuse with exactly one log', function (string $case) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    if ($case === 'idle') {
        $this->asOwner()->statement("UPDATE platform.admin_sessions SET last_seen_at=now()-interval '30 minutes' WHERE id=?", [$session]);
    }
    if ($case === 'absolute') {
        $this->asOwner()->statement('UPDATE platform.admin_sessions SET expires_at=now() WHERE id=?', [$session]);
    }
    if ($case === 'ended') {
        $this->asOwner()->statement('UPDATE platform.admin_sessions SET ended_at=now() WHERE id=?', [$session]);
    }
    if ($case === 'inactive') {
        $this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->update(['is_active' => false]);
    }
    if ($case === 'unknown') {
        $session = $this->platformId();
    }
    $before = $this->asOwner()->table('platform.admin_log')->count();
    $row = $this->panel()->selectOne('SELECT platform.admin_logout(?::uuid) AS result', [$session]);
    expect(json_decode($row->result, true))->toBe(['ok' => false, 'reason' => 'session_invalid']);
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before + 1);
})->with(['idle', 'absolute', 'ended', 'inactive', 'unknown']);

test('logout ends only its own session and logs success then refusal', function () {
    $a = $this->platformAdmin();
    $b = $this->platformAdmin();
    $one = $this->platformSession($a);
    $two = $this->platformSession($b);
    $before = $this->asOwner()->table('platform.admin_log')->count();
    expect(json_decode($this->panel()->selectOne('SELECT platform.admin_logout(?::uuid) AS result', [$one])->result, true))->toBe(['ok' => true]);
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $one)->value('ended_at'))->not->toBeNull();
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $two)->value('ended_at'))->toBeNull();
    expect(json_decode($this->panel()->selectOne('SELECT platform.admin_logout(?::uuid) AS result', [$one])->result, true)['ok'])->toBeFalse();
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before + 2);
});

test('a password change needs fresh TOTP changes only its actor and ends their other sessions', function () {
    $a = $this->platformAdmin();
    $b = $this->platformAdmin();
    $p = $this->platformLoginPayload($a);
    $this->platformCall('admin_login', $p);
    $other = $this->platformSession($a);
    $foreign = $this->platformSession($b);
    $base = ['session_id' => $p['session_id'], 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId(), 'otp' => $p['otp']];
    expect($this->platformCall('admin_change_password', $base))->toBe(['ok' => false, 'reason' => 'step_up_failed']);
    $base['log_id'] = $this->platformId();
    $base['otp'] = $this->platformOtp($a['secret'], $this->platformStep() + 1);
    expect($this->platformCall('admin_change_password', $base))->toBe(['ok' => true]);
    expect($this->asOwner()->selectOne('SELECT password_hash=platform_crypto.crypt(?,password_hash) AS matches FROM platform.admin_users WHERE id=?', [$base['password'], $a['id']])->matches)->toBeTrue();
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $other)->value('ended_at'))->not->toBeNull();
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $foreign)->value('ended_at'))->toBeNull();
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $p['session_id'])->value('ended_at'))->toBeNull();
    $base['log_id'] = $this->platformId();
    expect($this->platformCall('admin_change_password', $base)['ok'])->toBeFalse();
});

test('step up refuses an empty code a wrong code and a recovery code', function (string $otp) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $this->asOwner()->table('platform.admin_recovery_codes')->insert(['id' => $this->platformId(), 'admin_user_id' => $admin['id'], 'code_hash' => hash('sha256', 'recovery')]);
    $p = ['session_id' => $session, 'otp' => $otp, 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'step_up_failed']);
    expect($this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->value('succeeded'))->toBeFalse();
})->with(['', 'wrong-code', 'recovery']);

test('refusal logging resolves the session actor and never accepts a supplied actor or success flag', function () {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $p = ['session_id' => $session, 'action' => 'device.revoke', 'reason' => 'malformed_payload', 'log_id' => $this->platformId(), 'target_id' => $this->platformId()];
    expect($this->platformCall('admin_log_refusal', $p))->toBe(['ok' => true]);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
    expect($log->admin_user_id)->toBe($admin['id'])->and($log->succeeded)->toBeFalse()->and($log->target_id)->toBe($p['target_id']);
    foreach (['admin_user_id' => $this->platformId(), 'succeeded' => true] as $key => $value) {
        $bad = [...$p, 'log_id' => $this->platformId(), $key => $value];
        try {
            $this->platformCall('admin_log_refusal', $bad);
            $this->fail('Expected malformed refusal to raise');
        } catch (QueryException $e) {
            expect($e->getCode())->toBe('22023');
        }
        expect($this->asOwner()->table('platform.admin_log')->where('id', $bad['log_id'])->exists())->toBeFalse();
    }
    $p['session_id'] = $this->platformId();
    $p['log_id'] = $this->platformId();
    expect($this->platformCall('admin_log_refusal', $p))->toBe(['ok' => false, 'reason' => 'session_invalid']);
    expect($this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->value('admin_user_id'))->toBeNull();
});

test('malformed payloads raise 22023 before any action or log', function (string $function, array $payload) {
    $before = $this->asOwner()->table('platform.admin_log')->count();
    try {
        $this->platformCall($function, $payload);
        $this->fail('Expected invalid payload');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('22023');
    }
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before);
})->with([
    ['admin_login', []], ['admin_login', ['email' => 7]], ['admin_change_password', []], ['admin_log_refusal', []],
    ['admin_login', ['email' => 'test@example.invalid', 'password' => 'valid-password', 'otp' => '123456', 'ip' => null, 'user_agent' => null, 'session_id' => 'bad', 'log_id' => 'bad']],
]);

test('each action role resolves sessions and writes exactly its requested log row', function (string $role) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $log = $this->platformId();
    $state = $this->asPlatformRole($role, fn ($db) => json_decode($db->selectOne('SELECT platform.admin_session_actor(?::uuid,NULL,false) AS result', [$session])->result, true));
    expect($state)->toBe(['ok' => true, 'admin_user_id' => $admin['id']]);
    $actor = $state['admin_user_id'];
    $before = $this->asOwner()->table('platform.admin_log')->count();
    $this->asPlatformRole($role, fn ($db) => $db->select('SELECT platform.admin_log_write(?::uuid,?::uuid,?,NULL,NULL,false,?,?::jsonb)', [$log, $actor, 'device.revoke', 'not_allowed', '{}']));
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before + 1);
    expect($this->asOwner()->table('platform.admin_log')->where('id', $log)->value('admin_user_id'))->toBe($admin['id']);
})->with(['clintra_admin_provision', 'clintra_admin_mint', 'clintra_admin_device', 'clintra_admin_org', 'clintra_admin_stats', 'clintra_admin_support']);

test('internal helpers reject malformed requirements and log actions without writing', function () {
    $db = $this->asOwner();
    $before = $db->table('platform.admin_log')->count();
    foreach ([
        ['SELECT platform.admin_session_actor(?::uuid,NULL,NULL)', [$this->platformId()]],
        ['SELECT platform.admin_log_write(?::uuid,NULL,?,NULL,NULL,false,NULL,?::jsonb)', [$this->platformId(), 'unknown.action', '{}']],
    ] as [$sql,$bindings]) {
        try {
            $db->select($sql, $bindings);
            $this->fail('Expected malformed internal call');
        } catch (QueryException $e) {
            expect($e->getCode())->toBe('22023');
        }
    }
    expect($db->table('platform.admin_log')->count())->toBe($before);
});
