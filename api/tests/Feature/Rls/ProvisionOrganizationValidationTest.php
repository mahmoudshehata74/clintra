<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * A complete, valid provision_organization() payload — every test below
 * starts from this and breaks exactly one rule, so a failure always means
 * that one rule's check (not some other missing field) is what rejected it.
 *
 * @return array<string, mixed>
 */
function validProvisioningPayload(): array
{
    $specialtyId = test()->makeSpecialtyTemplate(null, 'validation-'.Str::random(8));
    $orgId = (string) Str::uuid();

    return [
        'org_id' => $orgId,
        'org_name' => 'Test Org',
        'plan_tier' => 'small',
        'location_id' => (string) Str::uuid(),
        'location_name' => 'Test Location',
        'location_address' => 'Test Address',
        'location_phone' => '+201001234567',
        'location_org_id' => $orgId,
        'user_id' => (string) Str::uuid(),
        'user_full_name' => 'Test User',
        'user_phone' => '+201000000099',
        'practitioner_id' => (string) Str::uuid(),
        'practitioner_title' => 'Doctor',
        'practitioner_org_id' => $orgId,
        'specialty_id' => $specialtyId,
        'practitioner_location_id' => (string) Str::uuid(),
        'membership_id' => (string) Str::uuid(),
        'membership_org_id' => $orgId,
        'role' => 'owner',
        'location_scope' => 'all',
        'practitioner_scope' => 'all',
        'pin_hash' => str_repeat('a', 64),
        'pin_salt' => str_repeat('b', 32),
        'activation_code_id' => (string) Str::uuid(),
        'activation_code_hash' => str_repeat('c', 64),
        'activation_code_expires_at' => now()->addHours(72)->toIso8601String(),
        'audit_organization_id' => (string) Str::uuid(),
        'audit_location_id' => (string) Str::uuid(),
        'audit_user_id' => (string) Str::uuid(),
        'audit_practitioner_id' => (string) Str::uuid(),
        'audit_practitioner_location_id' => (string) Str::uuid(),
        'audit_membership_id' => (string) Str::uuid(),
        'audit_activation_code_id' => (string) Str::uuid(),
    ];
}

/**
 * Calls provision_organization(payload) directly as clintra_owner and
 * returns the caught QueryException, or null if it succeeded (a bug in the
 * test itself, since every case here is expected to be rejected).
 */
function callProvisionOrganization(array $payload): ?QueryException
{
    try {
        test()->asOwner()->selectOne('select provision_organization(?::jsonb)', [json_encode($payload, JSON_THROW_ON_ERROR)]);

        return null;
    } catch (QueryException $e) {
        return $e;
    }
}

test('rejects a payload missing a required key', function () {
    $payload = validProvisioningPayload();
    unset($payload['org_name']);

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a payload with a required key present but null', function () {
    $payload = validProvisioningPayload();
    $payload['location_name'] = null;

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a payload with an unknown key, rather than ignoring it', function () {
    $payload = validProvisioningPayload();
    $payload['is_admin'] = true;

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a role other than owner', function () {
    $payload = validProvisioningPayload();
    $payload['role'] = 'assistant';

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a location_scope other than all', function () {
    $payload = validProvisioningPayload();
    $payload['location_scope'] = 'listed';

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a practitioner_scope other than all', function () {
    $payload = validProvisioningPayload();
    $payload['practitioner_scope'] = 'self';

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a pin_hash that is not 64 lowercase hex characters', function (string $badHash) {
    $payload = validProvisioningPayload();
    $payload['pin_hash'] = $badHash;

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with([
    'too short' => [str_repeat('a', 63)],
    'too long' => [str_repeat('a', 65)],
    'uppercase' => [str_repeat('A', 64)],
    'non-hex characters' => [str_repeat('g', 64)],
]);

test('rejects a pin_salt that is not 32 lowercase hex characters', function (string $badSalt) {
    $payload = validProvisioningPayload();
    $payload['pin_salt'] = $badSalt;

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with([
    'too short' => [str_repeat('b', 31)],
    'too long' => [str_repeat('b', 33)],
    'uppercase' => [str_repeat('B', 32)],
    'non-hex characters' => [str_repeat('z', 32)],
]);

test('rejects a non-E.164 location_phone', function (string $badPhone) {
    $payload = validProvisioningPayload();
    $payload['location_phone'] = $badPhone;

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with(['empty' => [''], 'no plus sign' => ['201001234567'], 'not a number' => ['not-a-phone']]);

test('rejects a non-E.164 user_phone', function (string $badPhone) {
    $payload = validProvisioningPayload();
    $payload['user_phone'] = $badPhone;

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with(['empty' => [''], 'no plus sign' => ['201001234567'], 'not a number' => ['not-a-phone']]);

test('rejects a specialty_id that does not exist', function () {
    $payload = validProvisioningPayload();
    $payload['specialty_id'] = (string) Str::uuid();

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a specialty_id that exists but is org-scoped, not system-wide', function () {
    $payload = validProvisioningPayload();
    $someOtherOrg = $this->makeOrganization('org-scoped-specialty-owner');
    $payload['specialty_id'] = $this->makeSpecialtyTemplate($someOtherOrg, 'org-scoped-'.Str::random(8));

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a location_org_id that does not match org_id', function () {
    $payload = validProvisioningPayload();
    $payload['location_org_id'] = (string) Str::uuid();

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a practitioner_org_id that does not match org_id', function () {
    $payload = validProvisioningPayload();
    $payload['practitioner_org_id'] = (string) Str::uuid();

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a membership_org_id that does not match org_id', function () {
    $payload = validProvisioningPayload();
    $payload['membership_org_id'] = (string) Str::uuid();

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects an activation_code_hash that is not 64 lowercase hex characters', function (string $badHash) {
    $payload = validProvisioningPayload();
    $payload['activation_code_hash'] = $badHash;

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with([
    'too short' => [str_repeat('c', 63)],
    'too long' => [str_repeat('c', 65)],
    'uppercase' => [str_repeat('C', 64)],
    'non-hex characters' => [str_repeat('g', 64)],
]);

test('rejects an activation_code_expires_at that is not in the future', function () {
    $payload = validProvisioningPayload();
    $payload['activation_code_expires_at'] = now()->subMinute()->toIso8601String();

    $caught = callProvisionOrganization($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('accepts a fully valid payload (control case for every rejection test above)', function () {
    $payload = validProvisioningPayload();

    $caught = callProvisionOrganization($payload);

    expect($caught)->toBeNull();

    // Clean up the org this control case actually created.
    $this->fx()->table('audit_log')->where('org_id', $payload['org_id'])->delete();
    $this->fx()->table('activation_codes')->where('id', $payload['activation_code_id'])->delete();
    $this->fx()->table('memberships')->where('id', $payload['membership_id'])->delete();
    $this->fx()->table('practitioner_locations')->where('id', $payload['practitioner_location_id'])->delete();
    $this->fx()->table('practitioners')->where('id', $payload['practitioner_id'])->delete();
    $this->fx()->table('locations')->where('id', $payload['location_id'])->delete();
    $this->fx()->table('organizations')->where('id', $payload['org_id'])->delete();
    $this->fx()->table('users')->where('id', $payload['user_id'])->delete();
});
