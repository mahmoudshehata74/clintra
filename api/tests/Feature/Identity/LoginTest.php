<?php

use App\Support\Identity\AuthCall;
use App\Support\Identity\AuthCallFailed;
use App\Support\Identity\Password;
use Illuminate\Database\QueryException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;
use Tests\Support\TestKey;

/**
 * POST /api/auth/login and POST /api/auth/password, and the step-up
 * every sensitive endpoint shares (docs/design-identity-permissions.md, 3.2
 * and 3.7; "A1 decisions", 3).
 */
/** @return array<string, mixed> */
function loginBody(string $username, string $password, ?TestKey $credentialKey = null, ?array $deviceKey = null): array
{
    return [
        'username' => $username,
        'password' => $password,
        'credential_id' => (string) Str::uuid(),
        'credential_public_key' => ($credentialKey ?? TestKey::make())->jwk,
        'device_public_key' => $deviceKey,
    ];
}

test('a member signs in: a credential bound to them and this device, the membership, an audit row', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant', ['reports.view'], 'mona', 'mona password 1');

    $body = loginBody('Mona', 'mona password 1');
    $response = IdentityHarness::send($org, 'POST', '/api/auth/login', $body);

    $response->assertOk();
    expect($response->json())->toMatchArray([
        'membership_id' => $memberId, 'role' => 'assistant', 'permissions' => ['reports.view'],
        'username' => 'mona', 'must_change_password' => false, 'credential_id' => $body['credential_id'],
    ]);
    $credential = $this->fx()->table('member_credentials')->where('id', $body['credential_id'])->first();
    expect($credential->membership_id)->toBe($memberId);
    expect($credential->device_id)->toBe($org['deviceId']);
    expect(json_decode($credential->public_key, true))->toEqual($body['credential_public_key']);
    expect($this->fx()->table('audit_log')->where('entity', 'member_credentials')->where('entity_id', $body['credential_id'])
        ->value('actor_membership_id'))->toBe($memberId);
    expect($this->fx()->table('login_attempts')->where('membership_id', $memberId)->value('succeeded'))->toBeTrue();
});

test('a second sign-in on the same device replaces the first credential', function () {
    $org = IdentityHarness::org();
    IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');

    $first = loginBody('mona', 'mona password 1');
    IdentityHarness::send($org, 'POST', '/api/auth/login', $first)->assertOk();
    $second = loginBody('mona', 'mona password 1');
    IdentityHarness::send($org, 'POST', '/api/auth/login', $second)->assertOk();

    expect($this->fx()->table('member_credentials')->where('id', $first['credential_id'])->value('revoke_reason'))->toBe('replaced');
    expect($this->fx()->table('member_credentials')->where('id', $second['credential_id'])->value('revoked_at'))->toBeNull();
});

test('a wrong password and an unknown username read the same', function () {
    $org = IdentityHarness::org();
    IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');

    $wrong = IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'not her password'));
    $unknown = IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('nobody', 'mona password 1'));

    $wrong->assertStatus(401);
    $unknown->assertStatus(401);
    expect($wrong->getContent())->toBe($unknown->getContent());
    expect($wrong->json())->toBe(['error' => 'invalid_credentials', 'message' => 'اسم المستخدم أو كلمة المرور غير صحيحة.']);
    expect($this->fx()->table('member_credentials')->where('org_id', $org['orgId'])->count())->toBe(0);
});

test('a deactivated member cannot sign in, and another organization\'s member is unknown here', function () {
    $org = IdentityHarness::org();
    $other = IdentityHarness::org();
    IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1', ['is_active' => false]);
    IdentityHarness::member($other, 'assistant', [], 'sara', 'sara password 1');

    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'mona password 1'))->assertStatus(401);
    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('sara', 'sara password 1'))->assertStatus(401);
    expect($this->fx()->table('member_credentials')->whereIn('org_id', [$org['orgId'], $other['orgId']])->count())->toBe(0);
});

test('five failed sign-ins of one username lock it for fifteen minutes, and only failed ones count', function () {
    $org = IdentityHarness::org();
    IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');

    // Successful sign-ins never count.
    for ($i = 0; $i < 6; $i++) {
        IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'mona password 1'))->assertOk();
    }
    for ($i = 0; $i < 5; $i++) {
        IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'wrong password'))->assertStatus(401);
    }

    $locked = IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'mona password 1'));
    $locked->assertStatus(429);
    expect($locked->json())->toBe(['error' => 'too_many_attempts', 'message' => 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.']);

    // Fifteen minutes after the fifth failure it clears.
    $this->fx()->table('login_attempts')->where('org_id', $org['orgId'])->update(['at' => now()->subMinutes(16)->toIso8601String()]);
    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'mona password 1'))->assertOk();
});

