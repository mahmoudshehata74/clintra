<?php

// bootstrap/app.php: ValidationException and AuthenticationException must
// render as 422/401 respectively, not fall through to the generic
// Throwable handler's 500 (neither has a getStatusCode() method, so both
// used to render as a bare "server_error" 500).
test('AuthenticationException renders as 401 JSON, not 500', function () {
    // /api/user's auth:sanctum middleware throws a real
    // Illuminate\Auth\AuthenticationException for an unauthenticated
    // request — a genuine, pre-existing route, not one built for this test.
    $response = $this->getJson('/api/user');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);
});

test('ValidationException renders as 422 JSON, not 500', function () {
    $response = $this->postJson('/api/devices/register', []);

    $response->assertStatus(422);
    $response->assertJson(['error' => 'validation_failed']);
    $response->assertJsonStructure(['error', 'message', 'errors']);
});
