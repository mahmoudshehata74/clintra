<?php

use App\Support\Identity\Password;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;
use Tests\Support\TestKey;

/**
 * Resetting a member's password, revoking a credential and setting a
 * username (docs/design-identity-permissions.md, 3.7 and 6.4; "A1
 * decisions", 1 and 3): the endpoints, and the caller rules
 * auth_reset_member_password, auth_revoke_credential and auth_set_username
 * hold in the database whatever PHP does.
 */
test('the owner resets a member: a temporary password shown once, must_change, every credential revoked, an audit row', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $elsewhere = $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);
    $here = IdentityHarness::credential($org, $memberId);
    $there = IdentityHarness::credential($org, $memberId, $elsewhere);

    $response = IdentityHarness::send($org, 'POST', "/api/staff/{$memberId}/password-reset", ['password' => 'owner password 1'], $owner);

    $response->assertOk();
    $temporary = $response->json('temporary_password');
    expect($temporary)->toMatch('/^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/');
    expect($response->json('must_change_password'))->toBeTrue();

    $stored = $this->fx()->table('member_passwords')->where('membership_id', $memberId)->first();
    expect(Password::verify($temporary, $stored->password_hash))->toBeTrue();
    expect($stored->must_change)->toBeTrue();
    expect($stored->set_by_membership_id)->toBe($org['ownerId']);
    expect($this->fx()->table('member_credentials')->whereIn('id', [$here['id'], $there['id']])->pluck('revoke_reason')->unique()->all())
        ->toBe(['password_reset']);
    expect($this->fx()->table('audit_log')->where('entity', 'member_passwords')->where('entity_id', $memberId)->value('actor_membership_id'))
        ->toBe($org['ownerId']);

    // The member signs in with it and is told to change it.
    $login = IdentityHarness::send($org, 'POST', '/api/auth/login', [
        'username' => 'mona', 'password' => $temporary, 'credential_id' => (string) Str::uuid(),
        'credential_public_key' => TestKey::make()->jwk, 'device_public_key' => null,
    ]);
    expect($login->assertOk()->json('must_change_password'))->toBeTrue();
});

test('a holder of staff.manage resets a non-owner, never an owner or themselves; a member without it resets nobody', function () {
    $org = IdentityHarness::org();
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage'], 'boss', 'boss password 1');
    $manager = IdentityHarness::credential($org, $managerId);
    $plainId = IdentityHarness::member($org, 'assistant', [], 'plain', 'plain password 1');
    $plain = IdentityHarness::credential($org, $plainId);
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');

    $reset = fn (array $caller, string $password, string $target) => IdentityHarness::send(
        $org, 'POST', "/api/staff/{$target}/password-reset", ['password' => $password], $caller,
    );

    $reset($manager, 'boss password 1', $memberId)->assertOk();
    $reset($manager, 'boss password 1', $org['ownerId'])->assertNotFound();
    $reset($manager, 'boss password 1', $managerId)->assertNotFound();
    $reset($plain, 'plain password 1', $memberId)->assertNotFound();
    expect(Password::verify('owner password 1', $this->fx()->table('member_passwords')->where('membership_id', $org['ownerId'])->value('password_hash')))->toBeTrue();
});

test('a reset needs the step-up password and a member with a username', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $nameless = IdentityHarness::member($org, 'assistant');

    IdentityHarness::send($org, 'POST', "/api/staff/{$nameless}/password-reset", ['password' => 'wrong'], $owner)->assertStatus(403);
    $response = IdentityHarness::send($org, 'POST', "/api/staff/{$nameless}/password-reset", ['password' => 'owner password 1'], $owner);
    $response->assertStatus(422);
    expect($response->json())->toBe(['error' => 'username_required', 'message' => 'حدد اسم مستخدم للموظف ده الأول']);
    expect($this->fx()->table('member_passwords')->where('membership_id', $nameless)->exists())->toBeFalse();
});

