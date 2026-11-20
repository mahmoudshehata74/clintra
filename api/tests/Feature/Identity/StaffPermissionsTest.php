<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;

test('credentials are scoped to the organization and delegated revoke targets', function () {
    $org = IdentityHarness::org(enforced: true);
    $other = IdentityHarness::org(enforced: true);
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage', 'reports.view']);
    $manager = IdentityHarness::credential($org, $managerId);
    $practitioner = IdentityHarness::credential($org, IdentityHarness::member($org, 'practitioner'));
    $privileged = IdentityHarness::credential($org, IdentityHarness::member($org, 'assistant', ['cash.close']));
    $assistant = IdentityHarness::credential($org, IdentityHarness::member($org, 'assistant', ['reports.view']));
    IdentityHarness::credential($other, $other['ownerId']);

    $read = fn (array $caller) => IdentityHarness::send($org, 'GET', '/api/staff/credentials', [], $caller);
    expect(array_column($read($owner)->assertOk()->json('credentials'), 'id'))
        ->toEqualCanonicalizing([$owner['id'], $manager['id'], $practitioner['id'], $privileged['id'], $assistant['id']]);
    $listed = $read($manager)->assertOk()->json('credentials');
    expect(array_column($listed, 'id'))->toBe([$assistant['id']]);
    expect(array_keys($listed[0]))->toBe(['id', 'membership_id', 'device_id', 'location_id', 'series', 'created_at']);
    $read($assistant)->assertNotFound();
});

test('permission edits require step-up, pass through the guard and sync the new revision', function () {
    $org = IdentityHarness::org(enforced: true);
    $other = IdentityHarness::org(enforced: true);
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage', 'reports.view'], 'manager', 'manager password 1');
    $manager = IdentityHarness::credential($org, $managerId);
    $target = IdentityHarness::member($org, 'assistant', ['cash.close']);
    $update = fn (array $caller, string $target, array $permissions, string $password) => IdentityHarness::send(
        $org, 'POST', "/api/staff/{$target}", compact('permissions', 'password'), $caller,
    );

    $update($manager, $target, ['reports.view'], 'manager password 1')->assertNotFound();
    $update($manager, $target, ['cash.close', 'services.manage'], 'manager password 1')->assertNotFound();
    $update($manager, $org['ownerId'], [], 'manager password 1')->assertNotFound();
    $update($owner, $org['ownerId'], [], 'owner password 1')->assertNotFound();
    $update($owner, $other['ownerId'], [], 'owner password 1')->assertNotFound();
    $update($owner, $target, ['reports.view'], 'wrong password')->assertStatus(403);
    $update($owner, $target, ['unknown.permission'], 'owner password 1')->assertUnprocessable();

    $result = $update($manager, $target, ['cash.close', 'reports.view'], 'manager password 1')->assertOk()->json();
    expect($result)->toMatchArray(['membership_id' => $target, 'rev' => 2]);
    expect($result['permissions'])->toEqualCanonicalizing(['cash.close', 'reports.view']);
    $pulled = collect(IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk()->json('rows'))->firstWhere('entity_id', $target);
    expect($pulled['payload']['permissions'])->toEqualCanonicalizing(['cash.close', 'reports.view']);
    expect($this->fx()->table('audit_log')->where('entity_id', $target)->value('actor_membership_id'))->toBe($managerId);
    $update($owner, $target, [], 'owner password 1')->assertOk()->assertJsonPath('permissions', []);

    expect(fn () => $this->withMembership($this->asApp(), $managerId, fn ($db) =>
        $db->table('memberships')->where('id', $target)->update(['permissions' => '{cash.close}'])))
        ->toThrow(QueryException::class, 'permission_escalation');
});

test('username changes require person proof and consume the owners password step-up once', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $target = IdentityHarness::member($org, 'assistant');
    $path = "/api/staff/{$target}/username";
    $input = ['username' => 'alice', 'password' => 'owner password 1'];
    IdentityHarness::send($org, 'PUT', $path, $input)->assertUnauthorized();
    IdentityHarness::send($org, 'PUT', $path, [...$input, 'password' => 'wrong password'], $owner)->assertStatus(403);
    IdentityHarness::send($org, 'PUT', $path, $input, $owner)->assertOk()->assertJsonPath('username', 'alice');
    $used = $this->fx()->table('login_attempts')->where('membership_id', $org['ownerId'])->where('succeeded', true)->first();
    expect($used->consumed_at)->not->toBeNull();
    $payload = ['attempt_id' => $used->id, 'membership_id' => $target, 'username' => 'other', 'audit_id' => (string) Str::uuid()];
    expect(fn () => $this->withMembership($this->asApp(), $org['ownerId'], fn ($db) =>
        $db->select('select auth_set_username(?::jsonb)', [json_encode($payload)])))
        ->toThrow(QueryException::class, 'auth: not allowed');
});
