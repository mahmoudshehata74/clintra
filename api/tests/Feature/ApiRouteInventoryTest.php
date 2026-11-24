<?php

use App\Models\Device;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\IdentityHarness;
use Tests\TestCase;

/**
 * Every route routes/api.php registers, and what it answers to a caller
 * with no token, with a revoked device token, and — where the route reads
 * or writes another organization's rows — with a valid token of another
 * organization. A route added to routes/api.php without an entry here
 * fails the first test, as does an entry whose route no longer exists.
 *
 * The other-organization checks never take a status alone as proof: each
 * also asserts that organization A's row is absent from B's response (or,
 * for a push, untouched).
 */

/**
 * A device of a fresh organization, its owner's token, and one patient and
 * one device audit row of that organization.
 *
 * @return array{token: string, orgId: string, locationId: string, membershipId: string, deviceId: string, patientId: string, auditRowId: string}
 */
function inventoryOrg(): array
{
    $test = test();
    $orgId = $test->makeOrganization('inventory-'.Str::random(6));
    $locationId = $test->makeLocation($orgId);
    $userId = $test->makeUser('inventory-user-'.Str::random(6));
    $membershipId = $test->makeMembership($userId, $orgId, ['role' => 'owner']);
    $deviceId = $test->makeDevice($orgId, $locationId, $membershipId);
    $token = (new Device(['id' => $deviceId]))->createToken('inventory-device', ['membership:'.$membershipId])->plainTextToken;

    return [
        'token' => $token,
        'orgId' => $orgId,
        'locationId' => $locationId,
        'membershipId' => $membershipId,
        'deviceId' => $deviceId,
        'patientId' => $test->makePatient($orgId, 'inventory patient'),
        'auditRowId' => $test->makeDeviceAuditLog($orgId, $membershipId, $deviceId),
    ];
}

/**
 * routes/api.php's routes, as "METHOD uri" (HEAD left out: Laravel adds it
 * to every GET).
 *
 * @return list<string>
 */
function registeredApiRoutes(): array
{
    return collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RoutingRoute $route) => in_array('api', $route->gatherMiddleware(), true))
        ->flatMap(fn (RoutingRoute $route) => collect($route->methods())
            ->reject(fn (string $method) => $method === 'HEAD')
            ->map(fn (string $method) => $method.' '.$route->uri()))
        ->sort()
        ->values()
        ->all();
}

/**
 * The inventory: each route's request body, its status with no token and
 * with a revoked token, and its other-organization check (null where the
 * route touches no organization's rows by id: registration and health
 * take no token, /user answers with the caller's own device, a staff add or
 * an audit push writes only into the caller's own organization, and the
 * identity routes other than the username act only for the caller or
 * behind a person proof of the caller's device).
 *
 * @return array<string, array{body: array<string, mixed>, unauthenticated: int, revoked: int, otherOrg: ?Closure}>
 */
