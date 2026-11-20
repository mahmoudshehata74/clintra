<?php

use App\Support\ActivationCode;
use App\Support\Identity\Password;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;

/**
 * Owner recovery (docs/design-identity-permissions.md, 3.7; "A1 decisions",
 * 1 and 5): `clintra:mint-activation-code --purpose=owner-recovery` and
 * POST /api/auth/owner-recovery, which runs auth_recover_owner.
 */

/** Mints a code through the real command and returns it as printed (and the whole output). */
function mintCode(array $org, string $purpose = 'owner-recovery', ?string &$output = null): string
{
    $exit = Artisan::call('clintra:mint-activation-code', [
        'org_id' => $org['orgId'], 'location_id' => $org['locationId'], '--purpose' => $purpose,
    ]);
    expect($exit)->toBe(0);
    $output = Artisan::output();
    preg_match('/CLT(-[2-9A-HJKMNP-Z]{4}){4}/', $output, $m);

    return $m[0];
}

/** @return array<string, string> */
function recoveryBody(array $org, string $code, string $username = 'owner', string $password = 'a new owner password'): array
{
    return ['phone' => $org['ownerPhone'], 'code' => $code, 'username' => $username, 'password' => $password];
}

test('an owner-recovery code is single use, expires in 24 hours, is printed once and never logged', function () {
    $org = IdentityHarness::org();
    Log::spy();

    $code = mintCode($org, output: $output);

    $row = $this->fx()->table('activation_codes')->where('code_hash', ActivationCode::hash($code))->first();
    expect($row->purpose)->toBe('owner_recovery');
    expect($row->location_id)->toBe($org['locationId']);
    expect(abs(now()->addHours(24)->diffInSeconds(Carbon::parse($row->expires_at), false)))->toBeLessThan(60);
    expect(json_decode($this->fx()->table('audit_log')->where('entity_id', $row->id)->value('after'), true))
        ->toMatchArray(['purpose' => 'owner_recovery'])->not->toHaveKey('code_hash');
    expect(substr_count($output, $code))->toBe(1);
    Log::shouldNotHaveReceived('info');
    Log::shouldNotHaveReceived('warning');
    Log::shouldNotHaveReceived('debug');
});

test('the command keeps device codes as they were and refuses an unknown purpose', function () {
    $org = IdentityHarness::org();

    $device = mintCode($org, 'device');
    $row = $this->fx()->table('activation_codes')->where('code_hash', ActivationCode::hash($device))->first();
    expect($row->purpose)->toBe('device');
    expect(json_decode($this->fx()->table('audit_log')->where('entity_id', $row->id)->value('after'), true))->not->toHaveKey('purpose');

    expect(Artisan::call('clintra:mint-activation-code', [
        'org_id' => $org['orgId'], 'location_id' => $org['locationId'], '--purpose' => 'admin',
    ]))->toBe(2);
});

test('mint_activation_code refuses an owner-recovery code living longer than 24 hours', function () {
    $org = IdentityHarness::org();

    expect(fn () => $this->asOwner()->select('select mint_activation_code(?::jsonb)', [json_encode([
        'id' => (string) Str::uuid(), 'org_id' => $org['orgId'], 'location_id' => $org['locationId'],
        'code_hash' => hash('sha256', 'x'), 'expires_at' => now()->addHours(25)->toIso8601String(),
        'audit_id' => (string) Str::uuid(), 'purpose' => 'owner_recovery',
    ])]))->toThrow(QueryException::class, 'expires within 24 hours');
});

test('recovery sets a new owner password, keeps the username, revokes every owner credential, uses the code', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $code = mintCode($org);

    $response = IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', recoveryBody($org, $code, 'OWNER'));

    $response->assertOk()->assertExactJson(['membership_id' => $org['ownerId'], 'username' => 'owner']);
    $stored = $this->fx()->table('member_passwords')->where('membership_id', $org['ownerId'])->first();
    expect(Password::verify('a new owner password', $stored->password_hash))->toBeTrue();
    expect($stored->must_change)->toBeFalse();
    expect($this->fx()->table('member_credentials')->where('id', $owner['id'])->value('revoke_reason'))->toBe('password_reset');
    $codeRow = $this->fx()->table('activation_codes')->where('code_hash', ActivationCode::hash($code))->first();
    expect($codeRow->used_at)->not->toBeNull();
    expect($codeRow->used_by_device_id)->toBe($org['deviceId']);

    // Single use.
    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', recoveryBody($org, $code, 'owner', 'another new password'))->assertStatus(401);
});

test('first setup: an owner without a username gets it, and the ledger carries the new rev', function () {
    $org = IdentityHarness::org();
    $this->fx()->table('memberships')->where('id', $org['ownerId'])->update(['username' => null]);
    $this->fx()->table('member_passwords')->where('membership_id', $org['ownerId'])->delete();
    $rev = (int) $this->fx()->table('memberships')->where('id', $org['ownerId'])->value('rev');

    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', recoveryBody($org, mintCode($org), 'Dr.Sami'))
        ->assertOk()->assertJson(['username' => 'dr.sami']);

    expect($this->fx()->table('memberships')->where('id', $org['ownerId'])->value('username'))->toBe('dr.sami');
    $ledger = $this->fx()->table('sync_ledger')->where('entity_id', $org['ownerId'])->first();
    expect([$ledger->entity, (int) $ledger->rev, $ledger->device_id])->toBe(['memberships', $rev + 1, $org['deviceId']]);
});

