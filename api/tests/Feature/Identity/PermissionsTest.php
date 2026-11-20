<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;

/**
 * Permissions once an organization is enforced (docs/design-identity-permissions.md,
 * section 4 and 6.3): the applier's check of every server-enforced row of
 * the catalogue, `permission_escalation` for any change of a membership's
 * role, permissions or username by sync, the membership permission guard
 * trigger, and add_staff_member's subset rule.
 */

/** @return array<string, mixed> */
function permissionOp(string $entity, string $action, array $payload, ?int $baseRev = null, ?string $id = null): array
{
    $id ??= $payload['id'] ?? (string) Str::uuid();
    $op = [
        'op_id' => (string) Str::uuid(), 'entity' => $entity, 'entity_id' => $id, 'action' => $action,
        'payload' => $action === 'delete' ? null : $payload, 'created_at' => now()->toIso8601String(),
    ];

    return $baseRev === null ? $op : [...$op, 'base_rev' => $baseRev];
}

/** The op's result when $credential signs and pushes it. */
function pushAs(array $org, array $credential, array $op): array
{
    return IdentityHarness::send($org, 'POST', '/api/sync/push', ['ops' => [IdentityHarness::signOp($org, $op, $credential)]])
        ->assertOk()->json('results.0');
}

/**
 * Every server-enforced row of the catalogue: an op (built fresh each call)
 * and the permission it needs.
 *
 * @return array<string, array{0: string, 1: Closure(): array<string, mixed>}>
 */
function catalogueCases(array $org, array $refs): array
{
    $fx = test()->fx();

    return [
        'services: any op' => ['services.manage', fn () => permissionOp('services', 'create', [
            'id' => (string) Str::uuid(), 'org_id' => $org['orgId'], 'name' => 'كشف', 'duration_minutes' => 15, 'default_price' => 20000, 'is_active' => true,
        ])],
        'schedules: any op' => ['schedules.manage', fn () => permissionOp('schedules', 'create', [
            'id' => (string) Str::uuid(), 'practitioner_id' => $refs['practitionerId'], 'location_id' => $org['locationId'], 'weekday' => random_int(0, 6),
            'start_time' => '09:00', 'end_time' => '14:00', 'mode' => 'slots', 'slot_minutes' => 30, 'max_capacity' => null,
            'resource_count' => 1, 'next_mode' => null, 'next_mode_from' => null,
        ])],
        'cash_close: a create' => ['cash.close', fn () => permissionOp('cash_close', 'create', [
            'id' => (string) Str::uuid(), 'location_id' => $org['locationId'], 'date' => now()->subDays(random_int(10, 9000))->toDateString(),
            'opening_amount' => 0, 'total_expected' => 0, 'total_collected' => 0, 'difference' => 0, 'difference_note' => null,
            'closed_by' => null, 'closed_at' => now()->toIso8601String(),
        ])],
        'message_templates: any op' => ['messages.send', function () use ($org, $fx) {
            $fx->table('message_templates')->where('org_id', $org['orgId'])->delete();

            return permissionOp('message_templates', 'create', [
                'id' => (string) Str::uuid(), 'org_id' => $org['orgId'], 'key' => 'appointment_reminder', 'body' => 'بنفكّرك بموعدك',
                'updated_by' => null, 'updated_at' => now()->toIso8601String(),
            ]);
        }],
        'patients: an archive' => ['patients.archive', function () use ($org) {
            $id = test()->makePatient($org['orgId']);

            return permissionOp('patients', 'update', ['archived_at' => now()->toIso8601String()], 1, $id);
        }],
        'memberships: any op' => ['staff.manage', function () use ($org) {
            $id = IdentityHarness::member($org);

            return permissionOp('memberships', 'update', ['display_name' => 'اسم جديد'], 1, $id);
        }],
        'invoices: a total change' => ['invoices.edit_items', fn () => permissionOp('invoices', 'update', ['total' => 999], 1, permissionInvoice($org, $refs))],
        'invoices: a void' => ['invoices.void', fn () => permissionOp('invoices', 'update', ['status' => 'void'], 1, permissionInvoice($org, $refs))],
        'invoice_items: an update' => ['invoices.edit_items', function () use ($org, $refs, $fx) {
            $itemId = (string) Str::uuid();
            $fx->table('invoice_items')->insert([
                'id' => $itemId, 'invoice_id' => permissionInvoice($org, $refs), 'service_id' => $refs['serviceId'],
                'description' => 'كشف', 'qty' => 1, 'unit_price' => 100, 'total' => 100,
            ]);

            return permissionOp('invoice_items', 'update', ['qty' => 2, 'total' => 200], 1, $itemId);
        }],
    ];
}

