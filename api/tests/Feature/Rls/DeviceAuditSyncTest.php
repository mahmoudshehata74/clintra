<?php

use App\Models\Device;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * POST /api/audit/push and GET /api/audit/pull (docs/audit-sync.md):
 * App\Http\Controllers\DeviceAuditController, App\Support\Sync\DeviceAuditPusher
 * and DeviceAuditPuller. The table itself is covered by DeviceAuditLogTest.php.
 */

/** A row as a device pushes it: a patient created by the credential's membership. */
function auditRow(array $credential, array $overrides = []): array
{
    $entityId = (string) Str::uuid();

    return array_merge([
        'id' => (string) Str::uuid(),
        'org_id' => $credential['orgId'],
        'location_id' => null,
        'practitioner_id' => null,
        'actor_membership_id' => $credential['membershipId'],
        'entity' => 'patients',
        'entity_id' => $entityId,
        'action' => 'create',
        'before' => null,
        'after' => ['id' => $entityId, 'org_id' => $credential['orgId'], 'full_name' => 'كريم فتحي'],
        'at' => '2026-10-17T09:15:00.123Z',
    ], $overrides);
}

/** Pushes rows and tracks whatever was stored, so cleanup removes it. */
function pushAudit(string $token, array $rows)
{
    $response = test()->withToken($token)->postJson('/api/audit/push', ['rows' => $rows]);

    foreach ($rows as $row) {
        if (Str::isUuid($row['id'] ?? null) && test()->fx()->table('device_audit_log')->where('id', $row['id'])->exists()) {
            trackDeviceAudit($row['id']);
        }
    }

    return $response;
}

function pullAudit(string $token, ?int $cursor = null)
{
    return test()->withToken($token)->getJson('/api/audit/pull'.($cursor === null ? '' : '?cursor='.$cursor));
}

/** @return list<string> */
function auditStatuses($response): array
{
    return array_map(fn ($result) => $result['status'].(isset($result['reason']) ? ':'.$result['reason'] : ''), $response->json('results'));
}

/** A second device of the credential's organization: its id and its own token. */
function otherDevice(array $credential): array
{
    $deviceId = test()->makeDevice($credential['orgId'], $credential['locationId'], $credential['membershipId']);
    $token = (new Device(['id' => $deviceId]))->createToken('test-device', ['membership:'.$credential['membershipId']])->plainTextToken;

    return ['deviceId' => $deviceId, 'token' => $token];
}

// --- Push --------------------------------------------------------------------

test('an accepted row is stored as the device wrote it, with the token\'s membership and device', function () {
    $credential = makeAuthenticatedDevice();
    $assistant = $this->makeMembership($this->makeUser('assistant'), $credential['orgId'], ['role' => 'assistant']);
    $other = otherDevice($credential);
    $row = auditRow($credential, [
        'actor_membership_id' => $assistant,
        'after' => ['id' => (string) Str::uuid(), 'full_name' => '  كريم  ', 'notes' => ''],
        // Neither is the device's to say.
        'pushed_by_membership_id' => $assistant,
        'device_id' => $other['deviceId'],
    ]);

    $response = pushAudit($credential['token'], [$row]);

    $response->assertOk();
    expect(auditStatuses($response))->toBe(['accepted']);
    expect($response->json('results.0.id'))->toBe($row['id']);

    $stored = $this->fx()->table('device_audit_log')->where('id', $row['id'])->first();
    expect($stored->actor_membership_id)->toBe($assistant);
    expect($stored->pushed_by_membership_id)->toBe($credential['membershipId']);
    expect($stored->device_id)->toBe($credential['deviceId']);
    // jsonb keeps the keys and values, not their order.
    expect(json_decode($stored->after, true))->toEqual($row['after']);
    expect(json_decode($stored->after, true)['full_name'])->toBe('  كريم  ');
    expect($stored->before)->toBeNull();
    expect(CarbonImmutable::parse($stored->at)->utc()->format('Y-m-d\TH:i:s.v\Z'))->toBe($row['at']);
});

test('a resend is a duplicate and writes nothing; the same id with other content is refused', function () {
    $credential = makeAuthenticatedDevice();
    $rows = [auditRow($credential), auditRow($credential)];

    expect(auditStatuses(pushAudit($credential['token'], $rows)))->toBe(['accepted', 'accepted']);
    $seqs = $this->fx()->table('device_audit_log')->whereIn('id', array_column($rows, 'id'))->orderBy('seq')->pluck('seq')->all();

    expect(auditStatuses(pushAudit($credential['token'], $rows)))->toBe(['duplicate', 'duplicate']);
    expect($this->fx()->table('device_audit_log')->whereIn('id', array_column($rows, 'id'))->orderBy('seq')->pluck('seq')->all())->toBe($seqs);

    $changed = [...$rows[0], 'after' => [...$rows[0]['after'], 'full_name' => 'غيره']];
    expect(auditStatuses(pushAudit($credential['token'], [$changed])))->toBe(['rejected:audit_id_taken']);
    expect(json_decode($this->fx()->table('device_audit_log')->where('id', $rows[0]['id'])->value('after'), true))->toEqual($rows[0]['after']);
});

