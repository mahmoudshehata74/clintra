<?php

use App\Models\Device;
use Illuminate\Support\Str;

/**
 * /api/isolation-probe exists purely to prove the ApplyMembership middleware
 * + set_config round-trip works over a real HTTP request, not just a direct
 * DB call (routes/api.php). Authenticates the same way a real device would:
 * a Sanctum-format bearer token whose abilities carry the membership id —
 * see ApplyMembership's own doc comment for why it verifies this by hand
 * instead of going through Laravel's auth:sanctum guard.
 */
function tokenForMembership(string $membershipId): string
{
    $device = new Device(['id' => (string) Str::uuid()]);

    return $device->createToken('test-device', ['membership:'.$membershipId])->plainTextToken;
}

test('isolation-probe echoes back the membership bound to a valid bearer token', function () {
    $membershipId = (string) Str::uuid();
    $token = tokenForMembership($membershipId);

    $response = $this->withToken($token)->getJson('/api/isolation-probe');

    $response->assertOk();
    $response->assertJson(['membership_id' => $membershipId]);
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

    $membershipId = (string) Str::uuid();

    $response = $this->withHeaders(['X-Membership-Id' => $membershipId])->getJson('/api/isolation-probe');

    // No token either, so this must fail exactly like "no credential at
    // all" — the header must not have been consulted.
    $response->assertStatus(401);
});

test('X-Membership-Id is honoured only when APP_ENV is local', function () {
    $this->app['env'] = 'local';

    $membershipId = (string) Str::uuid();

    $response = $this->withHeaders(['X-Membership-Id' => $membershipId])->getJson('/api/isolation-probe');

    $response->assertOk();
    $response->assertJson(['membership_id' => $membershipId]);
});