test('a begin that never completes spends the limit, as a failure', function () {
    $org = IdentityHarness::org();

    $begin = fn () => $this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->selectOne(
        'select auth_login_begin(?::jsonb) as r', [json_encode(['device_id' => $org['deviceId'], 'username' => 'ghost', 'kind' => 'login'])]
    ));
    for ($i = 0; $i < 5; $i++) {
        $begin();
    }

    expect(fn () => $begin())->toThrow(QueryException::class, 'rate limited');
});

test('twenty failures from one device in an hour lock the device, whatever the usernames', function () {
    $org = IdentityHarness::org();

    for ($i = 0; $i < 20; $i++) {
        IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('user'.$i, 'wrong password'))->assertStatus(401);
    }

    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('owner', 'owner password 1'))->assertStatus(429);
});

test('a hundred failures in a day lock the organization on every device', function () {
    $org = IdentityHarness::org();
    $otherDevice = $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);

    $rows = [];
    for ($i = 0; $i < 100; $i++) {
        $rows[] = ['org_id' => $org['orgId'], 'device_id' => $otherDevice, 'username' => 'user'.$i, 'at' => now()->subHours(2)->toIso8601String()];
    }
    $this->fx()->table('login_attempts')->insert($rows);

    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('owner', 'owner password 1'))->assertStatus(429);

    $this->fx()->table('login_attempts')->where('device_id', $otherDevice)->delete();
});

test('a stored hash with old parameters is rehashed on the next sign-in', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $old = $this->fx()->table('member_passwords')->where('membership_id', $memberId)->value('password_hash');

    Config::set('identity.argon.time_cost', 2);
    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'mona password 1'))->assertOk();

    $new = $this->fx()->table('member_passwords')->where('membership_id', $memberId)->value('password_hash');
    expect($new)->not->toBe($old)->toContain('t=2');
    expect(Password::verify('mona password 1', $new))->toBeTrue();
});

test('an unbound device binds its key only with that key\'s own proof', function () {
    $org = IdentityHarness::org(bindDeviceKey: false);
    $deviceKey = TestKey::make();
    $body = loginBody('owner', 'owner password 1', deviceKey: $deviceKey->jwk);

    // Signed by another key: refused, nothing bound.
    $forged = IdentityHarness::deviceProof(TestKey::make(), 'POST', '/api/auth/login', json_encode($body));
    IdentityHarness::send($org, 'POST', '/api/auth/login', $body, headers: ['X-Clintra-Device-Proof' => $forged])->assertStatus(401);
    expect($this->fx()->table('device')->where('id', $org['deviceId'])->value('public_key'))->toBeNull();

    $proof = IdentityHarness::deviceProof($deviceKey, 'POST', '/api/auth/login', json_encode($body));
    IdentityHarness::send($org, 'POST', '/api/auth/login', $body, headers: ['X-Clintra-Device-Proof' => $proof])->assertOk();
    expect(json_decode($this->fx()->table('device')->where('id', $org['deviceId'])->value('public_key'), true))->toEqual($deviceKey->jwk);
});

test('a bound device signs in only with its device proof', function () {
    $org = IdentityHarness::org();
    $body = loginBody('owner', 'owner password 1');

    IdentityHarness::send($org, 'POST', '/api/auth/login', $body, headers: ['X-Clintra-Device-Proof' => ''])->assertStatus(401);
    $wrongKey = IdentityHarness::deviceProof(TestKey::make(), 'POST', '/api/auth/login', json_encode($body));
    IdentityHarness::send($org, 'POST', '/api/auth/login', $body, headers: ['X-Clintra-Device-Proof' => $wrongKey])->assertStatus(401);
    IdentityHarness::send($org, 'POST', '/api/auth/login', $body)->assertOk();
});

test('six successful step-ups in fifteen minutes do not lock; five wrong ones do', function () {
    $org = IdentityHarness::org();
    $owner = IdentityHarness::credential($org, $org['ownerId']);
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $credential = IdentityHarness::credential($org, $memberId);

    for ($i = 0; $i < 6; $i++) {
        IdentityHarness::send($org, 'DELETE', '/api/staff/credentials/'.$credential['id'], ['password' => 'owner password 1'], $owner)
            ->assertStatus($i === 0 ? 200 : 404);
    }
    expect($this->fx()->table('login_attempts')->where('membership_id', $org['ownerId'])->where('kind', 'step_up')->where('succeeded', true)->count())->toBe(6);

    for ($i = 0; $i < 5; $i++) {
        $wrong = IdentityHarness::send($org, 'DELETE', '/api/staff/credentials/'.$credential['id'], ['password' => 'wrong password'], $owner);
        $wrong->assertStatus(403);
        expect($wrong->json())->toBe(['error' => 'step_up_failed', 'message' => 'كلمة المرور غير صحيحة.']);
    }

    IdentityHarness::send($org, 'DELETE', '/api/staff/credentials/'.$credential['id'], ['password' => 'owner password 1'], $owner)->assertStatus(429);
    // The owner's username is locked for sign-in too: one limit per person.
    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('owner', 'owner password 1'))->assertStatus(429);
});