test('another organization\'s owner resets and revokes nothing here', function () {
    $a = IdentityHarness::org();
    $b = IdentityHarness::org();
    $memberA = IdentityHarness::member($a, 'assistant', [], 'mona', 'mona password 1');
    $credentialA = IdentityHarness::credential($a, $memberA);
    $ownerB = IdentityHarness::credential($b, $b['ownerId']);

    IdentityHarness::send($b, 'POST', "/api/staff/{$memberA}/password-reset", ['password' => 'owner password 1'], $ownerB)->assertNotFound();
    IdentityHarness::send($b, 'DELETE', "/api/staff/credentials/{$credentialA['id']}", ['password' => 'owner password 1'], $ownerB)->assertNotFound();

    expect(Password::verify('mona password 1', $this->fx()->table('member_passwords')->where('membership_id', $memberA)->value('password_hash')))->toBeTrue();
    expect($this->fx()->table('member_credentials')->where('id', $credentialA['id'])->value('revoked_at'))->toBeNull();
    expect($this->fx()->table('audit_log')->where('org_id', $a['orgId'])->count())->toBe(0);
});

test('revoking: an owner any credential including their own; staff.manage another non-owner\'s; nobody else', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $elsewhere = $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);
    $ownerElsewhere = IdentityHarness::credential($org, $org['ownerId'], $elsewhere);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage'], 'boss', 'boss password 1');
    $manager = IdentityHarness::credential($org, $managerId);
    $managerElsewhere = IdentityHarness::credential($org, $managerId, $elsewhere);
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $member = IdentityHarness::credential($org, $memberId);
    $revoke = fn (array $caller, string $password, array $target) => IdentityHarness::send(
        $org, 'DELETE', "/api/staff/credentials/{$target['id']}", ['password' => $password], $caller,
    );

    $revoke($manager, 'boss password 1', $ownerElsewhere)->assertNotFound();
    $revoke($manager, 'boss password 1', $managerElsewhere)->assertNotFound();
    $revoke($member, 'mona password 1', $manager)->assertNotFound();
    $revoke($manager, 'boss password 1', $member)->assertOk()->assertExactJson(['revoked' => true]);
    $revoke($owner, 'owner password 1', $ownerElsewhere)->assertOk();

    $reasons = $this->fx()->table('member_credentials')->where('org_id', $org['orgId'])->pluck('revoke_reason', 'id');
    expect($reasons[$member['id']])->toBe('owner_revoked');
    expect($reasons[$ownerElsewhere['id']])->toBe('owner_revoked');
    expect($reasons[$managerElsewhere['id']])->toBeNull();
    expect($reasons[$manager['id']])->toBeNull();
});

test('the owner sets usernames: lowercase, 3 to 32 of a-z 0-9 . _ -, unique per organization whatever the case', function () {
    $org = IdentityHarness::org(bindDeviceKey: false);
    $other = IdentityHarness::org(bindDeviceKey: false);
    $memberId = IdentityHarness::member($org, 'assistant');
    $secondId = IdentityHarness::member($org, 'assistant');
    $otherMember = IdentityHarness::member($other, 'assistant');
    $owners = [
        $org['orgId'] => IdentityHarness::credential($org, $org['ownerId']),
        $other['orgId'] => IdentityHarness::credential($other, $other['ownerId']),
    ];
    $set = fn (array $o, string $id, string $username) => IdentityHarness::send($o, 'PUT', "/api/staff/{$id}/username", [
        'username' => $username, 'password' => 'owner password 1',
    ], $owners[$o['orgId']]);

    $response = $set($org, $memberId, 'Mona.Ahmed_1');
    $response->assertOk();
    expect($response->json())->toMatchArray(['membership_id' => $memberId, 'username' => 'mona.ahmed_1']);
    expect($this->fx()->table('memberships')->where('id', $memberId)->value('username'))->toBe('mona.ahmed_1');

    foreach (['ab', str_repeat('a', 33), 'منى', 'mona ahmed', 'mona@clinic', ''] as $invalid) {
        $refused = $set($org, $secondId, $invalid);
        $refused->assertStatus(422);
        if ($invalid !== '') {
            expect($refused->json())->toBe([
                'error' => 'username_invalid',
                'message' => 'اسم المستخدم لازم يكون من 3 لـ 32 حرف: حروف إنجليزي صغيرة أو أرقام أو . أو _ أو -',
            ]);
        }
    }

    $taken = $set($org, $secondId, 'MONA.AHMED_1');
    $taken->assertStatus(409);
    expect($taken->json())->toBe(['error' => 'username_taken', 'message' => 'اسم المستخدم ده مستخدم قبل كده']);

    // Unique per organization only, and another organization's member is not ours to name.
    $set($other, $otherMember, 'mona.ahmed_1')->assertOk();
    $set($org, $otherMember, 'someone')->assertNotFound();
    expect($this->fx()->table('memberships')->where('id', $otherMember)->value('username'))->toBe('mona.ahmed_1');
});

