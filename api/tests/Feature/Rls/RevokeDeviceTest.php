<?php

use Illuminate\Support\Str;

/**
 * php artisan clintra:revoke-device — see App\Console\Commands\RevokeDevice's
 * own doc comment for the design (no new role; SET ROLE clintra_rls for
 * one narrow, read-only lookup, then plain clintra_owner with a declared
 * membership for the actual writes) and docs/dry-run.md's scenario 18 for
 * the finding this closes.
 */
test('revoking a device sets revoked_at, deletes its token, and writes an audit row attributed to the org owner', function () {
    $credential = makeAuthenticatedDevice();

    $this->artisan('clintra:revoke-device', ['device_id' => $credential['deviceId']])
        ->assertSuccessful();

    $device = $this->fx()->table('device')->where('id', $credential['deviceId'])->first();
    expect($device->revoked_at)->not->toBeNull();

    $tokens = $this->fx()->table('personal_access_tokens')->where('tokenable_id', $credential['deviceId'])->count();
    expect($tokens)->toBe(0);

    $audit = $this->fx()->table('audit_log')
        ->where('entity', 'device')
        ->where('entity_id', $credential['deviceId'])
        ->where('action', 'update')
        ->first();
    expect($audit)->not->toBeNull();
    expect($audit->actor_membership_id)->toBe($credential['membershipId']);
    expect(json_decode($audit->after, true)['revoked_at'])->not->toBeNull();

    $this->fx()->table('audit_log')->where('entity_id', $credential['deviceId'])->delete();
});

test('a revoked device\'s next authenticated request is rejected exactly like an unauthenticated one', function () {
    $credential = makeAuthenticatedDevice();

    $this->artisan('clintra:revoke-device', ['device_id' => $credential['deviceId']])->assertSuccessful();

    // The device never learns its token was deleted — it still holds the
    // plaintext bearer value and presents it exactly as before.
    $response = $this->withToken($credential['token'])->getJson('/api/isolation-probe');

    $response->assertStatus(401);
    $response->assertJson(['error' => 'unauthenticated']);

    $this->fx()->table('audit_log')->where('entity_id', $credential['deviceId'])->delete();
});

test('revoking an already-revoked device is idempotent: reports the existing revocation, no second audit row', function () {
    $credential = makeAuthenticatedDevice();

    $this->artisan('clintra:revoke-device', ['device_id' => $credential['deviceId']])->assertSuccessful();
    $firstRevokedAt = $this->fx()->table('device')->where('id', $credential['deviceId'])->value('revoked_at');
    $auditCountAfterFirst = $this->fx()->table('audit_log')->where('entity_id', $credential['deviceId'])->count();

    $this->artisan('clintra:revoke-device', ['device_id' => $credential['deviceId']])->assertSuccessful();
    $secondRevokedAt = $this->fx()->table('device')->where('id', $credential['deviceId'])->value('revoked_at');
    $auditCountAfterSecond = $this->fx()->table('audit_log')->where('entity_id', $credential['deviceId'])->count();

    expect($secondRevokedAt)->toBe($firstRevokedAt);
    expect($auditCountAfterSecond)->toBe($auditCountAfterFirst);

    $this->fx()->table('audit_log')->where('entity_id', $credential['deviceId'])->delete();
});

test('a failed lookup still leaves the pgsql_owner connection as clintra_owner, never stuck as clintra_rls', function () {
    $nonExistentDeviceId = (string) Str::uuid();

    // The command's own exception ("No device found...") propagates
    // straight out of Artisan::call in tests, rather than being swallowed
    // into a non-zero exit code — caught here so the real assertion (the
    // role state afterward) is what this test is actually about.
    try {
        $this->artisan('clintra:revoke-device', ['device_id' => $nonExistentDeviceId])->run();
        $this->fail('Expected clintra:revoke-device to throw for a non-existent device.');
    } catch (RuntimeException $e) {
        expect($e->getMessage())->toContain('No device found');
    }

    $currentUser = $this->asOwner()->selectOne('select current_user as u')->u;
    expect($currentUser)->toBe('clintra_owner');
});

test('clintra_rls — the role the lookup briefly elevates to — cannot write to device, personal_access_tokens, or audit_log at all', function () {
    // Structural proof that the elevated window in RevokeDevice could not
    // perform a write even if one were accidentally placed inside it:
    // clintra_rls holds SELECT-only on device, and nothing at all on
    // personal_access_tokens/audit_log.
    $rows = $this->asOwner()->select(<<<'SQL'
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = 'clintra_rls'
        ORDER BY table_name, privilege_type
    SQL);
    $grants = collect($rows)->groupBy('table_name')->map(fn ($g) => $g->pluck('privilege_type')->sort()->values()->all());

    expect($grants->has('personal_access_tokens'))->toBeFalse();
    expect($grants->has('audit_log'))->toBeFalse();
    expect($grants['device'] ?? [])->toBe(['SELECT']);
});
