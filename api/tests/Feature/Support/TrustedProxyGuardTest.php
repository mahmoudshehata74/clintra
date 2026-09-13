<?php

use App\Support\TrustedProxyGuard;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

test('warns only for the exact combination: production environment and a literal wildcard', function () {
    expect(TrustedProxyGuard::shouldWarn('production', '*'))->toBeTrue();

    expect(TrustedProxyGuard::shouldWarn('local', '*'))->toBeFalse();
    expect(TrustedProxyGuard::shouldWarn('testing', '*'))->toBeFalse();
    expect(TrustedProxyGuard::shouldWarn('staging', '*'))->toBeFalse();
    expect(TrustedProxyGuard::shouldWarn('production', ['10.0.0.0/8']))->toBeFalse();
    expect(TrustedProxyGuard::shouldWarn('production', null))->toBeFalse();
    expect(TrustedProxyGuard::shouldWarn('production', '**'))->toBeFalse();
});

test('currentlyConfiguredProxies() reflects what bootstrap/app.php actually configured — proof the guard is not reading a stale assumption', function () {
    // bootstrap/app.php calls trustProxies(at: '*') unconditionally, for
    // every environment (Laravel's TrustProxies::at() has no environment
    // gate of its own) — so this is true here in the test environment
    // too, which is exactly what makes this a check on the real wiring,
    // not a mock of it.
    expect(TrustedProxyGuard::currentlyConfiguredProxies())->toBe('*');
});

test('warnIfNeeded() stays quiet in the real test environment (APP_ENV=testing, never production)', function () {
    Cache::forget('trusted-proxy-guard:wildcard-warning-logged');
    Log::spy();

    TrustedProxyGuard::warnIfNeeded();

    Log::shouldNotHaveReceived('warning');
});

test('warnIfNeeded() actually logs when forced into the true-condition path (production + wildcard)', function () {
    Cache::forget('trusted-proxy-guard:wildcard-warning-logged');
    Log::spy();

    TrustedProxyGuard::warnIfNeeded('production', '*');

    Log::shouldHaveReceived('warning')->once();
});

test('warnIfNeeded() logs at most once, even across repeated calls — the dedup guard against per-request boot spam', function () {
    // The real dedup mechanism (Cache::add), exercised against the real
    // method with the condition forced true — not a copy of the logic.
    Cache::forget('trusted-proxy-guard:wildcard-warning-logged');
    Log::spy();

    TrustedProxyGuard::warnIfNeeded('production', '*');
    TrustedProxyGuard::warnIfNeeded('production', '*');
    TrustedProxyGuard::warnIfNeeded('production', '*');

    Log::shouldHaveReceived('warning')->once();
});
