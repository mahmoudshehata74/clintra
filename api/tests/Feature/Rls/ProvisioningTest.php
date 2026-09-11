<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;
use Ramsey\Uuid\Uuid;

/**
 * Runs `clintra:provision` with deterministic ids (Str::createUuidsUsing) so
 * assertions and cleanup can target exact rows, instead of parsing the
 * printed table. Returns the 12 ids in the exact order
 * App\Console\Commands\ProvisionOrganization generates them.
 *
 * @return array{org: string, location: string, user: string, practitioner: string, practitionerLocation: string, membership: string, auditOrg: string, auditLocation: string, auditUser: string, auditPractitioner: string, auditPractitionerLocation: string, auditMembership: string}
 */
function provisionViaCommand(
    string $orgName,
    string $locationName,
    string $locationAddress,
    string $locationPhone,
    string $doctorFullName,
    string $doctorPhone,
    string $pin = '1234',
): array {
    $keys = [
        'org', 'location', 'user', 'practitioner', 'practitionerLocation', 'membership',
        'auditOrg', 'auditLocation', 'auditUser', 'auditPractitioner', 'auditPractitionerLocation', 'auditMembership',
    ];
    $ids = collect($keys)->mapWithKeys(fn (string $key) => [$key => (string) Str::uuid()]);

    $sequence = $ids->values()->all();
    $cursor = 0;
    Str::createUuidsUsing(function () use (&$cursor, $sequence) {
        return Uuid::fromString($sequence[$cursor++]);
    });

    try {
        test()->artisan('clintra:provision')
            ->expectsQuestion('Organization name', $orgName)
            ->expectsQuestion('Location name', $locationName)
            ->expectsQuestion('Location address', $locationAddress)
            ->expectsQuestion('Location phone', $locationPhone)
            ->expectsQuestion("Doctor's full name", $doctorFullName)
            ->expectsQuestion("Doctor's phone", $doctorPhone)
            ->expectsQuestion('PIN (4 digits)', $pin)
            ->expectsQuestion('Confirm PIN', $pin)
            ->assertExitCode(0);
    } finally {
        Str::createUuidsNormally();
    }

    return $ids->all();
}

function cleanupProvisioned(array $ids): void
{
    $fx = test()->fx();
    $fx->table('audit_log')->where('org_id', $ids['org'])->delete();
    $fx->table('memberships')->where('id', $ids['membership'])->delete();
    $fx->table('practitioner_locations')->where('id', $ids['practitionerLocation'])->delete();
    $fx->table('practitioners')->where('id', $ids['practitioner'])->delete();
    $fx->table('locations')->where('id', $ids['location'])->delete();
    $fx->table('organizations')->where('id', $ids['org'])->delete();
    // users deliberately not deleted here — a reuse test may still need the
    // row; callers that need the user gone too should delete it themselves.
}

test('provisioning creates exactly the expected rows, visible only to the new owner membership', function () {
    $orgA = provisionViaCommand(
        'عيادة الاختبار أ', 'الفرع الرئيسي', 'شارع الاختبار', '01001234567',
        'د. اختبار أ', '01000000001',
    );

    $this->withMembership($this->asApp(), $orgA['membership'], function ($db) use ($orgA) {
        expect($db->table('organizations')->pluck('id')->all())->toBe([$orgA['org']]);
        expect($db->table('locations')->pluck('id')->all())->toBe([$orgA['location']]);
        expect($db->table('practitioners')->pluck('id')->all())->toBe([$orgA['practitioner']]);
        expect($db->table('memberships')->pluck('id')->all())->toBe([$orgA['membership']]);
    });

    // A membership in a different org sees none of it.
    $orgBId = $this->makeOrganization('org-b-for-provisioning-check');
    $orgBUserId = $this->makeUser('org-b-user');
    $orgBMembershipId = $this->makeMembership($orgBUserId, $orgBId, ['role' => 'owner']);

    $this->withMembership($this->asApp(), $orgBMembershipId, function ($db) use ($orgA) {
        expect($db->table('organizations')->pluck('id')->all())->not->toContain($orgA['org']);
        expect($db->table('practitioners')->pluck('id')->all())->not->toContain($orgA['practitioner']);
    });

    cleanupProvisioned($orgA);
    $this->fx()->table('users')->where('id', $orgA['user'])->delete();
});

test('clintra_app cannot execute provision_organization directly', function () {
    $caught = null;

    try {
        $this->asApp()->select("select provision_organization('{}'::jsonb)");
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('clintra_app should not be able to call provision_organization at all');
    expect($caught->getCode())->toBe('42501');
});

test('reusing an existing phone creates a second membership, not a second user', function () {
    $sharedDoctorPhone = '01000000002';

    $orgA = provisionViaCommand(
        'عيادة الاختبار ب1', 'فرع 1', 'عنوان 1', '01001234568',
        'د. مشترك', $sharedDoctorPhone,
    );

    $orgB = provisionViaCommand(
        'عيادة الاختبار ب2', 'فرع 2', 'عنوان 2', '01001234569',
        'د. مشترك', $sharedDoctorPhone,
    );

    // Same phone, so the second call must have reused org A's user row —
    // never orgB['user'], which was only ever a candidate id.
    $usersWithThisPhone = $this->fx()->table('users')->where('phone', '+20'.ltrim($sharedDoctorPhone, '0'))->get();
    expect($usersWithThisPhone)->toHaveCount(1);
    expect($usersWithThisPhone->first()->id)->toBe($orgA['user']);

    $membershipUserIds = $this->fx()->table('memberships')
        ->whereIn('id', [$orgA['membership'], $orgB['membership']])
        ->pluck('user_id')->all();
    expect($membershipUserIds)->toBe([$orgA['user'], $orgA['user']]);

    cleanupProvisioned($orgA);
    cleanupProvisioned($orgB);
    $this->fx()->table('users')->where('id', $orgA['user'])->delete();
});

test('audit rows exist for every created row, attributed to the new owner membership', function () {
    $org = provisionViaCommand(
        'عيادة الاختبار ج', 'فرع ج', 'عنوان ج', '01001234570',
        'د. اختبار ج', '01000000003',
    );

    $auditRows = $this->fx()->table('audit_log')->where('org_id', $org['org'])->orderBy('seq')->get();

    expect($auditRows)->toHaveCount(6);

    $expectedEntities = ['organizations', 'locations', 'users', 'practitioners', 'practitioner_locations', 'memberships'];
    expect($auditRows->pluck('entity')->all())->toBe($expectedEntities);

    foreach ($auditRows as $row) {
        expect($row->action)->toBe('create');
        expect($row->actor_membership_id)->toBe($org['membership']);
        expect($row->before)->toBeNull();
    }

    $entityIds = $auditRows->pluck('entity_id')->all();
    expect($entityIds)->toBe([
        $org['org'], $org['location'], $org['user'], $org['practitioner'],
        $org['practitionerLocation'], $org['membership'],
    ]);

    // pin_hash/pin_salt must never appear in the membership's audit snapshot.
    $membershipAudit = $auditRows->firstWhere('entity', 'memberships');
    $after = json_decode($membershipAudit->after, associative: true);
    expect($after)->not->toHaveKey('pin_hash');
    expect($after)->not->toHaveKey('pin_salt');

    cleanupProvisioned($org);
    $this->fx()->table('users')->where('id', $org['user'])->delete();
});
