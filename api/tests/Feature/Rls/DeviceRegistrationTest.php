<?php

use App\Support\ActivationCode;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Builds an org + location + active owner membership + one valid,
 * unexpired, unused activation code — everything register_device(jsonb)
 * needs to succeed — via the fixtures connection, bypassing
 * clintra:provision entirely (that command's own path is already covered
 * by tests/Feature/Rls/ProvisioningTest.php; these tests are about the
 * HTTP registration endpoint, not provisioning).
 *
 * @return array{orgId: string, locationId: string, userId: string, phone: string, membershipId: string, plainCode: string, codeId: string}
 */
function makeRegistrationFixture(array $codeOverrides = []): array
{
    $test = test();

    $orgId = $test->makeOrganization('reg-org-'.Str::random(6));
    $locationId = $test->makeLocation($orgId);
    $userId = $test->makeUser('reg-owner-'.Str::random(6));
    // National number must match EgyptianPhone's mobile pattern
    // (1[0125]\d{8}) — fixed "10" prefix plus 8 random digits guarantees a
    // valid shape regardless of what random_int() returns.
    $phone = '+2010'.str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
    $test->fx()->table('users')->where('id', $userId)->update(['phone' => $phone]);
    $membershipId = $test->makeMembership($userId, $orgId, ['role' => 'owner', 'is_active' => true]);

    $plainCode = ActivationCode::generate();
    $codeId = $test->makeActivationCode($orgId, $locationId, $plainCode, $codeOverrides);

    return compact('orgId', 'locationId', 'userId', 'phone', 'membershipId', 'plainCode', 'codeId');
}

beforeEach(function () {
    RateLimiter::clear('device-register:ip:127.0.0.1');
});

test('happy path registers and returns a usable token plus bootstrap data', function () {
    $fixture = makeRegistrationFixture();
    $deviceId = (string) Str::uuid();

    $response = $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => $deviceId,
    ]);

    $response->assertOk();
    $response->assertJsonStructure([
        'token', 'device_id', 'org_id', 'location_id', 'membership_id',
        'organization', 'locations', 'practitioners', 'memberships', 'users',
    ]);

    $token = $response->json('token');
    expect($token)->toBeString();

    // The four scalar ids the web client cannot derive any other way (it
    // already knows device_id — it minted it — but not which org/location/
    // membership the activation code just resolved it to) — see
    // docs/auth-plan.md's registration credential resolution and
    // web/src/db/deviceRegistration.ts's bootstrap, which binds the local
    // device row from exactly these four fields.
    expect($response->json('device_id'))->toBe($deviceId);
    expect($response->json('org_id'))->toBe($fixture['orgId']);
    expect($response->json('location_id'))->toBe($fixture['locationId']);
    expect($response->json('membership_id'))->toBe($fixture['membershipId']);

    // organization/locations/memberships in the response actually match
    // this org — including the membership's pin_hash/pin_salt, per
    // docs/auth-plan.md's registration credential resolution.
    expect($response->json('organization.id'))->toBe($fixture['orgId']);
    expect(collect($response->json('locations'))->pluck('id')->all())->toBe([$fixture['locationId']]);
    $membershipsInResponse = collect($response->json('memberships'));
    expect($membershipsInResponse->pluck('id')->all())->toBe([$fixture['membershipId']]);
    expect($membershipsInResponse->first())->toHaveKeys(['pin_hash', 'pin_salt', 'rev']);
    // rev must be the row's real server value (1, fresh from provisioning),
    // not a placeholder — see 2026_09_12_000019_add_rev_to_register_device_response.php's
    // own doc comment for why guessing this would be a real bug.
    expect($membershipsInResponse->first()['rev'])->toBe(1);

    // The user the registering owner's own membership points at is in the
    // payload too — web/src/auth/LockScreen.tsx joins memberships to users
    // by user_id to label the PIN picker; without this a freshly
    // registered device's picker would have no name to show.
    $usersInResponse = collect($response->json('users'));
    expect($usersInResponse->pluck('id')->all())->toBe([$fixture['userId']]);
    expect($usersInResponse->first())->toHaveKeys(['full_name', 'phone', 'email', 'is_active']);

    // The token actually works, end to end over HTTP, and resolves to the
    // registering owner's own membership.
    $probe = $this->withToken($token)->getJson('/api/isolation-probe');
    $probe->assertOk();
    $probe->assertJson(['membership_id' => $fixture['membershipId']]);
    expect($probe->json('visible_organization_ids'))->toBe([$fixture['orgId']]);

    // The code and device row are consumed correctly.
    $codeRow = $this->fx()->table('activation_codes')->where('id', $fixture['codeId'])->first();
    expect($codeRow->used_at)->not->toBeNull();
    expect($codeRow->used_by_device_id)->toBe($deviceId);

    $deviceRow = $this->fx()->table('device')->where('id', $deviceId)->first();
    expect($deviceRow)->not->toBeNull();
    expect($deviceRow->org_id)->toBe($fixture['orgId']);
    expect($deviceRow->location_id)->toBe($fixture['locationId']);
    expect($deviceRow->membership_id)->toBe($fixture['membershipId']);

    // Null the FK before deleting device, so afterEach's cleanup of the
    // tracked activation_codes row (which now points at this device)
    // doesn't hit a foreign key violation.
    $this->fx()->table('activation_codes')->where('id', $fixture['codeId'])->update(['used_by_device_id' => null]);
    $this->fx()->table('device')->where('id', $deviceId)->delete();
    $this->fx()->table('audit_log')->where('org_id', $fixture['orgId'])->delete();
});

