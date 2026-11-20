<?php

use App\Support\Identity\AuthCall;
use App\Support\Identity\AuthCallFailed;
use App\Support\Identity\Password;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;

beforeEach(function () {
    $this->org = IdentityHarness::org(enforced: true);
    $this->stepUp = $this->fx()->table('login_attempts')->insertGetId([
        'org_id' => $this->org['orgId'],
        'device_id' => $this->org['deviceId'],
        'username' => 'owner',
        'membership_id' => $this->org['ownerId'],
        'kind' => 'step_up',
        'succeeded' => true,
    ]);
    $this->runChange = fn (string $function, array $payload) => $this->withMembership(
        $this->asApp(),
        $this->org['ownerId'],
        fn () => AuthCall::run($function, $payload + ['attempt_id' => $this->stepUp, 'audit_id' => (string) Str::uuid()]),
    );
    $this->resetPassword = fn (string $target) => ($this->runChange)('auth_reset_member_password', [
        'target_membership_id' => $target,
        'temporary_hash' => Password::hash('temporary password 1'),
    ]);
});

test('one step-up authorizes only one password reset', function () {
    $first = IdentityHarness::member($this->org, username: 'first');
    $second = IdentityHarness::member($this->org, username: 'second');

    ($this->resetPassword)($first);

    expect(fn () => ($this->resetPassword)($second))->toThrow(AuthCallFailed::class, 'SQLSTATE P0001');
    expect($this->fx()->table('member_passwords')->where('membership_id', $second)->exists())->toBeFalse();
});

test('a password reset consumes the step-up for credential revocation too', function () {
    $resetTarget = IdentityHarness::member($this->org, username: 'reset-target');
    $revokeTarget = IdentityHarness::member($this->org, username: 'revoke-target');
    $credential = IdentityHarness::credential($this->org, $revokeTarget);

    ($this->resetPassword)($resetTarget);

    expect(fn () => ($this->runChange)('auth_revoke_credential', ['credential_id' => $credential['id']]))
        ->toThrow(AuthCallFailed::class, 'SQLSTATE P0001');
    expect($this->fx()->table('member_credentials')->where('id', $credential['id'])->value('revoked_at'))->toBeNull();
});

test('revoking a credential consumes the step-up for password resets too', function () {
    $target = IdentityHarness::member($this->org, username: 'target');
    $credential = IdentityHarness::credential($this->org, $target);

    ($this->runChange)('auth_revoke_credential', ['credential_id' => $credential['id']]);

    expect(fn () => ($this->resetPassword)($target))->toThrow(AuthCallFailed::class, 'SQLSTATE P0001');
    expect($this->fx()->table('member_passwords')->where('membership_id', $target)->exists())->toBeFalse();
});

test('a refused password reset leaves its step-up available for a successful change', function () {
    $nameless = IdentityHarness::member($this->org);
    $target = IdentityHarness::member($this->org, username: 'target');
    $attempt = $this->fx()->table('login_attempts')->where('id', $this->stepUp);

    expect(fn () => ($this->resetPassword)($nameless))->toThrow(AuthCallFailed::class, 'SQLSTATE CL422');
    expect($attempt->value('consumed_at'))->toBeNull();

    ($this->resetPassword)($target);

    expect($attempt->value('consumed_at'))->not->toBeNull();
});

test('changing your own password consumes its step-up', function () {
    $change = fn (string $password) => ($this->runChange)('auth_set_password', [
        'membership_id' => $this->org['ownerId'],
        'new_hash' => Password::hash($password),
    ]);

    $change('new password 1');

    expect(fn () => $change('new password 2'))->toThrow(AuthCallFailed::class, 'SQLSTATE P0001');
    $hash = $this->fx()->table('member_passwords')->where('membership_id', $this->org['ownerId'])->value('password_hash');
    expect(Password::verify('new password 1', $hash))->toBeTrue();
});
