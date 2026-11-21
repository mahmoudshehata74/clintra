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
        expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'step_up_failed']);
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
