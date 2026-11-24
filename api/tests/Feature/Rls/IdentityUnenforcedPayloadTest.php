<?php

use App\Models\Device;
use Illuminate\Support\Carbon;

/**
 * An organization with identity_enforced_at null (every organization until
 * identity phase A4) pulls exactly what it pulled before identity A1: the
 * fixture below was captured on main at 0481a38, before any A1 change, and
 * this test asserts GET /api/sync/pull and GET /api/sync/bootstrap answer
 * the same bytes for the same rows today (docs/design-identity-permissions.md,
 * "A1 decisions", 4). Only `seq` and `cursor` are rewritten to ordinals
 * before comparing: they come from one identity column shared by every
 * organization in the database, so their absolute values depend on what
 * ran before.
 */
const UNENFORCED_SNAPSHOT_FIXTURE = __DIR__.'/../../Fixtures/identity-unenforced-payloads.json';

/** Every id the fixture writes, fixed so the payloads are comparable byte for byte. */
const UNENFORCED_IDS = [
    'org' => '0a1d0000-0000-4000-8000-000000000001',
    'location' => '0a1d0000-0000-4000-8000-000000000002',
    'template' => '0a1d0000-0000-4000-8000-000000000003',
    'practitioner' => '0a1d0000-0000-4000-8000-000000000004',
    'owner_user' => '0a1d0000-0000-4000-8000-000000000005',
    'owner' => '0a1d0000-0000-4000-8000-000000000006',
    'staff_user' => '0a1d0000-0000-4000-8000-000000000007',
    'staff' => '0a1d0000-0000-4000-8000-000000000008',
    'staff_location' => '0a1d0000-0000-4000-8000-000000000009',
    'device' => '0a1d0000-0000-4000-8000-00000000000a',
    'patient' => '0a1d0000-0000-4000-8000-00000000000b',
    'visit' => '0a1d0000-0000-4000-8000-00000000000c',
    'day_state' => '0a1d0000-0000-4000-8000-00000000000d',
];

function unenforcedFixtureCleanup(): void
{
    $fx = test()->fx();
    $ids = UNENFORCED_IDS;

    $fx->table('sync_ledger')->where('org_id', $ids['org'])->delete();
    $fx->table('audit_log')->where('org_id', $ids['org'])->delete();
    $fx->table('visits')->where('id', $ids['visit'])->delete();
    $fx->table('day_state')->where('id', $ids['day_state'])->delete();
    $fx->table('patients')->where('id', $ids['patient'])->delete();
    $fx->table('membership_locations')->where('id', $ids['staff_location'])->delete();
    $fx->table('personal_access_tokens')->where('tokenable_id', $ids['device'])->delete();
    $fx->table('device')->where('id', $ids['device'])->delete();
    $fx->table('memberships')->whereIn('id', [$ids['staff'], $ids['owner']])->delete();
    $fx->table('practitioners')->where('id', $ids['practitioner'])->delete();
    $fx->table('specialty_templates')->where('id', $ids['template'])->delete();
    $fx->table('locations')->where('id', $ids['location'])->delete();
    $fx->table('users')->whereIn('id', [$ids['staff_user'], $ids['owner_user']])->delete();
    $fx->table('organizations')->where('id', $ids['org'])->delete();
}