test('a refused row is refused alone; the rest of its batch is stored', function () {
    $credential = makeAuthenticatedDevice();
    $rows = [auditRow($credential), auditRow($credential, ['entity' => 'device']), auditRow($credential)];

    expect(auditStatuses(pushAudit($credential['token'], $rows)))->toBe(['accepted', 'rejected:unknown_entity', 'accepted']);
    expect($this->fx()->table('device_audit_log')->whereIn('id', array_column($rows, 'id'))->count())->toBe(2);
});

test('an actor from another organization is refused; any member of the token\'s organization is accepted', function () {
    $credential = makeAuthenticatedDevice();
    $stranger = makeAuthenticatedDevice();
    $manager = $this->makeMembership($this->makeUser('manager'), $credential['orgId'], ['role' => 'manager', 'is_active' => false]);

    expect(auditStatuses(pushAudit($credential['token'], [
        auditRow($credential, ['actor_membership_id' => $stranger['membershipId']]),
        // A member deactivated since: the row was written while they were not.
        auditRow($credential, ['actor_membership_id' => $manager]),
    ])))->toBe(['rejected:actor_not_in_org', 'accepted']);
});

test('one organization never writes into another', function () {
    $orgA = makeAuthenticatedDevice();
    $orgB = makeAuthenticatedDevice();
    $rowA = auditRow($orgA);
    pushAudit($orgA['token'], [$rowA]);

    expect(auditStatuses(pushAudit($orgB['token'], [
        auditRow($orgB, ['org_id' => $orgA['orgId']]),
        // A's row id, as B's own row: B cannot see A's, and cannot take its id.
        auditRow($orgB, ['id' => $rowA['id']]),
        auditRow($orgB, ['location_id' => $orgA['locationId'], 'after' => ['location_id' => $orgA['locationId']]]),
    ])))->toBe(['rejected:org_mismatch', 'rejected:audit_id_taken', 'rejected:scope_mismatch']);

    expect($this->fx()->table('device_audit_log')->where('id', $rowA['id'])->value('org_id'))->toBe($orgA['orgId']);
});

test('each refusal reason', function () {
    $credential = makeAuthenticatedDevice();
    $practitionerId = $this->makePractitioner($credential['orgId'], $this->makeSpecialtyTemplate($credential['orgId']));
    $visit = ['location_id' => $credential['locationId'], 'practitioner_id' => $practitionerId];

    $cases = [
        'audit_invalid' => [
            auditRow($credential, ['id' => 'not-a-uuid']),
            auditRow($credential, ['action' => 'archive']),
            auditRow($credential, ['before' => ['full_name' => 'x']]),
            auditRow($credential, ['action' => 'update', 'before' => null]),
            auditRow($credential, ['action' => 'delete']),
            auditRow($credential, ['at' => 'yesterday']),
            auditRow($credential, ['after' => ['note' => str_repeat('x', 65537)]]),
            auditRow($credential, ['after' => ['a', 'b']]),
        ],
        'audit_secret_field' => [
            auditRow($credential, ['entity' => 'memberships', 'after' => ['role' => 'assistant', 'pin_hash' => 'x']]),
            auditRow($credential, ['entity' => 'memberships', 'action' => 'update', 'before' => ['pin_salt' => 'y'], 'after' => ['role' => 'assistant']]),
        ],
        'scope_mismatch' => [
            auditRow($credential, ['entity' => 'visits', 'after' => $visit]),
            auditRow($credential, ['entity' => 'visits', 'location_id' => $credential['locationId'], 'after' => $visit]),
            auditRow($credential, ['entity' => 'practitioners', 'entity_id' => $practitionerId, 'after' => ['full_name' => 'د. منى']]),
        ],
    ];

    foreach ($cases as $reason => $rows) {
        expect(auditStatuses(pushAudit($credential['token'], $rows)))->toBe(array_fill(0, count($rows), "rejected:{$reason}"), $reason);
    }

    // The same rows, tagged as the device tags them, are accepted.
    expect(auditStatuses(pushAudit($credential['token'], [
        auditRow($credential, ['entity' => 'visits', ...$visit, 'after' => $visit]),
        auditRow($credential, ['entity' => 'practitioners', 'entity_id' => $practitionerId, 'practitioner_id' => $practitionerId, 'after' => ['full_name' => 'د. منى']]),
        auditRow($credential, ['entity' => 'memberships', 'after' => ['role' => 'assistant', 'display_name' => 'سارة']]),
        auditRow($credential, ['entity' => 'users', 'after' => ['full_name' => 'سارة']]),
    ])))->toBe(['accepted', 'accepted', 'accepted', 'accepted']);
});

test('a batch is 1 to 200 rows', function () {
    $credential = makeAuthenticatedDevice();

    $this->withToken($credential['token'])->postJson('/api/audit/push', ['rows' => []])->assertStatus(422);
    $this->withToken($credential['token'])->postJson('/api/audit/push', ['rows' => array_fill(0, 201, auditRow($credential))])->assertStatus(422);
});