test('a username change is recorded in the ledger with the new rev, so devices pull it; the pull leaves the username out', function () {
    $org = IdentityHarness::org(bindDeviceKey: false);
    $memberId = IdentityHarness::member($org, 'assistant');

    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $response = IdentityHarness::send($org, 'PUT', "/api/staff/{$memberId}/username", ['username' => 'mona', 'password' => 'owner password 1'], $owner);

    expect($response->json('rev'))->toBe(2);
    $ledger = $this->fx()->table('sync_ledger')->where('entity_id', $memberId)->first();
    expect([$ledger->entity, $ledger->rev, $ledger->actor_membership_id, $ledger->device_id])
        ->toBe(['memberships', 2, $org['ownerId'], $org['deviceId']]);

    $pulled = collect(IdentityHarness::send($org, 'GET', '/api/sync/pull')->json('rows'))->firstWhere('entity_id', $memberId);
    expect($pulled['rev'])->toBe(2);
    expect($pulled['payload'])->not->toHaveKey('username')->not->toHaveKey('permissions');

    // Setting the same name again changes nothing.
    IdentityHarness::send($org, 'PUT', "/api/staff/{$memberId}/username", ['username' => 'MONA', 'password' => 'owner password 1'], $owner)->assertOk();
    expect($this->fx()->table('sync_ledger')->where('entity_id', $memberId)->count())->toBe(1);
});

test('auth_set_username: an active owner of the same organization only', function () {
    $org = IdentityHarness::org(bindDeviceKey: false);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage']);
    $memberId = IdentityHarness::member($org, 'assistant');
    $call = fn (?string $caller, array $payload) => $this->withMembership($this->asApp(), $caller, fn ($db) => $db->selectOne(
        'select auth_set_username(?::jsonb) as r', [json_encode($payload)],
    ));
    $payload = fn (string $target, string $username) => ['membership_id' => $target, 'username' => $username, 'audit_id' => (string) Str::uuid(), 'attempt_id' => 1];

    expect(fn () => $call($managerId, $payload($memberId, 'mona')))->toThrow(QueryException::class, 'auth: not allowed');
    expect(fn () => $call(null, $payload($memberId, 'mona')))->toThrow(QueryException::class, 'auth: not allowed');
    expect(fn () => $call($org['ownerId'], $payload($memberId, 'x')))->toThrow(QueryException::class, 'username must be');
    expect(fn () => $call($org['ownerId'], ['membership_id' => $memberId, 'username' => 'mona']))->toThrow(QueryException::class, 'payload must be exactly');

    $this->fx()->table('memberships')->where('id', $org['ownerId'])->update(['is_active' => false]);
    expect(fn () => $call($org['ownerId'], $payload($memberId, 'mona')))->toThrow(QueryException::class);
    expect($this->fx()->table('memberships')->where('id', $memberId)->value('username'))->toBeNull();
});

