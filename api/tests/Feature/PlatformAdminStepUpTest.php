<?php

use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

test('the fifth failed step up ends all of that admins sessions atomically and leaves another admin unaffected', function () {
    $admin = $this->platformAdmin();
    $other = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $second = $this->platformSession($admin);
    $foreign = $this->platformSession($other);
    for ($attempt = 1; $attempt <= 5; $attempt++) {
        $p = ['session_id' => $session, 'current_password' => $admin['password'], 'otp' => 'wrong-code', 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
        $before = $this->asOwner()->table('platform.admin_log')->count();
        expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'step_up_failed'] + ($attempt === 5 ? ['all_sessions_ended' => true] : []));
        expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before + 1);
        $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
        expect($log->admin_user_id)->toBe($admin['id'])->and($log->reason)->toBe('step_up_failed');
        expect(json_decode($log->detail, true)['all_sessions_ended'])->toBe($attempt === 5);
        $ended = $this->asOwner()->table('platform.admin_sessions')->whereIn('id', [$session, $second])->whereNotNull('ended_at')->count();
        expect($ended)->toBe($attempt === 5 ? 2 : 0);
    }
    $p['otp'] = $this->platformOtp($admin['secret']);
    $p['log_id'] = $this->platformId();
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'session_invalid']);
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $foreign)->value('ended_at'))->toBeNull();
    $p['session_id'] = $foreign;
    $p['otp'] = $this->platformOtp($other['secret']);
    $p['log_id'] = $this->platformId();
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => true]);
});

test('step up failures older than fifteen minutes do not count toward ending sessions', function () {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    for ($i = 0; $i < 5; $i++) {
        $this->asOwner()->insert("INSERT INTO platform.admin_log(id,admin_user_id,action,succeeded,reason,at) VALUES (?::uuid,?::uuid,'admin.password_change',false,'step_up_failed',now()-interval '16 minutes')", [$this->platformId(), $admin['id']]);
    }
    $p = ['session_id' => $session, 'current_password' => $admin['password'], 'otp' => 'wrong-code', 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
    expect($this->platformCall('admin_change_password', $p)['reason'])->toBe('step_up_failed');
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $session)->value('ended_at'))->toBeNull();
    $p['otp'] = $this->platformOtp($admin['secret']);
    $p['log_id'] = $this->platformId();
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => true]);
});


test('wrong current passwords share the step up budget and end every session on the fifth failure', function (array $attempts) {
    $admin = $this->platformAdmin();
    $other = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $second = $this->platformSession($admin);
    $foreign = $this->platformSession($other);
    foreach ($attempts as $i => $wrongPassword) {
        $p = ['session_id' => $session, 'current_password' => $wrongPassword ? 'wrong-current-password' : $admin['password'], 'otp' => $wrongPassword ? $this->platformOtp($admin['secret']) : 'wrong-code', 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
        $before = $this->asOwner()->table('platform.admin_log')->count();
        $reason = $wrongPassword ? 'current_password_failed' : 'step_up_failed';
        expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => $reason] + ($i === 4 ? ['all_sessions_ended' => true] : []));
        expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before + 1);
        $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
        expect($log->admin_user_id)->toBe($admin['id'])->and($log->reason)->toBe($reason);
        expect(json_decode($log->detail, true)['all_sessions_ended'])->toBe($i === 4);
        expect($this->asOwner()->table('platform.admin_sessions')->whereIn('id', [$session, $second])->whereNotNull('ended_at')->count())->toBe($i === 4 ? 2 : 0);
    }
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('last_totp_step'))->toBeNull();
    $p['current_password'] = $admin['password'];
    $p['otp'] = $this->platformOtp($admin['secret']);
    $p['log_id'] = $this->platformId();
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'session_invalid']);
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $foreign)->value('ended_at'))->toBeNull();
    $p['session_id'] = $foreign;
    $p['otp'] = $this->platformOtp($other['secret']);
    $p['log_id'] = $this->platformId();
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => true]);
})->with([
    'five passwords' => [[true, true, true, true, true]],
    'password then code' => [[true, true, true, false, false]],
    'code then password' => [[false, false, true, true, true]],
]);

test('old failures of both kinds are ignored by both password and step up checks', function (bool $wrongPassword) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    foreach (['current_password_failed', 'step_up_failed'] as $reason) {
        for ($i = 0; $i < 5; $i++) {
            $this->asOwner()->insert("INSERT INTO platform.admin_log(id,admin_user_id,action,succeeded,reason,at) VALUES (?::uuid,?::uuid,'admin.password_change',false,?,now()-interval '16 minutes')", [$this->platformId(), $admin['id'], $reason]);
        }
    }
    $p = ['session_id' => $session, 'current_password' => $wrongPassword ? 'wrong-current-password' : $admin['password'], 'otp' => 'wrong-code', 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
    expect($this->platformCall('admin_change_password', $p)['reason'])->toBe($wrongPassword ? 'current_password_failed' : 'step_up_failed');
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $session)->value('ended_at'))->toBeNull();
    $p['current_password'] = $admin['password'];
    $p['otp'] = $this->platformOtp($admin['secret']);
    $p['log_id'] = $this->platformId();
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => true]);
})->with([true, false]);
