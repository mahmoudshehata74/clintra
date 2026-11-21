<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

function assertOnePlatformCliLog(string $action, int $before, bool $success): object
{
    $db = test()->asOwner();
    expect($db->table('platform.admin_log')->count())->toBe($before + 1);
    $log = $db->table('platform.admin_log')->orderByDesc('seq')->first();
    expect($log->action)->toBe($action)->and($log->succeeded)->toBe($success)->and($log->admin_user_id)->toBeNull();
    expect(json_decode($log->detail, true)['host_user'])->toBeString()->not->toBeEmpty();

    return $log;
}

test('admin create prints one password one TOTP URI ten recovery codes and logs exactly once', function () {
    $db = $this->asOwner();
    $db->beginTransaction();
    try {
        $before = $db->table('platform.admin_log')->count();
        $email = 'create-'.$this->platformId().'@example.invalid';
        expect(Artisan::call('clintra:admin:create', ['email' => strtoupper($email), 'name' => 'Created admin']))->toBe(0);
        $output = Artisan::output();
        expect(substr_count($output, 'Password: '))->toBe(1)->and(substr_count($output, 'TOTP URI: '))->toBe(1);
        preg_match('/Password: ([a-f0-9]{32})/', $output, $password);
        preg_match('/TOTP URI: (otpauth:\/\/[^\s]+)/', $output, $uri);
        expect($password)->toHaveCount(2)->and($uri)->toHaveCount(2);
        $admin = $db->table('platform.admin_users')->where('email', $email)->sole();
        expect($db->selectOne('SELECT password_hash=platform_crypto.crypt(?,password_hash) AS matches FROM platform.admin_users WHERE id=?', [$password[1], $admin->id])->matches)->toBeTrue();
        expect($admin->password_hash)->toStartWith('$2a$12$');
        parse_str(parse_url($uri[1], PHP_URL_QUERY), $query);
        expect($query['issuer'])->toBe('Clintra')->and($query['algorithm'])->toBe('SHA1')->and($query['period'])->toBe('30')->and($query['digits'])->toBe('6');
        expect($query['secret'])->toMatch('/^[A-Z2-7]{32}$/');
        $bytes = '';
        $buffer = 0;
        $bits = 0;
        foreach (str_split($query['secret']) as $character) {
            $buffer = ($buffer << 5) | strpos('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', $character);
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $bytes .= chr(($buffer >> $bits) & 255);
                $buffer &= (1 << $bits) - 1;
            }
        }
        expect(bin2hex($bytes))->toBe($db->selectOne("SELECT encode(totp_secret,'hex') AS secret FROM platform.admin_users WHERE id=?", [$admin->id])->secret);
        preg_match_all('/^([a-f0-9]{32})\r?$/m', $output, $recovery);
        expect($recovery[1])->toHaveCount(10)->and(array_unique($recovery[1]))->toHaveCount(10);
        $hashes = $db->table('platform.admin_recovery_codes')->where('admin_user_id', $admin->id)->pluck('code_hash')->sort()->values()->all();
        $expected = array_map(fn ($code) => hash('sha256', $code), $recovery[1]);
        sort($expected);
        expect($hashes)->toBe($expected);
        $log = assertOnePlatformCliLog('cli.admin_create', $before, true);
        expect($log->target_id)->toBe($admin->id);
        foreach ([$password[1], $query['secret'], ...$recovery[1]] as $secret) {
            expect($log->detail)->not->toContain($secret);
        }
    } finally {
        $db->rollBack();
    }
});

test('admin create refusals log exactly once without creating an account', function () {
    $before = $this->asOwner()->table('platform.admin_log')->count();
    expect(Artisan::call('clintra:admin:create', ['email' => 'bad-email', 'name' => 'Admin']))->toBe(2);
    assertOnePlatformCliLog('cli.admin_create', $before, false);
});

test('provision CLI records exactly one immutable operator log on success', function () {
    $db = $this->asOwner();
    $db->beginTransaction();
    try {
        $before = $db->table('platform.admin_log')->count();
        $this->artisan('clintra:provision')
            ->expectsQuestion('Organization name', 'B1 CLI test')
            ->expectsQuestion('Location name', 'Main')
            ->expectsQuestion('Location address', 'Test address')
            ->expectsQuestion('Location phone', '01001234567')
            ->expectsQuestion("Doctor's full name", 'B1 owner')
            ->expectsQuestion("Doctor's phone", '01000000991')
            ->expectsQuestion('PIN (4 digits)', '1234')->expectsQuestion('Confirm PIN', '1234')->assertSuccessful();
        $log = assertOnePlatformCliLog('cli.provision', $before, true);
        expect($log->target_id)->not->toBeNull()->and(json_decode($log->detail, true)['org_id'])->toBe($log->target_id);
    } finally {
        $db->rollBack();
    }
});

