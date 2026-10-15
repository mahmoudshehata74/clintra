<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * POST /api/staff and add_staff_member(jsonb) — see
 * App\Http\Controllers\StaffController and
 * 2026_09_12_000032_add_staff_member_function.php. An owner adds a staff
 * member in one step, online; everything else is refused, and a refusal
 * over HTTP is 404, never 403.
 */
function egyptianMobile(): string
{
    return '+2010'.str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function staffPayload(array $overrides = []): array
{
    return array_merge([
        'membership_id' => (string) Str::uuid(),
        'user_id' => (string) Str::uuid(),
        'display_name' => 'منى الجديدة',
        'phone' => egyptianMobile(),
        'role' => 'assistant',
        'location_scope' => 'all',
        'practitioner_scope' => 'all',
        'practitioner_id' => null,
        'pin_hash' => str_repeat('ab', 32),
        'pin_salt' => str_repeat('cd', 16),
        'locations' => [],
        'practitioners' => [],
    ], $overrides);
}

function postStaff(string $token, array $payload)
{
    $response = test()->withToken($token)->postJson('/api/staff', $payload);
    test()->adoptAddedStaff($payload['membership_id'], $payload['user_id']);

    return $response;
}

/** Calls the function directly as clintra_app, inside the given membership's session. */
function callAddStaffMember(?string $membershipId, array $payload): object
{
    try {
        return test()->withMembership(test()->asApp(), $membershipId, fn ($connection) => $connection->selectOne(
            'select add_staff_member(?::jsonb) as result',
            [json_encode($payload, JSON_THROW_ON_ERROR)],
        ));
    } finally {
        // A payload whose ids are not uuids wrote nothing to adopt.
        if (Str::isUuid($payload['membership_id'] ?? null)) {
            test()->adoptAddedStaff($payload['membership_id'], Str::isUuid($payload['user_id'] ?? null) ? $payload['user_id'] : null);
        }
    }
}

/** The function's own payload: the endpoint's, plus the server-minted audit id. */
function functionPayload(array $overrides = []): array
{
    return array_merge(staffPayload(), ['audit_id' => (string) Str::uuid()], $overrides);
}

function expectNothingAdded(array $payload): void
{
    if (! Str::isUuid($payload['membership_id']) || ! Str::isUuid($payload['user_id'])) {
        expect(test()->fx()->table('audit_log')->where('entity', 'memberships')->where('at', '>=', now()->subMinute())
            ->whereRaw("after->>'display_name' = ?", [$payload['display_name']])->exists())->toBeFalse();

        return;
    }
    expect(test()->fx()->table('memberships')->where('id', $payload['membership_id'])->exists())->toBeFalse();
    expect(test()->fx()->table('users')->where('id', $payload['user_id'])->exists())->toBeFalse();
    expect(test()->fx()->table('audit_log')->where('entity_id', $payload['membership_id'])->exists())->toBeFalse();
    expect(test()->fx()->table('sync_ledger')->where('entity_id', $payload['membership_id'])->exists())->toBeFalse();
}

function expectNotFound($response): void
{
    $response->assertStatus(404);
    $response->assertExactJson(['error' => 'not_found', 'message' => 'لم يتم العثور على المورد']);
}

test('an owner adds a new phone: user, membership, links, audit and ledger rows in one step', function () {
    $credential = makeAuthenticatedDevice();
    $secondLocationId = $this->makeLocation($credential['orgId'], 'second');
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($credential['orgId'], $specialtyId);
    $locationLinkId = (string) Str::uuid();
    $practitionerLinkId = (string) Str::uuid();
    $payload = staffPayload([
        // A local number: the endpoint normalises it, as registration does.
        'phone' => '0101'.str_pad((string) random_int(0, 9999999), 7, '0', STR_PAD_LEFT),
        'location_scope' => 'listed',
        'practitioner_scope' => 'listed',
        'locations' => [['id' => $locationLinkId, 'location_id' => $secondLocationId]],
        'practitioners' => [['id' => $practitionerLinkId, 'practitioner_id' => $practitionerId]],
    ]);

    $response = postStaff($credential['token'], $payload);

    $response->assertCreated();
    $response->assertExactJson([
        'membership' => [
            'id' => $payload['membership_id'],
            'user_id' => $payload['user_id'],
            'org_id' => $credential['orgId'],
            'role' => 'assistant',
            'location_scope' => 'listed',
            'practitioner_scope' => 'listed',
            'practitioner_id' => null,
            'pin_hash' => $payload['pin_hash'],
            'pin_salt' => $payload['pin_salt'],
            'is_active' => true,
            'display_name' => 'منى الجديدة',
            'rev' => 1,
        ],
        'membership_locations' => [
            ['id' => $locationLinkId, 'membership_id' => $payload['membership_id'], 'location_id' => $secondLocationId, 'rev' => 1],
        ],
        'membership_practitioners' => [
            ['id' => $practitionerLinkId, 'membership_id' => $payload['membership_id'], 'practitioner_id' => $practitionerId, 'rev' => 1],
        ],
    ]);

    $user = $this->fx()->table('users')->where('id', $payload['user_id'])->first();
    expect($user->full_name)->toBe('منى الجديدة');
    expect($user->phone)->toBe('+20'.substr($payload['phone'], 1));

    $membership = $this->fx()->table('memberships')->where('id', $payload['membership_id'])->first();
    expect($membership->org_id)->toBe($credential['orgId']);
    expect($membership->display_name)->toBe('منى الجديدة');
    expect($membership->rev)->toBe(1);

    expect($this->fx()->table('membership_locations')->where('id', $locationLinkId)->value('location_id'))->toBe($secondLocationId);
    expect($this->fx()->table('membership_practitioners')->where('id', $practitionerLinkId)->value('practitioner_id'))->toBe($practitionerId);

    $audit = $this->fx()->table('audit_log')->where('entity_id', $payload['membership_id'])->get();
    expect($audit)->toHaveCount(1);
    expect($audit[0]->actor_membership_id)->toBe($credential['membershipId']);
    expect($audit[0]->entity)->toBe('memberships');
    expect($audit[0]->action)->toBe('create');
    $after = json_decode($audit[0]->after, true);
    expect($after)->not->toHaveKey('pin_hash');
    expect($after)->not->toHaveKey('pin_salt');
    expect($after['display_name'])->toBe('منى الجديدة');
    expect($after['location_ids'])->toBe([$secondLocationId]);
    expect($after['practitioner_ids'])->toBe([$practitionerId]);

    // The organization's other devices pull the new rows like any pushed write.
    $ledger = $this->fx()->table('sync_ledger')
        ->whereIn('entity_id', [$payload['membership_id'], $locationLinkId, $practitionerLinkId])
        ->orderBy('entity')->get();
    expect($ledger->pluck('entity')->all())->toBe(['membership_locations', 'membership_practitioners', 'memberships']);
    foreach ($ledger as $row) {
        expect($row->org_id)->toBe($credential['orgId']);
        expect($row->actor_membership_id)->toBe($credential['membershipId']);
        expect($row->device_id)->toBe($credential['deviceId']);
        expect($row->rev)->toBe(1);
    }
});

test('a self-scoped practitioner membership carries its practitioner_id', function () {
    $credential = makeAuthenticatedDevice();
    $practitionerId = $this->makePractitioner($credential['orgId'], $this->makeSpecialtyTemplate(null));
    $payload = staffPayload(['role' => 'practitioner', 'practitioner_scope' => 'self', 'practitioner_id' => $practitionerId]);

    $response = postStaff($credential['token'], $payload);

    $response->assertCreated();
    expect($this->fx()->table('memberships')->where('id', $payload['membership_id'])->value('practitioner_id'))->toBe($practitionerId);
});

test('an existing phone (another organization\'s staff) links that user and exposes nothing about the other organization', function () {
    $credential = makeAuthenticatedDevice();

    $otherOrgId = $this->makeOrganization('other-org-'.Str::random(6));
    $otherUserId = $this->makeUser('اسم في عيادة تانية');
    $phone = egyptianMobile();
    $this->fx()->table('users')->where('id', $otherUserId)->update(['phone' => $phone]);
    $otherMembershipId = $this->makeMembership($otherUserId, $otherOrgId, ['role' => 'owner']);
    $otherPatientId = $this->makePatient($otherOrgId, 'مريض في عيادة تانية');

    $payload = staffPayload(['phone' => $phone, 'display_name' => 'د. منى']);
    $response = postStaff($credential['token'], $payload);

    $response->assertCreated();
    expect($response->json('membership.user_id'))->toBe($otherUserId);
    expect($response->json('membership.display_name'))->toBe('د. منى');
    expect(array_keys($response->json()))->toBe(['membership', 'membership_locations', 'membership_practitioners']);

    $body = json_encode($response->json(), JSON_UNESCAPED_UNICODE);
    foreach ([$otherOrgId, $otherMembershipId, $otherPatientId, 'اسم في عيادة تانية', 'مريض في عيادة تانية'] as $foreign) {
        expect(str_contains($body, $foreign))->toBeFalse();
    }

    // The existing user is linked, not created again, and keeps its own name.
    expect($this->fx()->table('users')->where('id', $payload['user_id'])->exists())->toBeFalse();
    expect($this->fx()->table('users')->where('id', $otherUserId)->value('full_name'))->toBe('اسم في عيادة تانية');

    // The caller's session still sees nothing of the other organization.
    $seen = $this->withMembership($this->asApp(), $credential['membershipId'], fn ($connection) => [
        'memberships' => $connection->table('memberships')->where('org_id', $otherOrgId)->count(),
        'patients' => $connection->table('patients')->where('org_id', $otherOrgId)->count(),
        'organizations' => $connection->table('organizations')->where('id', $otherOrgId)->count(),
    ]);
    expect($seen)->toBe(['memberships' => 0, 'patients' => 0, 'organizations' => 0]);
});

test('a phone already on this organization\'s staff is refused as already_member', function () {
    $credential = makeAuthenticatedDevice();
    $userId = $this->makeUser('موظف موجود');
    $phone = egyptianMobile();
    $this->fx()->table('users')->where('id', $userId)->update(['phone' => $phone]);
    $this->makeMembership($userId, $credential['orgId']);

    $payload = staffPayload(['phone' => $phone]);
    $response = postStaff($credential['token'], $payload);

    $response->assertStatus(409);
    $response->assertJson(['error' => 'already_member']);
    expectNothingAdded($payload);
});

test('a non-owner caller is refused with 404 and nothing is written', function () {
    $credential = makeAuthenticatedDevice(['role' => 'assistant']);
    $payload = staffPayload();

    $response = postStaff($credential['token'], $payload);

    expectNotFound($response);
    expectNothingAdded($payload);
});

test('a manager caller is refused with 404 too', function () {
    $credential = makeAuthenticatedDevice(['role' => 'manager']);
    $payload = staffPayload();

    expectNotFound(postStaff($credential['token'], $payload));
    expectNothingAdded($payload);
});

test('an inactive owner is refused: the token stops authenticating, and the function itself refuses too', function () {
    $credential = makeAuthenticatedDevice();
    $this->fx()->table('memberships')->where('id', $credential['membershipId'])->update(['is_active' => false]);
    $payload = staffPayload();

    // ApplyMembership resolves no organization for an inactive membership,
    // so the request never reaches the function (the existing generic 401).
    $response = postStaff($credential['token'], $payload);
    $response->assertStatus(401);
    expectNothingAdded($payload);

    // The function does not rely on that: called in an inactive owner's
    // session, it refuses with the same generic error the endpoint renders
    // as 404.
    $direct = functionPayload();
    expect(fn () => callAddStaffMember($credential['membershipId'], $direct))
        ->toThrow(QueryException::class, 'add_staff_member: not allowed');
    expectNothingAdded($direct);
});

test('another organization\'s location is refused with 404 and nothing is written', function () {
    $credential = makeAuthenticatedDevice();
    $otherLocationId = $this->makeLocation($this->makeOrganization('other-'.Str::random(6)));
    $payload = staffPayload([
        'location_scope' => 'listed',
        'locations' => [['id' => (string) Str::uuid(), 'location_id' => $otherLocationId]],
    ]);

    expectNotFound(postStaff($credential['token'], $payload));
    expectNothingAdded($payload);
});

test('another organization\'s practitioner is refused with 404, listed or self', function () {
    $credential = makeAuthenticatedDevice();
    $otherPractitionerId = $this->makePractitioner($this->makeOrganization('other-'.Str::random(6)), $this->makeSpecialtyTemplate(null));

    $listed = staffPayload([
        'practitioner_scope' => 'listed',
        'practitioners' => [['id' => (string) Str::uuid(), 'practitioner_id' => $otherPractitionerId]],
    ]);
    expectNotFound(postStaff($credential['token'], $listed));
    expectNothingAdded($listed);

    $self = staffPayload(['practitioner_scope' => 'self', 'practitioner_id' => $otherPractitionerId]);
    expectNotFound(postStaff($credential['token'], $self));
    expectNothingAdded($self);
});

test('a refusal is byte-identical to a route that does not exist', function () {
    $credential = makeAuthenticatedDevice(['role' => 'assistant']);

    $refused = postStaff($credential['token'], staffPayload());
    $missing = $this->withToken($credential['token'])->postJson('/api/no-such-route', []);

    expect($refused->status())->toBe($missing->status());
    expect($refused->getContent())->toBe($missing->getContent());
});

test('the endpoint rejects a malformed payload with 422 before calling the function', function (array $overrides) {
    $credential = makeAuthenticatedDevice();
    $payload = staffPayload($overrides);

    $response = postStaff($credential['token'], $payload);

    $response->assertStatus(422);
    expectNothingAdded($payload);
})->with([
    'not a phone' => [['phone' => '123']],
    'unknown role' => [['role' => 'admin']],
    'unknown location scope' => [['location_scope' => 'some']],
    'unknown practitioner scope' => [['practitioner_scope' => 'others']],
    'empty display name' => [['display_name' => '   ']],
    'display name over 120' => [['display_name' => str_repeat('م', 121)]],
    'pin hash not hex' => [['pin_hash' => str_repeat('zz', 32)]],
    'pin salt too short' => [['pin_salt' => 'abcd']],
    'link without location' => [['location_scope' => 'listed', 'locations' => [['id' => (string) Str::uuid()]]]],
    'links on an all scope' => [['locations' => [['id' => (string) Str::uuid(), 'location_id' => (string) Str::uuid()]]]],
    'self without practitioner' => [['practitioner_scope' => 'self']],
]);

test('the endpoint requires a device token', function () {
    $response = $this->postJson('/api/staff', staffPayload());

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);
});