test('the step-up functions refuse without the caller\'s own succeeded step-up from the last two minutes', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $uuid = fn () => (string) Str::uuid();
    $attempt = function (string $membershipId, bool $succeeded, int $minutesAgo = 0, string $kind = 'step_up') use ($org) {
        return $this->fx()->table('login_attempts')->insertGetId([
            'org_id' => $org['orgId'], 'device_id' => $org['deviceId'], 'username' => 'x', 'membership_id' => $membershipId,
            'kind' => $kind, 'succeeded' => $succeeded, 'at' => now()->subMinutes($minutesAgo)->toIso8601String(),
        ]);
    };
    $reset = fn (int $attemptId) => $this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->select(
        'select auth_reset_member_password(?::jsonb)', [json_encode([
            'target_membership_id' => $memberId, 'temporary_hash' => Password::hash('temporary pw 1'), 'attempt_id' => $attemptId, 'audit_id' => $uuid(),
        ])],
    ));
    $setOwn = fn (string $caller, string $target, int $attemptId) => $this->withMembership($this->asApp(), $caller, fn ($db) => $db->select(
        'select auth_set_password(?::jsonb)', [json_encode([
            'membership_id' => $target, 'new_hash' => Password::hash('a new password 1'), 'attempt_id' => $attemptId, 'audit_id' => $uuid(),
        ])],
    ));

    expect(fn () => $reset($attempt($org['ownerId'], false)))->toThrow(QueryException::class, 'auth: not allowed');
    expect(fn () => $reset($attempt($org['ownerId'], true, 3)))->toThrow(QueryException::class, 'auth: not allowed');
    expect(fn () => $reset($attempt($org['ownerId'], true, 0, 'login')))->toThrow(QueryException::class, 'auth: not allowed');
    expect(fn () => $reset($attempt($memberId, true)))->toThrow(QueryException::class, 'auth: not allowed');
    // auth_set_password: only the caller's own password.
    expect(fn () => $setOwn($org['ownerId'], $memberId, $attempt($org['ownerId'], true)))->toThrow(QueryException::class, 'auth: not allowed');
    $setOwn($memberId, $memberId, $attempt($memberId, true));
    expect(Password::verify('a new password 1', $this->fx()->table('member_passwords')->where('membership_id', $memberId)->value('password_hash')))->toBeTrue();
});

test('auth_attempt_succeeded marks an attempt once, within two minutes, only for its own person or credential', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $attempt = fn (string $kind, int $minutesAgo = 0, ?string $membershipId = null) => $this->fx()->table('login_attempts')->insertGetId([
        'org_id' => $org['orgId'], 'device_id' => $org['deviceId'], 'username' => 'mona', 'membership_id' => $membershipId ?? $memberId,
        'kind' => $kind, 'at' => now()->subMinutes($minutesAgo)->toIso8601String(),
    ]);
    $mark = fn (?string $caller, int $id) => $this->withMembership($this->asApp(), $caller, fn ($db) => $db->select(
        'select auth_attempt_succeeded(?::jsonb)', [json_encode(['attempt_id' => $id])],
    ));
    $succeeded = fn (int $id) => $this->fx()->table('login_attempts')->where('id', $id)->value('succeeded');

    $stepUp = $attempt('step_up');
    expect(fn () => $mark($org['ownerId'], $stepUp))->toThrow(QueryException::class, 'auth: not allowed');
    $mark($memberId, $stepUp);
    expect($succeeded($stepUp))->toBeTrue();
    expect(fn () => $mark($memberId, $stepUp))->toThrow(QueryException::class, 'auth: not allowed');

    $stale = $attempt('step_up', 3);
    expect(fn () => $mark($memberId, $stale))->toThrow(QueryException::class, 'auth: not allowed');

    // A sign-in: only once its credential on that device exists, made after the attempt.
    $login = $attempt('login');
    expect(fn () => $mark($org['ownerId'], $login))->toThrow(QueryException::class, 'auth: not allowed');
    IdentityHarness::credential($org, $memberId);
    $mark($org['ownerId'], $login);
    expect($succeeded($login))->toBeTrue();

    // An unknown username's attempt never succeeds.
    $unknown = $this->fx()->table('login_attempts')->insertGetId(['org_id' => $org['orgId'], 'device_id' => $org['deviceId'], 'username' => 'ghost', 'kind' => 'login']);
    expect(fn () => $mark($org['ownerId'], $unknown))->toThrow(QueryException::class, 'auth: not allowed');
    expect($succeeded($stale))->toBeFalse();
});