/**
 * Each case is refused the same way and changes nothing; the right request
 * afterwards still works. At most four failures per test: the fifth from one
 * IP would lock recovery (the next test).
 *
 * @param  array<string, Closure(array, string): array{0: array, 1: array<string, string>}>  $cases
 */
function assertRecoveryFailures(array $org, string $code, array $cases): void
{
    foreach ($cases as $case => $build) {
        [$caller, $body] = $build($org, $code);
        $response = IdentityHarness::send($caller, 'POST', '/api/auth/owner-recovery', $body);
        $response->assertStatus(401);
        expect($response->json())->toBe(['error' => 'recovery_failed', 'message' => 'بيانات الاسترداد غير صحيحة.'], $case);
    }

    $fx = test()->fx();
    expect(Password::verify('owner password 1', $fx->table('member_passwords')->where('membership_id', $org['ownerId'])->value('password_hash')))->toBeTrue();
    expect($fx->table('activation_codes')->where('code_hash', ActivationCode::hash($code))->value('used_at'))->toBeNull();
    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', recoveryBody($org, $code))->assertOk();
}

test('a wrong code, phone or username reads the same, and nothing changes', function () {
    $org = IdentityHarness::org();
    $staffId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $staffPhone = '+2011'.random_int(10000000, 99999999);
    $this->fx()->table('users')->where('id', $this->fx()->table('memberships')->where('id', $staffId)->value('user_id'))->update(['phone' => $staffPhone]);

    assertRecoveryFailures($org, mintCode($org), [
        'a code that does not exist' => fn ($o, $c) => [$o, recoveryBody($o, 'CLT-2222-3333-4444-5555')],
        'another phone' => fn ($o, $c) => [$o, [...recoveryBody($o, $c), 'phone' => '+201099999999']],
        'a staff member phone' => fn ($o, $c) => [$o, [...recoveryBody($o, $c), 'phone' => $staffPhone]],
        'another username' => fn ($o, $c) => [$o, recoveryBody($o, $c, 'someone.else')],
    ]);
});

test('an expired code, a device code and another organization device read the same, and nothing changes', function () {
    $org = IdentityHarness::org();
    $other = IdentityHarness::org();
    $expired = mintCode($org);
    $this->fx()->table('activation_codes')->where('code_hash', ActivationCode::hash($expired))->update(['expires_at' => now()->subMinute()->toIso8601String()]);
    $deviceCode = mintCode($org, 'device');

    assertRecoveryFailures($org, mintCode($org), [
        'an expired code' => fn ($o, $c) => [$o, recoveryBody($o, $expired)],
        'a device code' => fn ($o, $c) => [$o, recoveryBody($o, $deviceCode)],
        'the right code from another organization device' => fn ($o, $c) => [$other, recoveryBody($o, $c)],
    ]);
});

test('recovery is rate limited per code like registration, and checks the new password first', function () {
    $org = IdentityHarness::org();
    $code = mintCode($org);

    $weak = IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', recoveryBody($org, $code, 'owner', 'qwertyuiop'));
    $weak->assertStatus(422);
    expect($weak->json('message'))->toBe('كلمة المرور هذه ضعيفة. اختر كلمة مرور أخرى.');

    for ($i = 0; $i < 5; $i++) {
        IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', [...recoveryBody($org, $code), 'phone' => '+20109999999'.$i])->assertStatus(401);
    }
    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', recoveryBody($org, $code))->assertStatus(429);
});

test('a username another member holds is refused before anything is written', function () {
    $org = IdentityHarness::org();
    $this->fx()->table('memberships')->where('id', $org['ownerId'])->update(['username' => null]);
    IdentityHarness::member($org, 'assistant', [], 'taken');
    $code = mintCode($org);

    IdentityHarness::send($org, 'POST', '/api/auth/owner-recovery', recoveryBody($org, $code, 'TAKEN'))
        ->assertStatus(409)->assertExactJson(['error' => 'username_taken', 'message' => 'اسم المستخدم هذا مستخدم بالفعل.']);
    expect($this->fx()->table('activation_codes')->where('code_hash', ActivationCode::hash($code))->value('used_at'))->toBeNull();
    expect($this->fx()->table('memberships')->where('id', $org['ownerId'])->value('username'))->toBeNull();
});

test('register_device never accepts an owner-recovery code', function () {
    $org = IdentityHarness::org();
    $code = mintCode($org);

    $this->postJson('/api/devices/register', [
        'device_id' => (string) Str::uuid(), 'phone' => $org['ownerPhone'], 'activation_code' => $code,
    ])->assertStatus(401)->assertJson(['error' => 'registration_failed']);

    expect($this->fx()->table('activation_codes')->where('code_hash', ActivationCode::hash($code))->value('used_at'))->toBeNull();
});
