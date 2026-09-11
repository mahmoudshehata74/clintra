<?php

use Illuminate\Support\Str;

// /api/isolation-probe exists purely to prove the ApplyMembership middleware
// + set_config round-trip works over a real HTTP request, not just a direct
// DB call (routes/api.php).
test('isolation-probe echoes back a valid X-Membership-Id', function () {
    $membershipId = (string) Str::uuid();

    $response = $this->withHeaders(['X-Membership-Id' => $membershipId])
        ->getJson('/api/isolation-probe');

    $response->assertOk();
    $response->assertJson(['membership_id' => $membershipId]);
});

test('isolation-probe rejects a request with no X-Membership-Id header', function () {
    $response = $this->getJson('/api/isolation-probe');

    $response->assertStatus(400);
    $response->assertJson(['error' => 'membership_required']);
});
