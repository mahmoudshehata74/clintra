<?php

use App\Support\ActivationCode;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;

function changeSuspension(array $org, bool $disabled, ?string $reason = 'test suspension'): array
{
    $row = DB::connection('pgsql_owner')->selectOne('SELECT set_organization_disabled(?::jsonb) AS result', [json_encode([
        'org_id' => $org['orgId'], 'disabled' => $disabled, 'reason' => $reason,
        'actor_membership_id' => $org['ownerId'], 'audit_id' => (string) Str::uuid(),
    ])]);

    return json_decode($row->result, true);
}

test('suspension retains tokens and data, denies every device endpoint, and enabling restores the same token', function () {
    $org = IdentityHarness::org();
    $other = IdentityHarness::org();
    $patient = $this->makePatient($org['orgId']);
    expect(changeSuspension($org, true)['changed'])->toBeTrue();
    foreach ([
        ['GET', '/api/sync/pull'], ['GET', '/api/sync/bootstrap'], ['GET', '/api/audit/pull'],
        ['POST', '/api/sync/push'], ['POST', '/api/audit/push'], ['POST', '/api/staff'],
        ['POST', '/api/auth/login'], ['POST', '/api/auth/password'], ['POST', '/api/auth/owner-recovery'],
        ['GET', '/api/staff/credentials'], ['GET', '/api/auth/rollout'], ['POST', '/api/auth/rollout/enable'],
    ] as [$method, $path]) {
        IdentityHarness::send($org, $method, $path)->assertStatus(403)
            ->assertExactJson(['error' => 'org_disabled', 'message' => 'حساب العيادة موقوف مؤقتًا. تواصل مع فريق كلينترا.']);
    }
    $this->flushHeaders();
    $this->getJson('/api/sync/pull')->assertUnauthorized();
    IdentityHarness::send($other, 'GET', '/api/sync/pull')->assertOk();
    $visible = $this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->table('patients')->get());
    expect($visible)->toHaveCount(0);
    expect($this->fx()->table('patients')->where('id', $patient)->exists())->toBeTrue()
        ->and($this->fx()->table('personal_access_tokens')->where('tokenable_id', $org['deviceId'])->exists())->toBeTrue();
    expect(changeSuspension($org, false)['changed'])->toBeTrue();
    IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk();
    expect($this->withMembership($this->asApp(), $org['ownerId'], fn ($db) => $db->table('patients')->count()))->toBe(1);
});

test('only a valid registration reveals suspension and its code remains unused', function () {
    $org = IdentityHarness::org();
    $code = ActivationCode::generate();
    $codeId = $this->makeActivationCode($org['orgId'], $org['locationId'], $code);
    changeSuspension($org, true);
    $body = ['device_id' => (string) Str::uuid(), 'phone' => $org['ownerPhone'], 'activation_code' => $code];
    $this->cleanupFirst(function () use ($body) {
        $this->fx()->table('personal_access_tokens')->where('tokenable_id', $body['device_id'])->delete();
        $this->fx()->table('device')->where('id', $body['device_id'])->delete();
    });
    $this->postJson('/api/devices/register', $body)->assertStatus(403)->assertJsonPath('error', 'org_disabled');
    expect($this->fx()->table('activation_codes')->where('id', $codeId)->value('used_at'))->toBeNull();
    $wrongPhone = $this->postJson('/api/devices/register', [...$body, 'phone' => '+201099999999'])->assertUnauthorized();
    $wrongCode = $this->postJson('/api/devices/register', [...$body, 'activation_code' => ActivationCode::generate()])->assertUnauthorized();
    expect($wrongCode->json())->toBe($wrongPhone->json());
    changeSuspension($org, false);
    $this->postJson('/api/devices/register', $body)->assertOk();
});