test('the function validates its own payload before reading any table (22023)', function (array $overrides, string $message) {
    $credential = makeAuthenticatedDevice();
    $payload = functionPayload($overrides);

    try {
        callAddStaffMember($credential['membershipId'], $payload);
        $this->fail('expected add_staff_member to refuse the payload');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('22023');
        expect($e->getMessage())->toContain($message);
    }
    expectNothingAdded($payload);
})->with([
    'unknown key' => [['is_owner' => true], 'unknown payload key(s): is_owner'],
    'missing audit id' => [['audit_id' => null], 'missing or null required key "audit_id"'],
    'membership id not a uuid' => [['membership_id' => 'abc'], 'membership_id must be a well-formed uuid'],
    'untrimmed display name' => [['display_name' => ' منى '], 'display_name must be trimmed'],
    'local phone' => [['phone' => '01012345678'], 'phone must be a non-empty E.164 number'],
    'unknown role' => [['role' => 'admin'], 'role must be'],
    'uppercase pin hash' => [['pin_hash' => str_repeat('AB', 32)], 'pin_hash must be 64 lowercase hex'],
    'extra link key' => [['location_scope' => 'listed', 'locations' => [['id' => '6f1c1b7e-0000-4000-8000-000000000001', 'location_id' => '6f1c1b7e-0000-4000-8000-000000000002', 'org_id' => 'x']]], 'a location link must be exactly'],
    'links on an all scope' => [['locations' => [['id' => '6f1c1b7e-0000-4000-8000-000000000001', 'location_id' => '6f1c1b7e-0000-4000-8000-000000000002']]], 'location links need location_scope listed'],
    'practitioner id without self' => [['practitioner_id' => '6f1c1b7e-0000-4000-8000-000000000003'], 'practitioner_id is required for practitioner_scope self, and only then'],
    'the same location twice' => [['location_scope' => 'listed', 'locations' => [
        ['id' => '6f1c1b7e-0000-4000-8000-000000000001', 'location_id' => '6f1c1b7e-0000-4000-8000-000000000009'],
        ['id' => '6f1c1b7e-0000-4000-8000-000000000002', 'location_id' => '6f1c1b7e-0000-4000-8000-000000000009'],
    ]], 'linked twice'],
]);