function permissionInvoice(array $org, array $refs): string
{
    $fx = test()->fx();
    $id = (string) Str::uuid();
    $fx->table('invoices')->insert([
        'id' => $id, 'org_id' => $org['orgId'], 'location_id' => $org['locationId'],
        'number' => (int) $fx->table('invoices')->where('location_id', $org['locationId'])->max('number') + 1,
        'issued_year' => 2026, 'patient_id' => $refs['patientId'], 'practitioner_id' => $refs['practitionerId'], 'visit_id' => null,
        'total' => 100, 'paid' => 0, 'status' => 'unpaid', 'issued_at' => now()->toIso8601String(),
        'series' => $fx->table('device')->where('id', $org['deviceId'])->value('series'),
    ]);

    return $id;
}

/** @return array{practitionerId: string, patientId: string, serviceId: string} */
function permissionRefs(array $org): array
{
    $test = test();
    $serviceId = (string) Str::uuid();
    $test->fx()->table('services')->insert([
        'id' => $serviceId, 'org_id' => $org['orgId'], 'name' => 'كشف', 'duration_minutes' => 15, 'default_price' => 100, 'is_active' => true,
    ]);

    return [
        'practitionerId' => $test->makePractitioner($org['orgId'], $test->makeSpecialtyTemplate(null)),
        'patientId' => $test->makePatient($org['orgId']),
        'serviceId' => $serviceId,
    ];
}

test('every server-enforced row of the catalogue: refused without the permission, accepted with it, always for an owner', function () {
    $org = IdentityHarness::org(enforced: true);
    $refs = permissionRefs($org);
    $without = IdentityHarness::credential($org, IdentityHarness::member($org, 'manager', ['reports.view'], 'without'));
    $owner = IdentityHarness::credential($org, $org['ownerId']);

    foreach (catalogueCases($org, $refs) as $case => [$permission, $op]) {
        $refused = pushAs($org, $without, $op());
        expect($refused['reason'] ?? $refused['status'])->toBe('permission_denied', "{$case} without {$permission}");

        $holder = IdentityHarness::credential($org, IdentityHarness::member($org, 'manager', [$permission]));
        expect(pushAs($org, $holder, $op())['status'])->toBe('accepted', "{$case} with {$permission}");
        expect(pushAs($org, $owner, $op())['status'])->toBe('accepted', "{$case} as the owner");
    }
});

test('what the catalogue does not gate needs no permission: a patient added or renamed, an invoice item added', function () {
    $org = IdentityHarness::org(enforced: true);
    $refs = permissionRefs($org);
    $plain = IdentityHarness::credential($org, IdentityHarness::member($org, 'assistant'));

    $patient = permissionOp('patients', 'create', ['id' => $id = (string) Str::uuid(), 'org_id' => $org['orgId'], 'full_name' => 'مريض', 'created_at' => now()->toIso8601String()]);
    expect(pushAs($org, $plain, $patient)['status'])->toBe('accepted');

    $item = permissionOp('invoice_items', 'create', [
        'id' => (string) Str::uuid(), 'invoice_id' => permissionInvoice($org, $refs), 'service_id' => $refs['serviceId'],
        'description' => 'كشف', 'qty' => 1, 'unit_price' => 100, 'total' => 100,
    ]);
    expect(pushAs($org, $plain, $item)['status'])->toBe('accepted');

    $rename = permissionOp('patients', 'update', ['full_name' => 'اسم تاني'], 1, $id);
    expect(pushAs($org, $plain, $rename)['status'])->toBe('accepted');
});