function apiRouteInventory(): array
{
    $reads = fn (string $uri) => function (TestCase $test, array $orgA, array $orgB) use ($uri): void {
        $response = $test->withToken($orgB['token'])->getJson($uri);
        $response->assertOk();
        expect($response->getContent())
            ->not->toContain($orgA['orgId'])
            ->not->toContain($orgA['patientId'])
            ->not->toContain($orgA['auditRowId']);
    };

    return [
        'POST api/devices/register' => ['body' => [], 'unauthenticated' => 422, 'revoked' => 422, 'otherOrg' => null],
        'POST api/support/exchange' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'POST api/support/codes' => [
            'body' => [], 'unauthenticated' => 401, 'revoked' => 401,
            'otherOrg' => function (TestCase $test, array $orgA, array $orgB): void {
                $payload = ['id' => (string) Str::uuid(), 'code_hash' => hash('sha256', Str::random(32)),
                    'location_id' => $orgA['locationId'], 'support_hours' => 1,
                    'include_clinical' => false, 'audit_id' => (string) Str::uuid()];
                $test->withToken($orgB['token'])->postJson('/api/support/codes', $payload)->assertStatus(403);
                expect(test()->fx()->table('activation_codes')->where('id', $payload['id'])->exists())->toBeFalse();
            },
        ],
        'POST api/support/devices/{device}/end' => [
            'body' => [], 'unauthenticated' => 401, 'revoked' => 401,
            'otherOrg' => function (TestCase $test, array $orgA, array $orgB): void {
                $test->withToken($orgB['token'])->postJson('/api/support/devices/'.$orgA['deviceId'].'/end')
                    ->assertNotFound();
                expect(test()->fx()->table('device')->where('id', $orgA['deviceId'])->value('revoked_at'))->toBeNull();
            },
        ],
        'GET api/health' => ['body' => [], 'unauthenticated' => 200, 'revoked' => 200, 'otherOrg' => null],
        'GET api/user' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'GET api/isolation-probe' => [
            'body' => [],
            'unauthenticated' => 401,
            'revoked' => 401,
            'otherOrg' => function (TestCase $test, array $orgA, array $orgB): void {
                $response = $test->withToken($orgB['token'])->getJson('/api/isolation-probe');
                $response->assertOk();
                expect($response->json('visible_organization_ids'))->toBe([$orgB['orgId']]);
            },
        ],
        'POST api/sync/push' => [
            'body' => ['ops' => []],
            'unauthenticated' => 401,
            'revoked' => 401,
            'otherOrg' => function (TestCase $test, array $orgA, array $orgB): void {
                // B renames A's patient, naming its own organization and A's row id.
                $op = [
                    'op_id' => (string) Str::uuid(),
                    'entity' => 'patients',
                    'entity_id' => $orgA['patientId'],
                    'action' => 'update',
                    'base_rev' => 1,
                    'payload' => [
                        'id' => $orgA['patientId'],
                        'org_id' => $orgB['orgId'],
                        'full_name' => 'renamed by another org',
                        'created_at' => now()->toIso8601String(),
                    ],
                    'created_at' => now()->toIso8601String(),
                ];
                $response = $test->withToken($orgB['token'])->postJson('/api/sync/push', ['ops' => [$op]]);
                $response->assertOk();
                expect($response->json('results.0.status'))->not->toBe('accepted');
                expect(test()->fx()->table('patients')->where('id', $orgA['patientId'])->value('full_name'))->toBe('inventory patient');
                expect(test()->fx()->table('sync_ledger')->where('op_id', $op['op_id'])->exists())->toBeFalse();
            },
        ],
        'GET api/sync/pull' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => $reads('/api/sync/pull')],
        'GET api/sync/bootstrap' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => $reads('/api/sync/bootstrap')],
        'POST api/staff' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'POST api/audit/push' => ['body' => ['rows' => []], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'GET api/audit/pull' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => $reads('/api/audit/pull')],
        // Identity (A1). Resetting a password and revoking a credential need a
        // person proof of the caller's own device, so another organization's
        // token cannot even reach them; their cross-organization refusals with
        // a real proof are in tests/Feature/Identity.
        'POST api/auth/login' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'POST api/auth/password' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'POST api/auth/owner-recovery' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'GET api/auth/rollout' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'POST api/auth/rollout/enable' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'POST api/staff/{membership}/password-reset' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'DELETE api/staff/credentials/{credential}' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'GET api/staff/credentials' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'POST api/staff/{membership}' => ['body' => [], 'unauthenticated' => 401, 'revoked' => 401, 'otherOrg' => null],
        'PUT api/staff/{membership}/username' => [
            'body' => [],
            'unauthenticated' => 401,
            'revoked' => 401,
            'otherOrg' => function (TestCase $test, array $orgA, array $orgB): void {
                // B's owner names A's owner.
                $org = IdentityHarness::org();
                $owner = IdentityHarness::credential($org, $org['ownerId']);
                $response = IdentityHarness::send($org, 'PUT', '/api/staff/'.$orgA['membershipId'].'/username', [
                    'username' => 'taken.by.b', 'password' => 'owner password 1',
                ], $owner);
                $response->assertNotFound();
                expect(test()->fx()->table('memberships')->where('id', $orgA['membershipId'])->value('username'))->toBeNull();
            },
        ],
    ];
}

/** Sends `$route`'s request ("METHOD uri") with whatever headers the test case carries. */
function sendInventoryRequest(TestCase $test, string $route, array $body): TestResponse
{
    [$method, $uri] = explode(' ', $route, 2);

    return $test->json($method, '/'.$uri, $body);
}

test('every route in routes/api.php has an inventory entry, and every entry a route', function () {
    expect(registeredApiRoutes())->toBe(collect(array_keys(apiRouteInventory()))->sort()->values()->all());
});

test('each route answers a caller with no token as listed', function () {
    foreach (apiRouteInventory() as $route => $entry) {
        $this->flushHeaders();
        $status = sendInventoryRequest($this, $route, $entry['body'])->status();
        expect($status)->toBe($entry['unauthenticated'], "{$route} with no token");
    }
});

test('each route answers a revoked device token as listed', function () {
    $revoked = inventoryOrg();
    $this->artisan('clintra:revoke-device', ['device_id' => $revoked['deviceId']])->assertSuccessful();

    foreach (apiRouteInventory() as $route => $entry) {
        $this->flushHeaders();
        $status = sendInventoryRequest($this->withToken($revoked['token']), $route, $entry['body'])->status();
        expect($status)->toBe($entry['revoked'], "{$route} with a revoked token");
    }

    // The revocation's audit row (clintra:revoke-device writes one).
    $this->fx()->table('audit_log')->where('entity_id', $revoked['deviceId'])->delete();
});

test('a valid token of another organization never reads or writes its rows', function () {
    $orgA = inventoryOrg();
    $orgB = inventoryOrg();
    $checked = 0;

    foreach (apiRouteInventory() as $route => $entry) {
        if ($entry['otherOrg'] === null) {
            continue;
        }
        $this->flushHeaders();
        ($entry['otherOrg'])($this, $orgA, $orgB);
        $checked++;
    }

    expect($checked)->toBe(8);
});