test('the function refuses a session with no membership with the generic error', function () {
    $payload = functionPayload();

    expect(fn () => callAddStaffMember(null, $payload))->toThrow(QueryException::class, 'add_staff_member: not allowed');
    expectNothingAdded($payload);
});

test('every authorisation refusal inside the function raises the same SQLSTATE and message', function () {
    $assistant = makeAuthenticatedDevice(['role' => 'assistant']);
    $owner = makeAuthenticatedDevice();
    $otherLocationId = $this->makeLocation($this->makeOrganization('other-'.Str::random(6)));

    $refusals = [];
    foreach ([
        [$assistant['membershipId'], functionPayload()],
        [$owner['membershipId'], functionPayload([
            'location_scope' => 'listed',
            'locations' => [['id' => (string) Str::uuid(), 'location_id' => $otherLocationId]],
        ])],
    ] as [$membershipId, $payload]) {
        try {
            callAddStaffMember($membershipId, $payload);
            $this->fail('expected a refusal');
        } catch (QueryException $e) {
            // The primary message only: the CONTEXT line that follows it
            // names the RAISE's own line number, which differs by design.
            preg_match('/ERROR:\s+(.*)/', $e->errorInfo[2] ?? '', $match);
            $refusals[] = [$e->getCode(), $match[1] ?? null];
        }
    }

    expect($refusals[0])->toBe(['P0001', 'add_staff_member: not allowed']);
    expect($refusals[1])->toBe($refusals[0]);
});