test('an audit push writes no ledger row and no server audit row', function () {
    $credential = makeAuthenticatedDevice();
    $row = auditRow($credential);

    pushAudit($credential['token'], [$row]);

    expect($this->fx()->table('sync_ledger')->where('org_id', $credential['orgId'])->count())->toBe(0);
    expect($this->fx()->table('audit_log')->where('org_id', $credential['orgId'])->where('entity_id', $row['entity_id'])->count())->toBe(0);
});

test('both endpoints need a device token', function () {
    $this->postJson('/api/audit/push', ['rows' => [['id' => (string) Str::uuid()]]])->assertUnauthorized();
    $this->getJson('/api/audit/pull')->assertUnauthorized();
});

// --- Pull --------------------------------------------------------------------

test('a pull returns the organization\'s other devices\' rows in seq order, never the caller\'s own', function () {
    $credential = makeAuthenticatedDevice();
    $other = otherDevice($credential);
    $theirs = auditRow($credential, ['at' => now()->toIso8601ZuluString('millisecond'), 'after' => ['full_name' => 'كريم', 'notes' => '']]);
    $mine = auditRow($credential, ['at' => now()->toIso8601ZuluString('millisecond')]);
    pushAudit($other['token'], [$theirs]);
    pushAudit($credential['token'], [$mine]);

    $response = pullAudit($credential['token']);

    $response->assertOk();
    expect($response->json('has_more'))->toBeFalse();
    $rows = $response->json('rows');
    expect(array_column($rows, 'id'))->toBe([$theirs['id']]);
    expect($rows[0])->toMatchArray([
        'org_id' => $credential['orgId'],
        'location_id' => null,
        'practitioner_id' => null,
        'actor_membership_id' => $credential['membershipId'],
        'device_id' => $other['deviceId'],
        'entity' => 'patients',
        'entity_id' => $theirs['entity_id'],
        'action' => 'create',
        'before' => null,
        'at' => $theirs['at'],
    ]);
    expect($rows[0]['after'])->toEqual($theirs['after']);
    expect($rows[0])->not->toHaveKeys(['pushed_by_membership_id', 'received_at']);
    expect($response->json('cursor'))->toBe((string) $rows[0]['seq']);

    // Nothing new from that cursor.
    expect(pullAudit($credential['token'], (int) $response->json('cursor'))->json('rows'))->toBe([]);
});

test('pages hold 200 rows, and the cursor walks every row once', function () {
    $credential = makeAuthenticatedDevice();
    $other = otherDevice($credential);
    $ids = [];
    foreach (range(1, 201) as $_) {
        $ids[] = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $other['deviceId']);
    }

    $first = pullAudit($credential['token']);
    expect(count($first->json('rows')))->toBe(200);
    expect($first->json('has_more'))->toBeTrue();

    $second = pullAudit($credential['token'], (int) $first->json('cursor'));
    expect($second->json('has_more'))->toBeFalse();
    expect([...array_column($first->json('rows'), 'id'), ...array_column($second->json('rows'), 'id')])->toBe($ids);
});

test('a first pull starts 14 Cairo days back', function () {
    $credential = makeAuthenticatedDevice();
    $other = otherDevice($credential);
    $old = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $other['deviceId'], ['at' => now('Africa/Cairo')->subDays(14)->startOfDay()->subMinute()]);
    $inWindow = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $other['deviceId'], ['at' => now('Africa/Cairo')->subDays(13)->startOfDay()]);
    $today = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $other['deviceId']);

    expect(array_column(pullAudit($credential['token'])->json('rows'), 'id'))->toBe([$inWindow, $today]);
    // A cursor reaches every row, the window's start included.
    expect(array_column(pullAudit($credential['token'], 0)->json('rows'), 'id'))->toBe([$old, $inWindow, $today]);
});

test('a first pull with nothing in the window starts at the end', function () {
    $credential = makeAuthenticatedDevice();
    $other = otherDevice($credential);
    $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $other['deviceId'], ['at' => now()->subDays(30)]);

    $response = pullAudit($credential['token']);

    expect($response->json('rows'))->toBe([]);
    $max = $this->fx()->table('device_audit_log')->where('org_id', $credential['orgId'])->max('seq');
    expect($response->json('cursor'))->toBe((string) $max);
});

test('a pull never shows another organization\'s rows, and refuses a cursor past what the caller can see', function () {
    $orgA = makeAuthenticatedDevice();
    $orgB = makeAuthenticatedDevice();
    $otherA = otherDevice($orgA);
    $this->makeDeviceAuditLog($orgA['orgId'], $orgA['membershipId'], $otherA['deviceId']);
    $maxA = (int) $this->fx()->table('device_audit_log')->where('org_id', $orgA['orgId'])->max('seq');

    expect(pullAudit($orgB['token'])->json('rows'))->toBe([]);
    pullAudit($orgB['token'], $maxA)->assertStatus(422)->assertJson(['error' => 'invalid_cursor']);
    pullAudit($orgB['token'], -1)->assertStatus(422);
});