test('provision CLI records exactly one refusal after its transaction rolls back', function () {
    $before = $this->asOwner()->table('platform.admin_log')->count();
    try {
        $command = $this->artisan('clintra:provision')
            ->expectsQuestion('Organization name', 'B1 refused setup')->expectsQuestion('Location name', 'Main')
            ->expectsQuestion('Location address', 'Test address');
        for ($i = 0; $i < 5; $i++) {
            $command->expectsQuestion('Location phone', 'invalid');
        }
        $command->run();
        $this->fail('Expected invalid phone input to be refused');
    } catch (RuntimeException $e) {
        expect($e->getMessage())->toContain('Could not read a valid phone number');
    }
    assertOnePlatformCliLog('cli.provision', $before, false);
});

test('mint CLI logs exactly once for success and refusal', function (bool $success) {
    $org = $this->makeOrganization('B1 mint');
    $location = $this->makeLocation($org);
    $this->makeMembership($this->makeUser(), $org, ['role' => 'owner']);
    $this->cleanupFirst(function () use ($org) {
        $this->fx()->table('audit_log')->where('org_id', $org)->delete();
        $this->fx()->table('activation_codes')->where('org_id', $org)->delete();
    });
    $before = $this->asOwner()->table('platform.admin_log')->count();
    $this->artisan('clintra:mint-activation-code', ['org_id' => $org, 'location_id' => $location, '--purpose' => $success ? 'device' : 'invalid'])->assertExitCode($success ? 0 : 2);
    assertOnePlatformCliLog('cli.mint', $before, $success);
})->with([true, false]);

test('revoke CLI logs exactly once including its idempotent path', function () {
    $org = $this->makeOrganization('B1 revoke');
    $location = $this->makeLocation($org);
    $member = $this->makeMembership($this->makeUser(), $org, ['role' => 'owner']);
    $device = $this->makeDevice($org, $location, $member);
    $this->cleanupFirst(fn () => $this->fx()->table('audit_log')->where('org_id', $org)->delete());
    for ($i = 0; $i < 2; $i++) {
        $before = $this->asOwner()->table('platform.admin_log')->count();
        $this->artisan('clintra:revoke-device', ['device_id' => $device])->assertSuccessful();
        expect(assertOnePlatformCliLog('cli.revoke', $before, true)->target_id)->toBe($device);
    }
});

test('revoke CLI logs exactly one failure and restores its role', function () {
    $before = $this->asOwner()->table('platform.admin_log')->count();
    try {
        $this->artisan('clintra:revoke-device', ['device_id' => $this->platformId()])->run();
        $this->fail('Expected missing device refusal');
    } catch (RuntimeException $e) {
        expect($e->getMessage())->toContain('No device found');
    }
    assertOnePlatformCliLog('cli.revoke', $before, false);
    expect($this->asOwner()->selectOne('SELECT current_user AS role')->role)->toBe('clintra_owner');
});

test('the CLI log function accepts only CLI actions with a host user and always has a null admin', function () {
    $p = ['log_id' => $this->platformId(), 'action' => 'cli.mint', 'target_id' => null, 'succeeded' => false, 'reason' => 'command_refused', 'detail' => ['host_user' => 'test-operator']];
    $before = $this->asOwner()->table('platform.admin_log')->count();
    $this->asOwner()->selectOne('SELECT platform.admin_log_cli(?::jsonb)', [json_encode($p)]);
    assertOnePlatformCliLog('cli.mint', $before, false);
    foreach ([['action' => 'admin.login'], ['detail' => ['host_user' => '']]] as $change) {
        $bad = array_replace($p, $change);
        $bad['log_id'] = $this->platformId();
        try {
            $this->asOwner()->selectOne('SELECT platform.admin_log_cli(?::jsonb)',[json_encode($bad)]);
            $this->fail('Expected malformed CLI log refusal');
        } catch (QueryException $e) {
            expect($e->getCode())->toBe('22023');
        }
    }
});
