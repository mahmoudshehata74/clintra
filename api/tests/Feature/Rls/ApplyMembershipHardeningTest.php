<?php

test('the token comparison is timing-safe (hash_equals), not a loose equality operator', function () {
    $source = file_get_contents(app_path('Http/Middleware/ApplyMembership.php'));

    expect($source)->toContain('hash_equals(');
    expect($source)->not->toMatch('/\$row->token\s*===?\s*hash\(/');
});

test('an expired token is rejected', function () {
    $credential = makeAuthenticatedDevice();

    $this->asOwner()->table('personal_access_tokens')
        ->where('id', $credential['tokenId'])
        ->update(['expires_at' => now()->subMinute()->toIso8601String()]);

    $response = $this->withToken($credential['token'])->getJson('/api/isolation-probe');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);

    $this->asOwner()->table('personal_access_tokens')->where('id', $credential['tokenId'])->delete();
});

test('a revoked (deleted) token is rejected', function () {
    $credential = makeAuthenticatedDevice();

    $this->asOwner()->table('personal_access_tokens')->where('id', $credential['tokenId'])->delete();

    $response = $this->withToken($credential['token'])->getJson('/api/isolation-probe');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);
});

test('a token whose device row has been deleted is rejected', function () {
    $credential = makeAuthenticatedDevice();

    $this->fx()->table('device')->where('id', $credential['deviceId'])->delete();

    $response = $this->withToken($credential['token'])->getJson('/api/isolation-probe');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);

    $this->asOwner()->table('personal_access_tokens')->where('id', $credential['tokenId'])->delete();
});

test('a token whose membership has is_active = false is rejected', function () {
    $credential = makeAuthenticatedDevice();

    $this->fx()->table('memberships')->where('id', $credential['membershipId'])->update(['is_active' => false]);

    $response = $this->withToken($credential['token'])->getJson('/api/isolation-probe');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);

    $this->asOwner()->table('personal_access_tokens')->where('id', $credential['tokenId'])->delete();
});

test('a token whose membership was moved to another org reads the new org, never the old one', function () {
    $credential = makeAuthenticatedDevice();
    $otherOrgId = $this->makeOrganization('moved-to-org');

    $this->fx()->table('memberships')->where('id', $credential['membershipId'])->update(['org_id' => $otherOrgId]);

    $response = $this->withToken($credential['token'])->getJson('/api/isolation-probe');

    $response->assertOk();
    $response->assertJson(['membership_id' => $credential['membershipId']]);
    expect($response->json('visible_organization_ids'))->toBe([$otherOrgId]);
    expect($response->json('visible_organization_ids'))->not->toContain($credential['orgId']);

    $this->asOwner()->table('personal_access_tokens')->where('id', $credential['tokenId'])->delete();
});

test('a malformed Authorization header never renders as 500', function (string $header) {
    $response = $this->withHeaders(['Authorization' => $header])->getJson('/api/isolation-probe');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);
})->with([
    'no Bearer prefix' => ['sometoken123'],
    'empty' => [''],
    'Bearer with empty value' => ['Bearer '],
    'wrong id format (non-numeric)' => ['Bearer abc|xyz'],
    'wrong id format (huge number)' => ['Bearer 99999999999999999999999999|xyz'],
    'no pipe separator at all' => ['Bearer justarandomstring'],
    'empty token half' => ['Bearer 1|'],
]);
