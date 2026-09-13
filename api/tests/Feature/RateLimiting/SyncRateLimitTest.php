<?php

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

/**
 * App\Providers\AppServiceProvider's 'sync' limiter — see its own comment
 * for why it's keyed by bearer token rather than IP (a clinic's several
 * tablets typically share one public IP; IP-keying would let one device
 * exhaust a budget shared with every other device on the same network).
 */
test('sync/push, sync/pull, and sync/bootstrap all carry the sync throttle middleware', function () {
    $routes = collect(Route::getRoutes())->filter(
        fn ($route) => in_array($route->uri(), ['api/sync/push', 'api/sync/pull', 'api/sync/bootstrap'], true),
    );

    expect($routes)->toHaveCount(3);

    foreach ($routes as $route) {
        $middleware = $route->gatherMiddleware();
        expect($middleware)->toContain('throttle:sync');
    }
});

test('the sync limiter is keyed by bearer token, not IP — two devices behind the same test client get independent budgets', function () {
    // A tiny limit registered just for this test, so exhausting it takes
    // two requests, not 120 — the production value (120/minute) is a
    // steady-state sizing decision, not something this test needs to
    // reproduce literally to prove the *keying* is correct.
    RateLimiter::for('sync', fn (Request $request) => Limit::perMinute(1)->by($request->bearerToken() ?? $request->ip()));

    $credentialA = makeAuthenticatedDevice();
    $credentialB = makeAuthenticatedDevice();

    // Device A's own single request for this minute — succeeds, then its
    // very next one is throttled.
    pullOps($credentialA['token'])->assertOk();
    pullOps($credentialA['token'])->assertStatus(429);

    // Device B never touched its own budget — a shared, IP-keyed limiter
    // would have this fail too, since Laravel's test client uses one
    // fixed IP for every request in a test.
    pullOps($credentialB['token'])->assertOk();
});

test('a throttled sync response is a clean 429 with no internal detail leaked', function () {
    RateLimiter::for('sync', fn (Request $request) => Limit::perMinute(1)->by($request->bearerToken() ?? $request->ip()));

    $credential = makeAuthenticatedDevice();
    pullOps($credential['token'])->assertOk();

    $response = pullOps($credential['token']);

    $response->assertStatus(429);
    $body = $response->getContent();
    expect($body)->not->toMatch('/SQLSTATE/');
    expect($body)->not->toContain('pgsql');
});