/** @return string the device's bearer token */
function unenforcedFixture(): string
{
    $fx = test()->fx();
    $ids = UNENFORCED_IDS;
    $at = '2026-11-19T08:00:00+00:00';

    unenforcedFixtureCleanup();

    $fx->table('organizations')->insert(['id' => $ids['org'], 'name' => 'عيادة اللقطة', 'plan_tier' => 'small', 'created_at' => $at]);
    $fx->table('locations')->insert([
        'id' => $ids['location'], 'org_id' => $ids['org'], 'name' => 'الفرع', 'address' => 'شارع 9',
        'phone' => '0222222222', 'is_active' => true,
    ]);
    $fx->table('specialty_templates')->insert([
        'id' => $ids['template'], 'org_id' => $ids['org'], 'key' => 'snapshot', 'name' => 'General', 'generation' => 'none',
        'pricing_mode' => 'per_item', 'unit_label' => 'unit', 'provider_label' => 'provider',
    ]);
    $fx->table('practitioners')->insert([
        'id' => $ids['practitioner'], 'org_id' => $ids['org'], 'user_id' => null, 'full_name' => 'د. سامي',
        'specialty_id' => $ids['template'], 'title' => 'Dr.', 'is_active' => true, 'syndicate_number' => '12345',
    ]);
    $fx->table('users')->insert([
        ['id' => $ids['owner_user'], 'full_name' => 'صاحب', 'phone' => '+201000000901', 'email' => null, 'is_active' => true],
        ['id' => $ids['staff_user'], 'full_name' => 'مساعد', 'phone' => '+201000000902', 'email' => null, 'is_active' => true],
    ]);
    $fx->table('memberships')->insert([
        [
            'id' => $ids['owner'], 'user_id' => $ids['owner_user'], 'org_id' => $ids['org'], 'role' => 'owner',
            'location_scope' => 'all', 'practitioner_scope' => 'all', 'practitioner_id' => null,
            'pin_hash' => str_repeat('a', 64), 'pin_salt' => str_repeat('b', 32), 'is_active' => true, 'display_name' => 'د. سامي',
        ],
        [
            'id' => $ids['staff'], 'user_id' => $ids['staff_user'], 'org_id' => $ids['org'], 'role' => 'assistant',
            'location_scope' => 'listed', 'practitioner_scope' => 'all', 'practitioner_id' => null,
            'pin_hash' => str_repeat('c', 64), 'pin_salt' => str_repeat('d', 32), 'is_active' => true, 'display_name' => 'منى',
        ],
    ]);
    $fx->table('membership_locations')->insert(['id' => $ids['staff_location'], 'membership_id' => $ids['staff'], 'location_id' => $ids['location']]);
    $fx->table('device')->insert([
        'id' => $ids['device'], 'org_id' => $ids['org'], 'location_id' => $ids['location'], 'membership_id' => $ids['owner'],
        'registered_at' => $at, 'series' => 1,
    ]);
    $fx->table('patients')->insert([
        'id' => $ids['patient'], 'org_id' => $ids['org'], 'full_name' => 'مريض اللقطة', 'phone' => '01000000903',
        'gender' => 'female', 'birth_year' => 1990, 'note' => null, 'created_at' => $at, 'archived_at' => null,
    ]);
    $fx->table('visits')->insert([
        'id' => $ids['visit'], 'org_id' => $ids['org'], 'location_id' => $ids['location'], 'practitioner_id' => $ids['practitioner'],
        'patient_id' => $ids['patient'], 'visit_date' => '2026-11-19', 'position' => 1, 'status' => 'booked',
        'is_overbooked' => false, 'source' => 'walkin', 'created_by' => $ids['staff'], 'created_at' => $at,
        'scheduled_at' => '2026-11-19T09:30:00+00:00', 'unique_scheduled_at' => '2026-11-19T09:30:00+00:00',
    ]);
    $fx->table('day_state')->insert([
        'id' => $ids['day_state'], 'practitioner_id' => $ids['practitioner'], 'location_id' => $ids['location'],
        'date' => '2026-11-19', 'delay_minutes' => 5, 'is_closed' => false, 'avg_consult_minutes' => 12,
    ]);

    $ledger = [
        ['memberships', $ids['owner']], ['memberships', $ids['staff']], ['membership_locations', $ids['staff_location']],
        ['practitioners', $ids['practitioner']], ['patients', $ids['patient']], ['visits', $ids['visit']],
        ['day_state', $ids['day_state']],
    ];
    foreach ($ledger as $i => [$entity, $entityId]) {
        $fx->table('sync_ledger')->insert([
            'op_id' => sprintf('0a1d0000-0000-4000-9000-%012d', $i + 1), 'org_id' => $ids['org'], 'entity' => $entity,
            'entity_id' => $entityId, 'rev' => 1, 'actor_membership_id' => $ids['owner'], 'device_id' => $ids['device'],
            'applied_at' => $at, 'client_created_at' => $at,
        ]);
    }

    return (new Device(['id' => $ids['device']]))->createToken('snapshot-device', ['membership:'.$ids['owner']])->plainTextToken;
}

/**
 * seq and cursor rewritten to their order of appearance (see the file comment).
 *
 * @param  array<string, mixed>  $body
 * @return array<string, mixed>
 */
function withOrdinalSeqs(array $body): array
{
    $ordinals = [];
    $ordinal = function (string|int $seq) use (&$ordinals): int {
        return $ordinals[(string) $seq] ??= count($ordinals) + 1;
    };

    foreach ($body['rows'] as $i => $row) {
        if (array_key_exists('seq', $row)) {
            $body['rows'][$i]['seq'] = $ordinal($row['seq']);
        }
    }
    if (ctype_digit((string) $body['cursor'])) {
        $body['cursor'] = $ordinal($body['cursor']);
    }

    return $body;
}

/** @return array{pull: array<string, mixed>, bootstrap: list<array<string, mixed>>} */
function unenforcedPayloads(string $token): array
{
    $pull = test()->withToken($token)->getJson('/api/sync/pull')->assertOk()->json();

    $bootstrap = [];
    $cursor = null;
    do {
        $page = test()->withToken($token)
            ->getJson('/api/sync/bootstrap'.($cursor === null ? '' : '?cursor='.urlencode($cursor)))
            ->assertOk()->json();
        $bootstrap[] = $page;
        $cursor = $page['cursor'];
    } while ($page['has_more']);

    return ['pull' => withOrdinalSeqs($pull), 'bootstrap' => $bootstrap];
}

afterEach(function () {
    Carbon::setTestNow();
    unenforcedFixtureCleanup();
});

test('an unenforced organization pulls and bootstraps the bytes it did before identity A1', function () {
    Carbon::setTestNow(Carbon::parse('2026-11-19T10:00:00+02:00'));
    $token = unenforcedFixture();

    $payloads = unenforcedPayloads($token);
    expect($payloads['pull']['code_notices'])->toBe([]);
    foreach ($payloads['bootstrap'] as $page) {
        expect($page['code_notices'])->toBe([]);
    }
    expect($payloads['pull']['support_sessions'])->toBe([]);
    foreach ($payloads['bootstrap'] as $page) {
        expect($page['support_sessions'])->toBe([]);
    }
    unset($payloads['pull']['code_notices']);
    unset($payloads['pull']['support_sessions']);
    foreach ($payloads['bootstrap'] as &$page) {
        unset($page['code_notices'], $page['support_sessions']);
    }
    unset($page);
    $historical = json_encode($payloads, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
    expect($historical)->toBe(file_get_contents(UNENFORCED_SNAPSHOT_FIXTURE));
});
