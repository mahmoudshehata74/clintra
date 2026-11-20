<?php

use App\Support\Identity\Identity;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;
use Tests\Support\TestKey;

test('manual activation backfills only empty active memberships and records each change under its owner and device', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $practitioner = IdentityHarness::member($org, 'practitioner', [], 'doctor');
    $assistant = IdentityHarness::member($org, 'assistant', [], 'assistant');
    $manager = IdentityHarness::member($org, 'manager', [], 'manager');
    $custom = IdentityHarness::member($org, 'manager', ['staff.manage'], 'custom');
    $inactive = IdentityHarness::member($org, 'assistant', [], overrides: ['is_active' => false]);
    $revokedDevice = $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);
    $this->fx()->table('device')->where('id', $revokedDevice)->update(['revoked_at' => now()->toIso8601String()]);
    $activate = fn () => IdentityHarness::send($org, 'POST', '/api/auth/rollout/enable', ['password' => 'owner password 1'], $owner);
    $memberships = $this->fx()->table('memberships')->where('org_id', $org['orgId']);
    $revs = (clone $memberships)->pluck('rev', 'id');

    IdentityHarness::send($org, 'GET', '/api/auth/rollout', credential: $owner)
        ->assertOk()->assertJsonPath('ready', true)->assertJsonCount(5, 'members')->assertJsonCount(1, 'devices')
        ->assertJsonPath('devices.0.series', 1)->assertJsonPath('devices.0.location_id', $org['locationId'])
        ->assertJsonPath('identity_enforced_at', null);
    $at = $activate()->assertOk()->json('identity_enforced_at');
    expect($at)->toBeString();
    $common = ['reports.view', 'patients.archive', 'messages.send', 'cash.close'];
    $defaults = [$org['ownerId'] => Identity::PERMISSIONS, $practitioner => ['clinical.view', ...$common], $assistant => $common, $manager => $common];
    foreach ($defaults as $id => $permissions) {
        $member = (clone $memberships)->where('id', $id)->first();
        expect(Identity::parseTextArray($member->permissions))->toBe($permissions)
            ->and($member->rev)->toBe($revs[$id] + 1);
        $ledger = $this->fx()->table('sync_ledger')->where('entity_id', $id)->sole();
        expect([$ledger->org_id, $ledger->entity, $ledger->rev, $ledger->actor_membership_id, $ledger->device_id])
            ->toBe([$org['orgId'], 'memberships', $member->rev, $org['ownerId'], $org['deviceId']]);
        $audit = $this->fx()->table('audit_log')->where('entity_id', $id)->sole();
        expect($audit->actor_membership_id)->toBe($org['ownerId'])
            ->and(json_decode($audit->before, true))->toBe(['permissions' => []])
            ->and(json_decode($audit->after, true)['permissions'])->toBe($permissions)
            ->and(json_decode($audit->after, true)['identity_rollout'])->toBe('manual');
    }
    expect(Identity::parseTextArray((clone $memberships)->where('id', $custom)->value('permissions')))->toBe(['staff.manage'])
        ->and(Identity::parseTextArray((clone $memberships)->where('id', $inactive)->value('permissions')))->toBe([]);
    $activate()->assertOk()->assertJsonPath('identity_enforced_at', $at);
    expect($this->fx()->table('audit_log')->where('org_id', $org['orgId'])->count())->toBe(4)
        ->and($this->fx()->table('sync_ledger')->where('org_id', $org['orgId'])->count())->toBe(4)
        ->and($this->fx()->table('login_attempts')->where('org_id', $org['orgId'])->whereNotNull('consumed_at')->count())->toBe(1);
});

test('rollout refuses unready organizations with the specific Arabic reasons and leaves the step-up unused', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    IdentityHarness::member($org, 'assistant');
    $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);
    IdentityHarness::send($org, 'POST', '/api/auth/rollout/enable', ['password' => 'wrong'], $owner)->assertForbidden();
    IdentityHarness::send($org, 'POST', '/api/auth/rollout/enable', ['password' => 'owner password 1'], $owner)
        ->assertStatus(409)->assertJsonPath('error', 'rollout_not_ready')->assertJsonPath('ready', false)
        ->assertJsonPath('blockers', ['rolloutUsernamesMissing', 'rolloutDevicesUnbound'])
        ->assertJsonPath('message', 'يجب تعيين اسم مستخدم لكل موظف نشط. يجب تسجيل الدخول بكلمة المرور مرة واحدة على كل جهاز نشط.');
    expect($this->fx()->table('organizations')->where('id', $org['orgId'])->value('identity_enforced_at'))->toBeNull()
        ->and($this->fx()->table('login_attempts')->where('org_id', $org['orgId'])->where('succeeded', true)->sole()->consumed_at)->toBeNull()
        ->and($this->fx()->table('sync_ledger')->where('org_id', $org['orgId'])->count())->toBe(0);
    $this->fx()->table('member_passwords')->where('membership_id', $org['ownerId'])->delete();
    IdentityHarness::send($org, 'GET', '/api/auth/rollout', credential: $owner)
        ->assertOk()->assertJsonPath('blockers.0', 'rolloutOwnerMissing');
});