test('suspension function rejects app callers, invalid reasons and foreign owner attribution, and is idempotent', function () {
    $org = IdentityHarness::org();
    $other = IdentityHarness::org();
    expect(fn () => $this->asApp()->select('SELECT set_organization_disabled(?::jsonb)', ['{}']))
        ->toThrow(QueryException::class, 'permission denied');
    expect(fn () => changeSuspension($org, true, ''))->toThrow(QueryException::class, 'invalid payload');
    expect(fn () => changeSuspension($org, true, str_repeat('x', 201)))->toThrow(QueryException::class, 'invalid payload');
    expect(fn () => changeSuspension([...$org, 'ownerId' => $other['ownerId']], true))->toThrow(QueryException::class, 'not allowed');
    changeSuspension($org, true);
    expect(changeSuspension($org, true)['changed'])->toBeFalse();
    expect($this->fx()->table('audit_log')->where('org_id', $org['orgId'])->count())->toBe(1);
    $audit = $this->fx()->table('audit_log')->where('org_id', $org['orgId'])->sole();
    expect($audit->actor_membership_id)->toBe($org['ownerId'])->and(json_decode($audit->after, true)['source'])->toBe('cli');
});

test('organization status command validates input, suspends and enables, and resets its lookup role', function () {
    $org = IdentityHarness::org();
    $this->artisan('clintra:organization-status', ['org_id' => $org['orgId'], 'status' => 'disabled'])->assertExitCode(2);
    $this->artisan('clintra:organization-status', ['org_id' => $org['orgId'], 'status' => 'disabled', '--reason' => 'test'])->assertSuccessful();
    expect(DB::connection('pgsql_owner')->selectOne('SELECT current_user AS name')->name)->toBe('clintra_owner');
    IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertForbidden();
    $this->artisan('clintra:organization-status', ['org_id' => $org['orgId'], 'status' => 'enabled'])->assertSuccessful();
    IdentityHarness::send($org, 'GET', '/api/sync/pull')->assertOk();
});

test('suspending an organization waits for its in-flight sync sequence transaction', function () {
    $org = IdentityHarness::org();
    $db = $this->fx();
    $db->beginTransaction();
    $process = null;
    try {
        $db->select("SELECT pg_advisory_xact_lock(hashtextextended('sync_seq:' || ?::text, 0))", [$org['orgId']]);
        $process = proc_open([
            PHP_BINARY, base_path('artisan'), 'clintra:organization-status', $org['orgId'], 'disabled', '--reason=test lock',
        ], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), array_merge(getenv(), ['DB_DATABASE' => 'clintra_test']));
        expect($process)->not->toBeFalse();
        do {
            $waiting = $db->selectOne("SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")->n > 0;
        } while (! $waiting && proc_get_status($process)['running']);
        expect($waiting)->toBeTrue();
        expect($db->table('organizations')->where('id', $org['orgId'])->value('disabled_at'))->toBeNull();
        $db->rollBack();
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        expect(proc_close($process))->toBe(0, $errors.$output);
        $process = null;
        expect($this->fx()->table('organizations')->where('id', $org['orgId'])->value('disabled_at'))->not->toBeNull();
    } finally {
        if ($db->transactionLevel() > 0) {
            $db->rollBack();
        }
        if (is_resource($process)) {
            proc_terminate($process);
            proc_close($process);
        }
    }
});

test('suspension grants stay column-exact and its CLI function has no public or app execution grant', function () {
    $columns = $this->asOwner()->select("SELECT column_name FROM information_schema.role_column_grants WHERE grantee = 'clintra_provision' AND table_name = 'organizations' AND privilege_type = 'UPDATE' ORDER BY column_name");
    expect(array_column($columns, 'column_name'))->toBe(['disabled_at', 'disabled_reason']);
    $row = $this->asOwner()->selectOne("SELECT r.rolname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'set_organization_disabled'");
    expect([$row->rolname, $row->prosecdef, $row->proconfig])->toBe(['clintra_provision', true, '{"search_path=public, pg_temp"}']);
    $callers = $this->asOwner()->select("SELECT grantee FROM information_schema.role_routine_grants WHERE routine_name = 'set_organization_disabled' ORDER BY grantee");
    expect(array_column($callers, 'grantee'))->toBe(['clintra_owner', 'clintra_provision']);
    expect($this->asOwner()->selectOne("SELECT has_table_privilege('clintra_provision', 'organizations', 'UPDATE') AS allowed")->allowed)->toBeFalse();
});
