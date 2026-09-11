<?php

use App\Support\ActivationCode;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * Calls register_device(payload) directly as clintra_app (the real caller
 * in production) and returns the caught QueryException, or null if it
 * succeeded.
 */
function callRegisterDevice(array $payload): ?QueryException
{
    try {
        test()->asApp()->selectOne('select register_device(?::jsonb)', [json_encode($payload, JSON_THROW_ON_ERROR)]);

        return null;
    } catch (QueryException $e) {
        return $e;
    }
}

/** @return array<string, mixed> */
function validRegisterDevicePayload(array $fixture): array
{
    return [
        'device_id' => (string) Str::uuid(),
        'phone' => $fixture['phone'],
        'code_hash' => ActivationCode::hash($fixture['plainCode']),
        'audit_device_id' => (string) Str::uuid(),
        'audit_code_used_id' => (string) Str::uuid(),
    ];
}

test('rejects a payload missing a required key', function () {
    $fixture = makeRegistrationFixture();
    $payload = validRegisterDevicePayload($fixture);
    unset($payload['phone']);

    $caught = callRegisterDevice($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a payload with an unknown key, rather than ignoring it', function () {
    $fixture = makeRegistrationFixture();
    $payload = validRegisterDevicePayload($fixture);
    $payload['is_admin'] = true;

    $caught = callRegisterDevice($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
});

test('rejects a device_id that is not a well-formed uuid', function (string $badId) {
    $fixture = makeRegistrationFixture();
    $payload = validRegisterDevicePayload($fixture);
    $payload['device_id'] = $badId;

    $caught = callRegisterDevice($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with(['empty' => [''], 'not a uuid' => ['not-a-uuid'], 'wrong grouping' => ['12345678-1234-1234-1234-1234567890123']]);

test('rejects a phone that is not E.164', function (string $badPhone) {
    $fixture = makeRegistrationFixture();
    $payload = validRegisterDevicePayload($fixture);
    $payload['phone'] = $badPhone;

    $caught = callRegisterDevice($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with(['empty' => [''], 'no plus sign' => ['201001234567'], 'not a number' => ['not-a-phone']]);

test('rejects a code_hash that is not 64 lowercase hex characters', function (string $badHash) {
    $fixture = makeRegistrationFixture();
    $payload = validRegisterDevicePayload($fixture);
    $payload['code_hash'] = $badHash;

    $caught = callRegisterDevice($payload);

    expect($caught)->not->toBeNull();
    expect($caught->getCode())->toBe('22023');
})->with([
    'too short' => [str_repeat('a', 63)],
    'too long' => [str_repeat('a', 65)],
    'uppercase' => [str_repeat('A', 64)],
    'non-hex characters' => [str_repeat('g', 64)],
]);

test('a bad code and a bad phone are indistinguishable from inside the function, not just at the HTTP layer', function () {
    $fixture = makeRegistrationFixture();

    $badCodePayload = validRegisterDevicePayload($fixture);
    $badCodePayload['code_hash'] = ActivationCode::hash('CLT-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    $badCodeCaught = callRegisterDevice($badCodePayload);

    $badPhonePayload = validRegisterDevicePayload($fixture);
    $badPhonePayload['phone'] = '+201099999999';
    $badPhoneCaught = callRegisterDevice($badPhonePayload);

    expect($badCodeCaught)->not->toBeNull();
    expect($badPhoneCaught)->not->toBeNull();

    // Neither is the 22023 shape-validation SQLSTATE — both are genuine
    // credential mismatches, and they must be the exact same SQLSTATE and
    // the exact same message, not just "both errors".
    expect($badCodeCaught->getCode())->not->toBe('22023');
    expect($badCodeCaught->getCode())->toBe($badPhoneCaught->getCode());

    $extractMessage = fn (QueryException $e) => preg_replace('/^SQLSTATE\[[^]]+\]: [^:]*: \d+ /', '', explode("\n", $e->getMessage())[0]);
    expect($extractMessage($badCodeCaught))->toBe($extractMessage($badPhoneCaught));
});

test('single-use is atomic under real concurrency: two simultaneous calls with the same code, only one succeeds', function () {
    $fixture = makeRegistrationFixture();
    $codeHash = ActivationCode::hash($fixture['plainCode']);
    $deviceIdA = (string) Str::uuid();
    $deviceIdB = (string) Str::uuid();

    $config = config('database.connections.pgsql');
    $script = __DIR__.'/../../scripts/register_device_race.php';

    $buildCommand = function (string $deviceId) use ($config, $fixture, $codeHash, $script) {
        $payload = json_encode([
            'device_id' => $deviceId,
            'phone' => $fixture['phone'],
            'code_hash' => $codeHash,
            'audit_device_id' => (string) Str::uuid(),
            'audit_code_used_id' => (string) Str::uuid(),
        ]);

        return [
            PHP_BINARY, $script,
            $config['host'], (string) $config['port'], $config['database'],
            $config['username'], $config['password'], $payload,
        ];
    };

    // Two genuinely separate OS processes/connections, launched without
    // waiting on each other, racing on the same activation code — proves
    // the atomicity claim under real concurrency, not just "call it twice
    // in sequence" (which every other test in this file already does, and
    // which proves nothing about a real race).
    $processA = proc_open($buildCommand($deviceIdA), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesA);
    $processB = proc_open($buildCommand($deviceIdB), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesB);

    $outputA = stream_get_contents($pipesA[1]);
    $outputB = stream_get_contents($pipesB[1]);
    foreach ($pipesA as $pipe) {
        fclose($pipe);
    }
    foreach ($pipesB as $pipe) {
        fclose($pipe);
    }
    proc_close($processA);
    proc_close($processB);

    $results = [trim($outputA), trim($outputB)];
    $successes = array_filter($results, fn ($r) => $r === 'OK');
    $failures = array_filter($results, fn ($r) => $r === 'FAIL');

    expect($results)->each->toBeIn(['OK', 'FAIL']);
    expect($successes)->toHaveCount(1);
    expect($failures)->toHaveCount(1);

    // And the database agrees: exactly one device row, the code used
    // exactly once, pointing at whichever device actually won.
    $deviceRows = $this->fx()->table('device')->where('org_id', $fixture['orgId'])->get();
    expect($deviceRows)->toHaveCount(1);

    $codeRow = $this->fx()->table('activation_codes')->where('id', $fixture['codeId'])->first();
    expect($codeRow->used_at)->not->toBeNull();
    expect($codeRow->used_by_device_id)->toBe($deviceRows->first()->id);

    $this->fx()->table('activation_codes')->where('id', $fixture['codeId'])->update(['used_by_device_id' => null]);
    $this->fx()->table('device')->where('org_id', $fixture['orgId'])->delete();
    $this->fx()->table('audit_log')->where('org_id', $fixture['orgId'])->delete();
});
