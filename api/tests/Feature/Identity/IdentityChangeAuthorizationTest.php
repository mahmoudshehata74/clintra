<?php

use App\Support\Identity\Password;
use Tests\Support\IdentityHarness;

test('a manager with staff.manage cannot reset or revoke a protected member', function (string $role, array $permissions) {
    $org = IdentityHarness::org(enforced: true);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage', 'reports.view'], 'manager', 'manager password 1');
    $manager = IdentityHarness::credential($org, $managerId);
    $targetId = IdentityHarness::member($org, $role, $permissions, 'target', 'target password 1');
    $target = IdentityHarness::credential($org, $targetId);

    $input = ['password' => 'manager password 1'];
    IdentityHarness::send($org, 'POST', "/api/staff/{$targetId}/password-reset", $input, $manager)->assertNotFound();
    IdentityHarness::send($org, 'DELETE', "/api/staff/credentials/{$target['id']}", $input, $manager)->assertNotFound();

    $hash = $this->fx()->table('member_passwords')->where('membership_id', $targetId)->value('password_hash');
    expect(Password::verify('target password 1', $hash))->toBeTrue();
    expect($this->fx()->table('member_credentials')->where('id', $target['id'])->value('revoked_at'))->toBeNull();
})->with([
    'practitioner with a subset' => ['practitioner', ['reports.view']],
    'owner' => ['owner', []],
    'assistant with an unheld permission' => ['assistant', ['reports.view', 'cash.close']],
]);

test('a manager with staff.manage can reset and revoke an assistant whose permissions are a subset', function () {
    $org = IdentityHarness::org(enforced: true);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage', 'reports.view'], 'manager', 'manager password 1');
    $manager = IdentityHarness::credential($org, $managerId);
    $targetId = IdentityHarness::member($org, 'assistant', ['reports.view'], 'target', 'target password 1');
    $target = IdentityHarness::credential($org, $targetId);

    $input = ['password' => 'manager password 1'];
    IdentityHarness::send($org, 'DELETE', "/api/staff/credentials/{$target['id']}", $input, $manager)->assertOk();
    $reset = IdentityHarness::send($org, 'POST', "/api/staff/{$targetId}/password-reset", $input, $manager)->assertOk();

    $hash = $this->fx()->table('member_passwords')->where('membership_id', $targetId)->value('password_hash');
    expect(Password::verify($reset->json('temporary_password'), $hash))->toBeTrue();
    expect($this->fx()->table('member_credentials')->where('id', $target['id'])->value('revoke_reason'))->toBe('owner_revoked');
});

test('an owner can reset and revoke another member of every role', function (string $role) {
    $org = IdentityHarness::org(enforced: true);
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $targetId = IdentityHarness::member($org, $role, ['cash.close'], 'target', 'target password 1');
    $target = IdentityHarness::credential($org, $targetId);

    $input = ['password' => 'owner password 1'];
    IdentityHarness::send($org, 'DELETE', "/api/staff/credentials/{$target['id']}", $input, $owner)->assertOk();
    IdentityHarness::send($org, 'POST', "/api/staff/{$targetId}/password-reset", $input, $owner)->assertOk();
})->with(['owner', 'practitioner', 'assistant', 'manager']);

test('an owner cannot reset their own password and can revoke their own credential', function () {
    $org = IdentityHarness::org(enforced: true);
    $owner = IdentityHarness::credential($org, $org['ownerId']);

    $input = ['password' => 'owner password 1'];
    IdentityHarness::send($org, 'POST', "/api/staff/{$org['ownerId']}/password-reset", $input, $owner)->assertNotFound();
    IdentityHarness::send($org, 'DELETE', "/api/staff/credentials/{$owner['id']}", $input, $owner)->assertOk();
});