test('a wrong activation code fails with the generic error and status', function () {
    $fixture = makeRegistrationFixture();

    $response = $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => 'CLT-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertStatus(401);
    $response->assertJson(['error' => 'registration_failed']);
});

test('an expired activation code fails with the same generic error and status', function () {
    $fixture = makeRegistrationFixture(['expires_at' => now()->subMinute()]);

    $response = $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertStatus(401);
    $response->assertJson(['error' => 'registration_failed']);
});

test('an already-used activation code fails with the same generic error and status', function () {
    $fixture = makeRegistrationFixture(['used_at' => now()->subMinute()]);

    $response = $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertStatus(401);
    $response->assertJson(['error' => 'registration_failed']);
});

test('a phone not matching the code\'s org owner fails with the same generic error and status', function () {
    $fixture = makeRegistrationFixture();

    $response = $this->postJson('/api/devices/register', [
        'phone' => '+201099999999',
        'activation_code' => $fixture['plainCode'],
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertStatus(401);
    $response->assertJson(['error' => 'registration_failed']);
});

test('the owner phone from a DIFFERENT org fails with the same generic error and status', function () {
    $fixture = makeRegistrationFixture();
    $otherOrgFixture = makeRegistrationFixture();

    // otherOrgFixture's phone is real and belongs to an active owner
    // membership — just not in fixture's org, which is what the code
    // actually points at.
    $response = $this->postJson('/api/devices/register', [
        'phone' => $otherOrgFixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertStatus(401);
    $response->assertJson(['error' => 'registration_failed']);
});

test('bad payload shape fails with 422, not the generic 401', function () {
    $response = $this->postJson('/api/devices/register', [
        'phone' => '01000000001',
        'activation_code' => 'not-a-real-code-format',
        'device_id' => 'not-a-uuid',
    ]);

    $response->assertStatus(422);
    $response->assertJson(['error' => 'validation_failed']);
});

test('an unparseable phone fails with 422 via a validated message, not the generic 401', function () {
    $fixture = makeRegistrationFixture();

    $response = $this->postJson('/api/devices/register', [
        'phone' => 'not-a-phone-at-all',
        'activation_code' => $fixture['plainCode'],
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertStatus(422);
});

test('the rate limit trips after repeated failed attempts from the same IP', function () {
    $fixture = makeRegistrationFixture();

    for ($i = 0; $i < 5; $i++) {
        $response = $this->postJson('/api/devices/register', [
            'phone' => $fixture['phone'],
            'activation_code' => 'CLT-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
            'device_id' => (string) Str::uuid(),
        ]);
        $response->assertStatus(401);
    }

    $response = $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => (string) Str::uuid(),
    ]);

    $response->assertStatus(429);
    $response->assertJson(['error' => 'too_many_attempts']);
});

test('a failed registration writes no code fragment to the log', function () {
    $fixture = makeRegistrationFixture();
    $logPath = storage_path('logs/laravel.log');
    $before = file_exists($logPath) ? filesize($logPath) : 0;

    $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => 'CLT-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
        'device_id' => (string) Str::uuid(),
    ])->assertStatus(401);

    if (! file_exists($logPath)) {
        expect(true)->toBeTrue();

        return;
    }

    $appended = file_get_contents($logPath, offset: $before);
    expect($appended)->not->toContain($fixture['plainCode']);
    expect($appended)->not->toContain('CLT-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    expect($appended)->not->toContain(ActivationCode::hash($fixture['plainCode']));
});

/**
 * The full list the user asked to confirm never reaches the log: activation
 * codes (covered above, in isolation), plaintext tokens, token hashes,
 * pin_hash, pin_salt, and DB passwords. A *successful* registration is the
 * one request that actually carries all of these at once — the response
 * body legitimately contains the token and the membership's pin_hash/
 * pin_salt (docs/auth-plan.md), which is exactly why it's the request most
 * likely to leak one of them into a log line if something upstream ever
 * starts logging request/response bodies.
 */
test('a successful registration writes none of its secret material to the log', function () {
    $fixture = makeRegistrationFixture();
    $deviceId = (string) Str::uuid();
    $logPath = storage_path('logs/laravel.log');
    $before = file_exists($logPath) ? filesize($logPath) : 0;

    $response = $this->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => $deviceId,
    ]);

    $response->assertOk();

    $token = $response->json('token');
    [$tokenId, $plainTextToken] = explode('|', $token, 2);
    $membership = collect($response->json('memberships'))->firstWhere('id', $fixture['membershipId']);

    // Cleanup mirrors the happy-path test above — this test's own insert
    // must not leak into other tests' fixture expectations.
    $this->fx()->table('activation_codes')->where('id', $fixture['codeId'])->update(['used_by_device_id' => null]);
    $this->fx()->table('device')->where('id', $deviceId)->delete();
    $this->fx()->table('audit_log')->where('org_id', $fixture['orgId'])->delete();

    if (! file_exists($logPath)) {
        expect(true)->toBeTrue();

        return;
    }

    $appended = file_get_contents($logPath, offset: $before);

    expect($appended)->not->toContain($fixture['plainCode']);
    expect($appended)->not->toContain(ActivationCode::hash($fixture['plainCode']));
    expect($appended)->not->toContain($plainTextToken);
    expect($appended)->not->toContain(hash('sha256', $plainTextToken));
    expect($appended)->not->toContain($membership['pin_hash']);
    expect($appended)->not->toContain($membership['pin_salt']);

    foreach (['pgsql', 'pgsql_owner', 'pgsql_fixtures'] as $connection) {
        $password = config("database.connections.$connection.password");

        if ($password !== null && $password !== '') {
            expect($appended)->not->toContain($password);
        }
    }
});