test('rollout endpoints are owner-only and neither endpoint can be pointed at another organization', function () {
    $org = IdentityHarness::org();
    $other = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $manager = IdentityHarness::credential($org, IdentityHarness::member($org, 'manager', ['staff.manage'], 'manager', 'manager password'));
    IdentityHarness::send($org, 'GET', '/api/auth/rollout')->assertUnauthorized();
    IdentityHarness::send($org, 'GET', '/api/auth/rollout', credential: $manager)->assertNotFound();
    IdentityHarness::send($org, 'POST', '/api/auth/rollout/enable', ['password' => 'manager password'], $manager)->assertNotFound();
    IdentityHarness::send($org, 'GET', '/api/auth/rollout?org_id='.$other['orgId'], credential: $owner)
        ->assertOk()->assertJsonCount(2, 'members')->assertJsonFragment(['id' => $org['ownerId']])->assertJsonMissing(['id' => $other['ownerId']]);
    IdentityHarness::send($org, 'POST', '/api/auth/rollout/enable', ['org_id' => $other['orgId'], 'password' => 'owner password 1'], $owner)->assertOk();
    expect($this->fx()->table('organizations')->where('id', $other['orgId'])->value('identity_enforced_at'))->toBeNull();

    expect(fn () => $this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->selectOne(
        'select auth_identity_rollout(?::jsonb)', [json_encode(['action' => 'automatic', 'org_id' => $other['orgId']])],
    )))->toThrow(QueryException::class, 'auth: not allowed');
});

test('automatic rollout waits for the deadline and readiness and uses the first owner recovery even after a password change', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $device = $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);
    $this->artisan('clintra:enforce-ready-identity')->assertSuccessful();
    $organization = $this->fx()->table('organizations')->where('id', $org['orgId']);
    expect((clone $organization)->value('identity_enforced_at'))->toBeNull();

    $audit = (string) Str::uuid();
    $this->fx()->table('audit_log')->insert([
        'id' => $audit, 'org_id' => $org['orgId'], 'actor_membership_id' => $org['ownerId'], 'entity' => 'member_passwords',
        'entity_id' => $org['ownerId'], 'action' => 'update', 'after' => json_encode(['recovered' => true]),
        'at' => now()->subDays(24)->toIso8601String(),
    ]);
    IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk()->assertJsonStructure(['identity_rollout_auto_at']);
    IdentityHarness::send($org, 'GET', '/api/sync/bootstrap')->assertOk()->assertJsonStructure(['identity_rollout_auto_at']);
    $this->artisan('clintra:enforce-ready-identity')->assertSuccessful();
    expect((clone $organization)->value('identity_enforced_at'))->toBeNull();

    $this->fx()->table('audit_log')->where('id', $audit)->update(['at' => now()->subDays(31)->toIso8601String()]);
    $this->artisan('clintra:enforce-ready-identity')->assertSuccessful();
    IdentityHarness::send($org, 'GET', '/api/auth/rollout', credential: $owner)
        ->assertOk()->assertJsonPath('waiting', true)->assertJsonPath('blockers', ['rolloutDevicesUnbound']);
    expect((clone $organization)->value('identity_enforced_at'))->toBeNull()
        ->and($this->fx()->table('sync_ledger')->where('org_id', $org['orgId'])->count())->toBe(0);

    $this->fx()->table('device')->where('id', $device)->update(['public_key' => json_encode(TestKey::make()->jwk), 'public_key_bound_at' => now()->toIso8601String()]);
    $this->artisan('clintra:enforce-ready-identity')->assertSuccessful();
    expect((clone $organization)->value('identity_enforced_at'))->not->toBeNull()
        ->and($this->fx()->table('sync_ledger')->where('org_id', $org['orgId'])->count())->toBe(1);
    expect(json_decode($this->fx()->table('audit_log')->where('org_id', $org['orgId'])->where('entity', 'memberships')->sole()->after, true)['identity_rollout'])
        ->toBe('automatic');
    IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk()->assertJsonMissingPath('identity_rollout_auto_at')->assertJsonStructure(['identity_enforced_at']);
});
