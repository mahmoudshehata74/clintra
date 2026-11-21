<?php

use Illuminate\Database\QueryException;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

test('the first password change flag defaults true and cannot be null', function () {
    $column = $this->asOwner()->selectOne("SELECT a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS value FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='platform.admin_users'::regclass AND a.attname='must_change_password'");
    expect($column->attnotnull)->toBeTrue()->and($column->value)->toBe('true');
});

test('a fresh admin signs in but session actions refuse until the password changes', function (string $role) {
    $admin = $this->platformAdmin(['must_change_password' => true]);
    $login = $this->platformLoginPayload($admin);
    $result = $this->platformCall('admin_login', $login);
    expect($result['must_change_password'])->toBeTrue();
    $state = $this->asPlatformRole($role, fn ($db) => json_decode($db->selectOne('SELECT platform.admin_session_actor(?::uuid,?,true) AS result', [$login['session_id'], $this->platformOtp($admin['secret'], $this->platformStep() + 1)])->result, true));
    expect($state)->toBe(['ok' => false, 'reason' => 'password_change_required', 'admin_user_id' => $admin['id']]);
    $p = ['session_id' => $login['session_id'], 'action' => 'device.revoke', 'reason' => 'malformed_payload', 'log_id' => $this->platformId(), 'target_id' => null];
    expect($this->platformCall('admin_log_refusal', $p))->toBe(['ok' => false, 'reason' => 'password_change_required']);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
    expect($log->admin_user_id)->toBe($admin['id'])->and($log->reason)->toBe('password_change_required');
})->with(['clintra_admin_provision', 'clintra_admin_mint', 'clintra_admin_device', 'clintra_admin_org', 'clintra_admin_stats', 'clintra_admin_support']);

test('an admin that must change the password can still log out', function () {
    $admin = $this->platformAdmin(['must_change_password' => true]);
    $session = $this->platformSession($admin);
    expect(json_decode($this->panel()->selectOne('SELECT platform.admin_logout(?::uuid) AS result', [$session])->result, true))->toBe(['ok' => true]);
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $session)->value('ended_at'))->not->toBeNull();
});

test('wrong current passwords do not count as step up or login failures and do not consume TOTP', function () {
    $admin = $this->platformAdmin(['must_change_password' => true]);
    $session = $this->platformSession($admin);
    for ($i = 0; $i < 4; $i++) {
        $this->asOwner()->insert("INSERT INTO platform.admin_log(id,admin_user_id,action,succeeded,reason) VALUES (?::uuid,?::uuid,'admin.password_change',false,'step_up_failed')", [$this->platformId(), $admin['id']]);
    }
    for ($i = 0; $i < 5; $i++) {
        $p = ['session_id' => $session, 'current_password' => 'wrong-current-password', 'otp' => $this->platformOtp($admin['secret']), 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
        expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'bad_credentials']);
        $log = $this->asOwner()->table('platform.admin_log')->where('id', $p['log_id'])->sole();
        expect($log->admin_user_id)->toBe($admin['id'])->and($log->reason)->toBe('bad_credentials');
    }
    expect($this->asOwner()->table('platform.admin_log')->where('admin_user_id', $admin['id'])->where('reason', 'step_up_failed')->count())->toBe(4);
    expect($this->asOwner()->table('platform.admin_log')->where('admin_user_id', $admin['id'])->where('action', 'admin.login')->count())->toBe(0);
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('last_totp_step'))->toBeNull();
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $session)->value('ended_at'))->toBeNull();
});

test('the current password cannot be reused as the new password', function () {
    $admin = $this->platformAdmin(['must_change_password' => true]);
    $session = $this->platformSession($admin);
    $p = ['session_id' => $session, 'current_password' => $admin['password'], 'otp' => $this->platformOtp($admin['secret']), 'password' => $admin['password'], 'log_id' => $this->platformId()];
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => false, 'reason' => 'bad_credentials']);
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('must_change_password'))->toBeTrue();
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('last_totp_step'))->toBeNull();
});

test('a correct current password and fresh TOTP clear the flag and unblock session actions', function () {
    $admin = $this->platformAdmin(['must_change_password' => true]);
    $login = $this->platformLoginPayload($admin);
    expect($this->platformCall('admin_login', $login)['must_change_password'])->toBeTrue();
    $p = ['session_id' => $login['session_id'], 'current_password' => $admin['password'], 'otp' => $this->platformOtp($admin['secret'], $this->platformStep() + 1), 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
    expect($this->platformCall('admin_change_password', $p))->toBe(['ok' => true]);
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('must_change_password'))->toBeFalse();
    $state = $this->asPlatformRole('clintra_admin_device', fn ($db) => json_decode($db->selectOne('SELECT platform.admin_session_actor(?::uuid,NULL,false) AS result', [$login['session_id']])->result, true));
    expect($state)->toBe(['ok' => true, 'admin_user_id' => $admin['id']]);
    $recovery = 'password-change-test-recovery';
    $this->asOwner()->table('platform.admin_recovery_codes')->insert(['id' => $this->platformId(), 'admin_user_id' => $admin['id'], 'code_hash' => hash('sha256', $recovery)]);
    $again = $this->platformCall('admin_login', $this->platformLoginPayload($admin, ['password' => $p['password'], 'otp' => $recovery]));
    expect($again['ok'])->toBeTrue()->and($again['must_change_password'])->toBeFalse();
});

test('the current password is mandatory in the password change payload', function () {
    $admin = $this->platformAdmin();
    $p = ['session_id' => $this->platformSession($admin), 'otp' => $this->platformOtp($admin['secret']), 'password' => 'Changed-admin-password-456', 'log_id' => $this->platformId()];
    try {
        $this->platformCall('admin_change_password', $p);
        $this->fail('Expected the old payload to be malformed');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('22023');
    }
    expect($this->asOwner()->table('platform.admin_log')->where('id',$p['log_id'])->exists())->toBeFalse();
});
