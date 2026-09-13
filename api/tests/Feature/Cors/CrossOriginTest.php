<?php

/**
 * config/cors.php — see its own comments for why allowed_origins comes
 * from CORS_ALLOWED_ORIGINS (never hardcoded, never a wildcard) and why
 * allowed_headers lists Authorization explicitly rather than "*" (the
 * Fetch spec's wildcard never covers Authorization, preflight or not).
 * `phpunit.xml` sets CORS_ALLOWED_ORIGINS to a fixed real value
 * (https://clintra-web.example.com) for the whole test run — the CORS
 * middleware's CorsService is constructed once from config at boot, so
 * mutating config mid-test via Config::set() does not reliably change its
 * already-resolved allow-list; a real env value, present before boot,
 * does.
 *
 * Laravel's HandleCors middleware never rejects a request server-side —
 * it only conditionally adds the headers a browser needs to let
 * JavaScript read the response; a "disallowed" origin still gets an
 * ordinary response, just without Access-Control-Allow-Origin, which is
 * what actually makes the browser block it. These tests assert exactly
 * that distinction, not a 403.
 */
test('a request from the configured allowed origin gets Access-Control-Allow-Origin echoing that exact origin', function () {
    $response = $this->withHeaders(['Origin' => 'https://clintra-web.example.com'])->getJson('/api/health');

    $response->assertOk();
    $response->assertHeader('Access-Control-Allow-Origin', 'https://clintra-web.example.com');
});

test('a request from a disallowed origin gets no Access-Control-Allow-Origin header at all', function () {
    $response = $this->withHeaders(['Origin' => 'https://evil.example.com'])->getJson('/api/health');

    // Not rejected server-side — CORS is enforced by the browser refusing
    // to let script read a response with no matching ACAO header. The
    // request itself still succeeds; nothing here proves that on its own,
    // so the header's absence is the actual assertion.
    $response->assertOk();
    expect($response->headers->has('Access-Control-Allow-Origin'))->toBeFalse();
});

test('localhost dev origins are always allowed, alongside whatever CORS_ALLOWED_ORIGINS configures', function () {
    $response = $this->withHeaders(['Origin' => 'http://localhost:5173'])->getJson('/api/health');

    $response->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
});

test('a preflight for an authenticated sync request gets everything the browser needs, including Authorization', function () {
    $response = $this->withHeaders([
        'Origin' => 'https://clintra-web.example.com',
        'Access-Control-Request-Method' => 'POST',
        'Access-Control-Request-Headers' => 'authorization, content-type',
    ])->options('/api/sync/push');

    $response->assertHeader('Access-Control-Allow-Origin', 'https://clintra-web.example.com');
    $allowedMethods = $response->headers->get('Access-Control-Allow-Methods');
    expect($allowedMethods)->not->toBeNull();
    expect(strtoupper($allowedMethods))->toContain('POST');

    $allowedHeaders = strtolower((string) $response->headers->get('Access-Control-Allow-Headers'));
    expect($allowedHeaders)->toContain('authorization');
    expect($allowedHeaders)->not->toBe('*', 'a literal "*" never actually covers Authorization per the Fetch spec');
});

test('a preflight from a disallowed origin gets no Access-Control-Allow-Origin, so the browser refuses to proceed', function () {
    $response = $this->withHeaders([
        'Origin' => 'https://evil.example.com',
        'Access-Control-Request-Method' => 'POST',
        'Access-Control-Request-Headers' => 'authorization',
    ])->options('/api/sync/push');

    expect($response->headers->has('Access-Control-Allow-Origin'))->toBeFalse();
});
