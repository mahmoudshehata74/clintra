<?php

use App\Models\Device;
use Illuminate\Support\Str;

/**
 * Builds a fully real, valid credential: org + location + active owner
 * membership + a real device row + a real Sanctum token bound to both —
 * everything ApplyMembership's hardened checks require to accept a
 * request. Tests that want to break exactly one thing (expire the token,
 * deactivate the membership, delete the device, move the membership to
 * another org, ...) start from this and mutate that one row afterward.
 *
 * @return array{token: string, tokenId: int, membershipId: string, deviceId: string, orgId: string, locationId: string, userId: string}
 */
function makeAuthenticatedDevice(array $membershipOverrides = []): array
{
    $test = test();
    $orgId = $test->makeOrganization('auth-org-'.Str::random(6));
    $locationId = $test->makeLocation($orgId);
    $userId = $test->makeUser('auth-user-'.Str::random(6));
    $membershipId = $test->makeMembership($userId, $orgId, array_merge(['role' => 'owner'], $membershipOverrides));
    $deviceId = $test->makeDevice($orgId, $locationId, $membershipId);

    $device = new Device(['id' => $deviceId]);
    $newToken = $device->createToken('test-device', ['membership:'.$membershipId]);

    return [
        'token' => $newToken->plainTextToken,
        'tokenId' => $newToken->accessToken->id,
        'membershipId' => $membershipId,
        'deviceId' => $deviceId,
        'orgId' => $orgId,
        'locationId' => $locationId,
        'userId' => $userId,
    ];
}

/**
 * /api/isolation-probe exists purely to prove the ApplyMembership middleware
 * + set_config round-trip works over a real HTTP request, not just a direct
 * DB call (routes/api.php). Authenticates the same way a real device would:
 * a Sanctum-format bearer token whose abilities carry the membership id —
 * see ApplyMembership's own doc comment for why it verifies this by hand
 * instead of going through Laravel's auth:sanctum guard.
 */
test('isolation-probe echoes back the membership bound to a valid bearer token', function () {
    $credential = makeAuthenticatedDevice();

    $response = $this->withToken($credential['token'])->getJson('/api/isolation-probe');

    $response->assertOk();
    $response->assertJson(['membership_id' => $credential['membershipId']]);
});

test('isolation-probe rejects a request with no token at all', function () {
    $response = $this->getJson('/api/isolation-probe');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);
});

test('isolation-probe rejects a malformed or unknown bearer token', function () {
    $response = $this->withToken('not-a-real-token')->getJson('/api/isolation-probe');

    $response->assertStatus(401);
});

test('X-Membership-Id is ignored when APP_ENV is not local', function () {
    expect(app()->environment())->toBe('testing');

    $credential = makeAuthenticatedDevice();

    $response = $this->withHeaders(['X-Membership-Id' => $credential['membershipId']])->getJson('/api/isolation-probe');

    // No token either, so this must fail exactly like "no credential at
    // all" — the header must not have been consulted.
    $response->assertStatus(401);
});

test('X-Membership-Id is honoured only when APP_ENV is local', function () {
    $this->app['env'] = 'local';

    $credential = makeAuthenticatedDevice();

    $response = $this->withHeaders(['X-Membership-Id' => $credential['membershipId']])->getJson('/api/isolation-probe');

    $response->assertOk();
    $response->assertJson(['membership_id' => $credential['membershipId']]);
});