test('a member changes their own password with the current or temporary one, under the rules', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'temporary pw 1');
    $credential = IdentityHarness::credential($org, $memberId);
    $change = fn (string $current, string $new) => IdentityHarness::send($org, 'POST', '/api/auth/password', [
        'current_password' => $current, 'password' => $new,
    ], $credential);

    expect($change('temporary pw 1', 'short')->assertStatus(422)->json('message'))->toBe('يجب أن تتضمن كلمة المرور 10 أحرف على الأقل.');
    expect($change('temporary pw 1', str_repeat('ك', 129))->assertStatus(422)->json('message'))->toBe('يجب ألا تتجاوز كلمة المرور 128 حرفًا.');
    expect($change('temporary pw 1', 'QwertyUIOP')->assertStatus(422)->json('message'))->toBe('كلمة المرور هذه ضعيفة. اختر كلمة مرور أخرى.');
    expect($change('temporary pw 1', 'ZAMALEK1911')->assertStatus(422)->json('message'))->toBe('كلمة المرور هذه ضعيفة. اختر كلمة مرور أخرى.');
    expect($change('temporary pw 1', 'MONA')->assertStatus(422)->json('message'))->toBe('يجب أن تتضمن كلمة المرور 10 أحرف على الأقل.');
    $this->fx()->table('memberships')->where('id', $memberId)->update(['username' => 'mona.ahmed12']);
    expect($change('temporary pw 1', 'Mona.Ahmed12')->assertStatus(422)->json('message'))->toBe('كلمة المرور هذه ضعيفة. اختر كلمة مرور أخرى.');
    $change('wrong current', 'كلمة سر جديدة طويلة')->assertStatus(403);

    $change('temporary pw 1', 'كلمة سر جديدة طويلة')->assertOk()->assertExactJson(['must_change_password' => false]);

    $stored = $this->fx()->table('member_passwords')->where('membership_id', $memberId)->first();
    expect(Password::verify('كلمة سر جديدة طويلة', $stored->password_hash))->toBeTrue();
    expect($stored->must_change)->toBeFalse();
    expect($stored->set_by_membership_id)->toBe($memberId);
});

test('changing a password needs a person proof of a live credential on this device', function () {
    $org = IdentityHarness::org();
    $memberId = IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $elsewhere = $this->makeDevice($org['orgId'], $org['locationId'], $org['ownerId']);
    $foreign = IdentityHarness::credential($org, $memberId, $elsewhere);
    $body = ['current_password' => 'mona password 1', 'password' => 'a brand new one 9'];

    IdentityHarness::send($org, 'POST', '/api/auth/password', $body)->assertStatus(401);
    IdentityHarness::send($org, 'POST', '/api/auth/password', $body, $foreign)->assertStatus(401);

    $live = IdentityHarness::credential($org, $memberId);
    $this->fx()->table('member_credentials')->where('id', $live['id'])
        ->update(['revoked_at' => now()->toIso8601String(), 'revoke_reason' => 'owner_revoked']);
    IdentityHarness::send($org, 'POST', '/api/auth/password', $body, $live)->assertStatus(401);
    expect(Password::verify('mona password 1', $this->fx()->table('member_passwords')->where('membership_id', $memberId)->value('password_hash')))->toBeTrue();
});

test('no password, hash or proof reaches the log, on success or failure, nor in an auth function\'s failure', function () {
    $org = IdentityHarness::org();
    IdentityHarness::member($org, 'assistant', [], 'mona', 'mona password 1');
    $logged = [];
    Event::listen(MessageLogged::class, function ($event) use (&$logged) {
        $logged[] = $event->message.' '.json_encode($event->context);
    });

    $success = loginBody('mona', 'mona password 1');
    IdentityHarness::send($org, 'POST', '/api/auth/login', $success)->assertOk();
    IdentityHarness::send($org, 'POST', '/api/auth/login', loginBody('mona', 'a wrong secret 77'))->assertStatus(401);

    $hash = Password::hash('a hash that must not leak');
    try {
        AuthCall::run('auth_set_password', [
            'membership_id' => (string) Str::uuid(), 'new_hash' => $hash, 'attempt_id' => 1, 'audit_id' => (string) Str::uuid(),
        ]);
        $failure = null;
    } catch (AuthCallFailed $e) {
        $failure = $e;
        report($e);
    }

    expect($failure?->getMessage())->toBe('auth_set_password failed (SQLSTATE P0001)');
    $text = implode("\n", $logged);
    foreach (['mona password 1', 'a wrong secret 77', '$argon2id$', $hash, $success['credential_public_key']['x']] as $secret) {
        expect($text)->not->toContain($secret);
    }
});
