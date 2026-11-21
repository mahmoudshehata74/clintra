<?php

use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

test('session refusals return session_invalid and log a null actor for every panel session path', function (string $function, string $case) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    if ($case === 'unknown') {
        $session = $this->platformId();
    }
    if ($case === 'idle') {
        $this->asOwner()->statement("UPDATE platform.admin_sessions SET last_seen_at=now()-interval '30 minutes' WHERE id=?", [$session]);
    }
    if ($case === 'expired') {
        $this->asOwner()->statement('UPDATE platform.admin_sessions SET expires_at=now() WHERE id=?', [$session]);
    }
    if ($case === 'ended') {
        $this->asOwner()->statement('UPDATE platform.admin_sessions SET ended_at=now() WHERE id=?', [$session]);
    }
    if ($case === 'inactive') {
        $this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->update(['is_active' => false]);
    }
    $before = $this->asOwner()->table('platform.admin_log')->max('seq') ?? 0;
    $result = match ($function) {
        'admin_logout' => json_decode($this->panel()->selectOne('SELECT platform.admin_logout(?::uuid) AS result', [$session])->result, true),
        'admin_change_password' => $this->platformCall($function, ['session_id' => $session, 'current_password' => $admin['password'], 'otp' => $this->platformOtp($admin['secret']), 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()]),
        'admin_log_refusal' => $this->platformCall($function, ['session_id' => $session, 'action' => 'device.revoke', 'reason' => 'malformed_payload', 'log_id' => $this->platformId(), 'target_id' => null]),
    };
    expect($result)->toBe(['ok' => false, 'reason' => 'session_invalid']);
    $log = $this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->sole();
    expect($log->admin_user_id)->toBeNull()->and($log->reason)->toBe('session_invalid')->and($log->succeeded)->toBeFalse();
})->with(['admin_logout', 'admin_change_password', 'admin_log_refusal'])->with(['unknown', 'idle', 'expired', 'ended', 'inactive']);

test('wrong and reused step up codes retain the valid admin in the refusal row', function (bool $reused) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $otp = 'wrong-code';
    if ($reused) {
        $login = $this->platformLoginPayload($admin);
        $this->platformCall('admin_login', $login);
        $otp = $login['otp'];
    }
    $p = ['session_id' => $session, 'current_password' => $admin['password'], 'otp' => $otp, 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'step_up_failed']);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
    expect($log->admin_user_id)->toBe($admin['id'])->and($log->reason)->toBe('step_up_failed')->and($log->succeeded)->toBeFalse();
})->with([false, true]);

test('each action role receives the structured session or step up refusal and can log its actor', function (string $role, bool $valid) {
    $admin = $this->platformAdmin();
    $session = $valid ? $this->platformSession($admin) : $this->platformId();
    $log = $this->platformId();
    $state = $this->asPlatformRole($role, function ($db) use ($session, $log) {
        $state = json_decode($db->selectOne('SELECT platform.admin_session_actor(?::uuid,?,true) AS result', [$session, 'wrong-code'])->result, true);
        $db->select('SELECT platform.admin_log_write(?::uuid,?::uuid,?,NULL,NULL,false,?,?::jsonb)', [$log, $state['admin_user_id'], 'device.revoke', $state['reason'], '{}']);

        return $state;
    });
    $expected = $valid ? 'step_up_failed' : 'session_invalid';
    expect($state['reason'])->toBe($expected)->and($state['admin_user_id'])->toBe($valid ? $admin['id'] : null);
    $row = $this->asOwner()->table('platform.admin_log')->where('id', $log)->sole();
    expect($row->reason)->toBe($expected)->and($row->admin_user_id)->toBe($valid ? $admin['id'] : null);
})->with(['clintra_admin_provision', 'clintra_admin_mint', 'clintra_admin_device', 'clintra_admin_org', 'clintra_admin_stats', 'clintra_admin_support'])->with([false, true]);