test('a membership\'s role, permissions or username never change by sync, whoever asks', function () {
    $org = IdentityHarness::org(enforced: true);
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $memberId = IdentityHarness::member($org, 'assistant');

    $cases = [
        'a role change' => permissionOp('memberships', 'update', ['role' => 'manager'], 1, $memberId),
        'permissions' => permissionOp('memberships', 'update', ['permissions' => ['cash.close']], 1, $memberId),
        'a username' => permissionOp('memberships', 'update', ['username' => 'someone'], 1, $memberId),
        'a create' => permissionOp('memberships', 'create', [
            'id' => (string) Str::uuid(), 'user_id' => $this->makeUser(), 'org_id' => $org['orgId'], 'role' => 'assistant',
            'location_scope' => 'all', 'practitioner_scope' => 'all', 'practitioner_id' => null, 'pin_hash' => 'h', 'pin_salt' => 's', 'is_active' => true,
        ]),
    ];
    foreach ($cases as $case => $op) {
        expect(pushAs($org, $owner, $op))->toBe(['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'permission_escalation'], $case);
    }

    // The same role, unchanged, is not a change.
    expect(pushAs($org, $owner, permissionOp('memberships', 'update', ['role' => 'assistant', 'display_name' => 'منى'], 1, $memberId))['status'])->toBe('accepted');
    $stored = $this->fx()->table('memberships')->where('id', $memberId)->first();
    expect([$stored->role, $stored->permissions, $stored->username])->toBe(['assistant', '{}', null]);
});

test('nobody but an owner touches an owner\'s membership or its links', function () {
    $org = IdentityHarness::org(enforced: true);
    $manager = IdentityHarness::credential($org, IdentityHarness::member($org, 'manager', ['staff.manage']));

    expect(pushAs($org, $manager, permissionOp('memberships', 'update', ['display_name' => 'x'], 1, $org['ownerId']))['reason'])
        ->toBe('permission_denied');
    expect(pushAs($org, $manager, permissionOp('membership_locations', 'create', [
        'id' => (string) Str::uuid(), 'membership_id' => $org['ownerId'], 'location_id' => $org['locationId'],
    ]))['reason'])->toBe('permission_denied');
});

test('until an organization is enforced, a memberships op naming username or permissions fails as an unknown column did', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant');

    foreach (['username' => 'someone', 'permissions' => ['cash.close']] as $column => $value) {
        $op = permissionOp('memberships', 'update', [$column => $value], 1, $memberId);
        expect(IdentityHarness::send($org, 'POST', '/api/sync/push', ['ops' => [$op]])->json('results.0'))
            ->toBe(['op_id' => $op['op_id'], 'status' => 'failed', 'reason' => 'internal_error']);
    }
    $stored = $this->fx()->table('memberships')->where('id', $memberId)->first();
    expect([$stored->permissions, $stored->username, (int) $stored->rev])->toBe(['{}', null, 1]);
});

test('the guard trigger: a holder of staff.manage grants and removes only what they hold, never for themselves or an owner, never a role', function () {
    $org = IdentityHarness::org(enforced: true);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage', 'reports.view']);
    $memberId = IdentityHarness::member($org, 'assistant', ['cash.close']);
    $update = fn (?string $actor, string $id, array $values) => $this->withMembership($this->asApp(), $actor,
        fn ($db) => $db->table('memberships')->where('id', $id)->update($values));
    $refused = fn (?string $actor, string $id, array $values) => expect(fn () => $update($actor, $id, $values))
        ->toThrow(QueryException::class, 'permission_escalation');

    $update($managerId, $memberId, ['permissions' => '{cash.close,reports.view}']);
    $refused($managerId, $memberId, ['permissions' => '{cash.close,reports.view,invoices.void}']);
    $refused($managerId, $memberId, ['permissions' => '{reports.view}']);
    $refused($managerId, $managerId, ['permissions' => '{staff.manage}']);
    $refused($managerId, $org['ownerId'], ['permissions' => '{reports.view}']);
    $refused($managerId, $memberId, ['role' => 'manager']);
    $refused($org['ownerId'], $org['ownerId'], ['role' => 'manager']);

    // The owner grants anything to anyone else; nobody proven changes nothing at all.
    $update($org['ownerId'], $memberId, ['permissions' => '{invoices.void}', 'role' => 'manager']);
    $update(null, $memberId, ['permissions' => '{}']);
    expect($this->fx()->table('memberships')->where('id', $memberId)->value('role'))->toBe('manager');

    // A write that changes neither column is never checked.
    $update($memberId, $memberId, ['display_name' => 'منى']);

    // An insert holds to the same rule.
    $insert = fn (string $actor, array $permissions, string $role = 'assistant') => $this->withMembership($this->asApp(), $actor,
        fn ($db) => $db->table('memberships')->insert([
            'id' => (string) Str::uuid(), 'user_id' => $this->makeUser(), 'org_id' => $org['orgId'], 'role' => $role,
            'location_scope' => 'all', 'practitioner_scope' => 'all', 'pin_hash' => 'h', 'is_active' => true,
            'permissions' => '{'.implode(',', $permissions).'}',
        ]));
    expect(fn () => $insert($managerId, ['invoices.void']))->toThrow(QueryException::class, 'permission_escalation');
    expect(fn () => $insert($managerId, [], 'owner'))->toThrow(QueryException::class, 'permission_escalation');
});

test('the guard trigger is silent for an organization that is not enforced', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant');

    $this->withMembership($this->asApp(), $memberId, fn ($db) => $db->table('memberships')->where('id', $memberId)
        ->update(['permissions' => '{staff.manage}', 'role' => 'manager']));

    expect($this->fx()->table('memberships')->where('id', $memberId)->value('permissions'))->toBe('{staff.manage}');
});

