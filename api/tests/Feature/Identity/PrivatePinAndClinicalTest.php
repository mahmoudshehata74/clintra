<?php

use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;
use Tests\Support\TestKey;

test('enforced registration and sync omit PIN secrets while the persons own login returns them', function (bool $enforced) {
    $org = IdentityHarness::org(enforced: $enforced);
    $assistant = IdentityHarness::member($org, 'assistant', ['reports.view'], 'mona');
    $deviceId = (string) Str::uuid();
    $code = 'CLT-7F3K-9QRT-4XWM-2BCD';
    $this->makeActivationCode($org['orgId'], $org['locationId'], $code);
    $register = $this->postJson('/api/devices/register', [
        'activation_code' => $code, 'phone' => $org['ownerPhone'], 'device_id' => $deviceId,
    ])->assertOk();
    $this->track('device', $deviceId);
    $this->cleanupFirst(fn () => $this->fx()->table('personal_access_tokens')->where('tokenable_id', $deviceId)->delete());
    $members = $register->json('memberships');
    foreach ($members as $member) {
        expect(array_key_exists('pin_hash', $member))->toBe(! $enforced);
        expect(array_key_exists('pin_salt', $member))->toBe(! $enforced);
    }
    expect(array_key_exists('identity_enforced_at', $register->json()))->toBe($enforced);

    $this->makeSyncLedgerRow($org['orgId'], $org['ownerId'], $org['deviceId'], ['entity' => 'memberships', 'entity_id' => $assistant]);
    $pull = IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk();
    $member = collect($pull->json('rows'))->firstWhere('entity_id', $assistant)['payload'];
    expect(array_key_exists('pin_hash', $member))->toBe(! $enforced);
    expect(array_key_exists('pin_salt', $member))->toBe(! $enforced);

    $key = TestKey::make();
    $device = [...$org, 'token' => $register->json('token'), 'deviceKey' => $key, 'deviceId' => $deviceId];
    $login = IdentityHarness::send($device, 'POST', '/api/auth/login', [
        'username' => 'owner', 'password' => 'owner password 1', 'credential_id' => (string) Str::uuid(),
        'credential_public_key' => TestKey::make()->jwk, 'device_public_key' => $key->jwk,
    ])->assertOk();
    expect($login->json())->toHaveKeys(['pin_hash', 'pin_salt'])->not->toHaveKey('memberships');
    expect($login->json('membership_id'))->toBe($org['ownerId']);
})->with(['enforced' => true, 'legacy' => false]);

test('a proven clinical form write requires the visits own practitioner', function () {
    $org = IdentityHarness::org(enforced: true);
    $specialty = $this->makeSpecialtyTemplate(null);
    $practitioner = $this->makePractitioner($org['orgId'], $specialty);
    $definition = $this->makeFormDefinition($specialty);
    $patient = $this->makePatient($org['orgId']);
    $visit = $this->makeVisit($org['orgId'], $org['locationId'], $practitioner, $patient, $org['ownerId'], ['status' => 'in_room']);
    $form = (string) Str::uuid();
    $mine = IdentityHarness::credential($org, IdentityHarness::member($org, 'practitioner', [], overrides: ['practitioner_id' => $practitioner]));
    $other = IdentityHarness::credential($org, IdentityHarness::member($org, 'assistant', ['clinical.view']));
    $send = function (array $credential) use ($org, $form, $visit, $definition) {
        $op = IdentityHarness::signOp($org, [
            'op_id' => (string) Str::uuid(), 'entity' => 'visit_form_data', 'entity_id' => $form, 'action' => 'create',
            'payload' => ['id' => $form, 'visit_id' => $visit, 'form_definition_id' => $definition, 'data' => ['complaint' => 'ألم']],
            'created_at' => '2026-11-20T12:00:00.000Z',
        ], $credential);

        return IdentityHarness::send($org, 'POST', '/api/sync/push', ['ops' => [$op]])->assertOk();
    };
    try {
        $send($other)->assertJsonPath('results.0.reason', 'permission_denied');
        $send($mine)->assertJsonPath('results.0.status', 'accepted');
    } finally {
        $this->fx()->table('visit_form_data')->where('id', $form)->delete();
    }
});
