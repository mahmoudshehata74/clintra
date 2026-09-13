<?php

use App\Support\ActivationCode;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * The third registration rate-limiting layer — see
 * 2026_09_12_000022_add_resolve_registration_org_function.php and
 * App\Http\Controllers\DeviceRegistrationController for the design.
 * Keyed by org (resolved from the phone, since these attempts use a
 * fresh wrong code every time — never the code, which is exactly the
 * point: the code-keyed limiter above only ever bounds repeats against
 * *one* code, never many different ones against the same org).
 */
function attemptRegistrationWithFakeSource(array $fixture, string $fakeIp): TestResponse
{
    return test()->withHeaders(['X-Forwarded-For' => $fakeIp])->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        // A fresh, real-format, but never-actually-issued code every call —
        // never repeats, so the code-keyed limiter (5/15min) never trips on
        // its own here; only the org-keyed one (30/day) can.
        'activation_code' => ActivationCode::generate(),
        'device_id' => (string) Str::uuid(),
    ]);
}

beforeEach(function () {
    RateLimiter::clear('device-register:ip:127.0.0.1');
});

/**
 * A real, successful POST /api/devices/register writes rows
 * (device/activation_codes.used_by_device_id/audit_log) that
 * makeRegistrationFixture()'s own fixture tracking never sees — matches
 * the identical cleanup DeviceRegistrationTest.php's own successful-path
 * tests already do.
 */
function cleanupSuccessfulRegistration(string $orgId, string $codeId, string $deviceId): void
{
    test()->fx()->table('activation_codes')->where('id', $codeId)->update(['used_by_device_id' => null]);
    test()->fx()->table('device')->where('id', $deviceId)->delete();
    test()->fx()->table('audit_log')->where('org_id', $orgId)->delete();
}

test('the org limit trips after 30 failed attempts, each from a different (forged) source IP and a different code', function () {
    $fixture = makeRegistrationFixture();

    for ($i = 0; $i < 30; $i++) {
        $response = attemptRegistrationWithFakeSource($fixture, "10.0.0.{$i}");
        $response->assertStatus(401);
    }

    // The 31st, from yet another fresh IP — trustProxies(at: '*') means
    // this header is trusted exactly as a real forwarded client would be,
    // proving the org layer isn't relying on IP identity at all.
    $response = attemptRegistrationWithFakeSource($fixture, '10.0.0.99');

    $response->assertStatus(429);
    $response->assertJson(['error' => 'too_many_attempts']);
});

test('the org-limited response is byte-identical in shape to the IP/code-limited one — never "this org is locked"', function () {
    $fixture = makeRegistrationFixture();

    for ($i = 0; $i < 30; $i++) {
        attemptRegistrationWithFakeSource($fixture, "10.0.1.{$i}");
    }
    $orgLimited = attemptRegistrationWithFakeSource($fixture, '10.0.1.99');

    $ipLimitedFixture = makeRegistrationFixture();
    for ($i = 0; $i < 5; $i++) {
        test()->postJson('/api/devices/register', [
            'phone' => $ipLimitedFixture['phone'],
            'activation_code' => 'CLT-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
            'device_id' => (string) Str::uuid(),
        ]);
    }
    $ipLimited = test()->postJson('/api/devices/register', [
        'phone' => $ipLimitedFixture['phone'],
        'activation_code' => 'CLT-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
        'device_id' => (string) Str::uuid(),
    ]);

    $orgLimited->assertStatus(429);
    $ipLimited->assertStatus(429);
    // Byte-identical response bodies — a distinct "this org is locked"
    // message would itself confirm the org exists, the exact oracle this
    // endpoint's generic-failure design refuses to open anywhere else.
    expect($orgLimited->json())->toEqual($ipLimited->json());
});

test('a legitimate install-day sequence of several successful registrations for one org never trips the org limit', function () {
    $fixture = makeRegistrationFixture();
    $registered = [];

    // The clinic's own owner registering several real devices in a row —
    // front desk tablet, a second tablet, the doctor's phone — each with
    // its own freshly minted, genuinely valid code.
    for ($i = 0; $i < 6; $i++) {
        $code = ActivationCode::generate();
        $codeId = test()->makeActivationCode($fixture['orgId'], $fixture['locationId'], $code);
        $deviceId = (string) Str::uuid();

        $response = test()->postJson('/api/devices/register', [
            'phone' => $fixture['phone'],
            'activation_code' => $code,
            'device_id' => $deviceId,
        ]);

        $response->assertOk();
        $registered[] = [$codeId, $deviceId];
    }

    foreach ($registered as [$codeId, $deviceId]) {
        cleanupSuccessfulRegistration($fixture['orgId'], $codeId, $deviceId);
    }
});

test('a few mistyped codes on install day, mixed with real successes, still stay far under the org ceiling', function () {
    $fixture = makeRegistrationFixture();

    // Two typo'd attempts, then a real one succeeds — a realistic single
    // device's worth of install-day friction.
    for ($i = 0; $i < 2; $i++) {
        attemptRegistrationWithFakeSource($fixture, "10.0.2.{$i}")->assertStatus(401);
    }

    $deviceId = (string) Str::uuid();
    $response = test()->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => $deviceId,
    ]);

    $response->assertOk();
    cleanupSuccessfulRegistration($fixture['orgId'], $fixture['codeId'], $deviceId);
});

test('the org lockout clears via the artisan command, without waiting 24 hours', function () {
    $fixture = makeRegistrationFixture();

    for ($i = 0; $i < 30; $i++) {
        attemptRegistrationWithFakeSource($fixture, "10.0.3.{$i}");
    }
    attemptRegistrationWithFakeSource($fixture, '10.0.3.99')->assertStatus(429);

    Artisan::call('clintra:clear-registration-lockout', ['org_id' => $fixture['orgId']]);

    // A genuinely valid registration for the same org, from yet another
    // fresh IP, now succeeds — the lockout is gone, not just delayed.
    $deviceId = (string) Str::uuid();
    $response = test()->withHeaders(['X-Forwarded-For' => '10.0.3.100'])->postJson('/api/devices/register', [
        'phone' => $fixture['phone'],
        'activation_code' => $fixture['plainCode'],
        'device_id' => $deviceId,
    ]);

    $response->assertOk();
    cleanupSuccessfulRegistration($fixture['orgId'], $fixture['codeId'], $deviceId);
});

test('tripping the org limit logs a security event with the org id, never the phone or the code', function () {
    $fixture = makeRegistrationFixture();
    Log::spy();

    for ($i = 0; $i < 30; $i++) {
        attemptRegistrationWithFakeSource($fixture, "10.0.4.{$i}");
    }
    attemptRegistrationWithFakeSource($fixture, '10.0.4.99')->assertStatus(429);

    Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context) use ($fixture) {
        return $message === 'registration_org_rate_limited'
            && $context['org_id'] === $fixture['orgId']
            && ! str_contains(json_encode($context), $fixture['phone'])
            && ! str_contains(json_encode($context), $fixture['plainCode']);
    })->atLeast()->once();
});