test('add_staff_member: an owner grants any permissions; a holder of staff.manage only their own, never an owner', function () {
    $org = IdentityHarness::org(enforced: true);
    $managerId = IdentityHarness::member($org, 'manager', ['staff.manage', 'reports.view'], 'boss');
    $manager = IdentityHarness::credential($org, $managerId);
    $payload = fn (array $overrides) => array_merge([
        'membership_id' => (string) Str::uuid(), 'user_id' => (string) Str::uuid(), 'display_name' => 'منى',
        'phone' => '+2010'.random_int(10000000, 99999999), 'role' => 'assistant', 'location_scope' => 'all',
        'practitioner_scope' => 'all', 'practitioner_id' => null, 'pin_hash' => str_repeat('ab', 32), 'pin_salt' => str_repeat('cd', 16),
        'locations' => [], 'practitioners' => [],
    ], $overrides);
    $post = function (?array $credential, array $body) use ($org) {
        $response = IdentityHarness::send($org, 'POST', '/api/staff', $body, $credential);
        test()->adoptAddedStaff($body['membership_id'], $body['user_id']);

        return $response;
    };

    // Enforced: the endpoint needs the person's proof.
    $post(null, $payload([]))->assertStatus(401);

    $byOwner = $payload(['permissions' => ['invoices.void', 'cash.close']]);
    $response = $post(IdentityHarness::credential($org, $org['ownerId']), $byOwner);
    expect($response->assertCreated()->json('membership.permissions'))->toBe(['invoices.void', 'cash.close']);
    expect($this->fx()->table('memberships')->where('id', $byOwner['membership_id'])->value('permissions'))->toBe('{invoices.void,cash.close}');

    $post($manager, $held = $payload(['permissions' => ['reports.view']]))->assertCreated();
    expect($this->fx()->table('audit_log')->where('entity_id', $held['membership_id'])->value('actor_membership_id'))->toBe($managerId);
    $post($manager, $payload(['permissions' => ['reports.view', 'cash.close']]))->assertNotFound();
    $post($manager, $payload(['role' => 'owner']))->assertNotFound();
    $post($manager, $payload(['permissions' => ['not.a.permission']]))->assertStatus(422);
    $post($manager, $payload(['permissions' => ['reports.view', 'reports.view']]))->assertStatus(422);
});

test('add_staff_member without permissions answers exactly as before they existed', function () {
    $org = IdentityHarness::org(bindDeviceKey: false);
    $body = [
        'membership_id' => (string) Str::uuid(), 'user_id' => (string) Str::uuid(), 'display_name' => 'منى',
        'phone' => '+2010'.random_int(10000000, 99999999), 'role' => 'assistant', 'location_scope' => 'all',
        'practitioner_scope' => 'all', 'practitioner_id' => null, 'pin_hash' => str_repeat('ab', 32), 'pin_salt' => str_repeat('cd', 16),
        'locations' => [], 'practitioners' => [],
    ];

    $response = IdentityHarness::send($org, 'POST', '/api/staff', $body);
    test()->adoptAddedStaff($body['membership_id'], $body['user_id']);

    expect(array_keys($response->assertCreated()->json('membership')))->toEqualCanonicalizing([
        'id', 'rev', 'role', 'org_id', 'user_id', 'pin_hash', 'pin_salt', 'is_active', 'display_name',
        'practitioner_id', 'location_scope', 'practitioner_scope',
    ]);
    expect(json_decode($this->fx()->table('audit_log')->where('entity_id', $body['membership_id'])->value('after'), true))->not->toHaveKey('permissions');
});
