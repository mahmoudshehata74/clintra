<?php

test('support code hash matches the web fixed normalization vector', function () {
    expect(\App\Support\ActivationCode::hash('CLT-7F3K-9QRT-4XWM-2BCD'))
        ->toBe('c93b3fcfa7ef0927301056a6f3e4d61b783f3324fd8070a69c6b397305b72610');
});

use App\Models\Device;
use App\Support\ActivationCode;
use App\Support\Sync\SupportAccess;
use App\Support\Sync\SyncPayload;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Support\IdentityHarness;
use Tests\Support\PlatformAdminHarness;
use Tests\Support\TestKey;

uses(PlatformAdminHarness::class);
afterEach(fn () => $this->endPlatformFixtures());

function b6Fixture(): array
{
    $test = test();
    $org = $test->makeOrganization('B6 support clinic');
    $location = $test->makeLocation($org);
    $owner = $test->makeMembership($test->makeUser(), $org, ['role' => 'owner']);
    $clinic = $test->makeDevice($org, $location, $owner);
    $token = (new Device(['id' => $clinic]))->createToken('clinic', ['membership:'.$owner])->plainTextToken;
    $test->cleanupFirst(function () use ($test, $org) {
        $allDeviceIds = $test->fx()->table('device')->where('org_id', $org)->pluck('id')->all();
        $test->asOwner()->table('platform.support_exchanges')->whereIn('device_id', $allDeviceIds)->delete();
        $supportIds = $test->fx()->table('device')->where('org_id', $org)->where('kind', 'support')->pluck('id')->all();
        if ($supportIds !== []) {
            $test->asApp()->table('personal_access_tokens')->where('tokenable_type', Device::class)
                ->whereIn('tokenable_id', $supportIds)->delete();
            $test->fx()->table('activation_codes')->where('org_id', $org)->update(['used_by_device_id' => null]);
            $test->fx()->table('device')->whereIn('id', $supportIds)->delete();
        }
        $test->fx()->table('audit_log')->where('org_id', $org)
            ->whereIn('entity', ['device', 'activation_codes'])->delete();
        $test->fx()->table('activation_codes')->where('org_id', $org)->where('purpose', 'support')->delete();
    });

    return compact('org', 'location', 'owner', 'clinic', 'token');
}

function b6Open(string $session, string $otp, array $payload, string $log): array
{
    return json_decode(test()->panel()->selectOne(
        'SELECT platform.admin_open_support_session(?::uuid,?::text,?::jsonb,?::uuid) AS result',
        [$session, $otp, json_encode($payload, JSON_THROW_ON_ERROR), $log]
    )->result, true, flags: JSON_THROW_ON_ERROR);
}

function b6SupportToken(array $fx, bool $includeClinical): array
{
    $test = test();
    $plain = 'CLT-'.Str::random(20);
    $code = $test->makeActivationCode($fx['org'], $fx['location'], $plain,
        ['purpose' => 'support', 'support_hours' => 1,
            'include_clinical' => $includeClinical, 'created_by_membership_id' => $fx['owner']]);
    $id = $test->platformId();
    $test->fx()->table('device')->insert(['id' => $id, 'org_id' => $fx['org'],
        'location_id' => $fx['location'], 'membership_id' => $fx['owner'],
        'registered_at' => now()->toIso8601String(), 'series' => null,
        'kind' => 'support', 'expires_at' => now()->addHour()->toIso8601String(),
        'include_clinical' => $includeClinical, 'support_admin_name' => 'Test admin',
        'support_code_id' => $code]);
    $token = (new Device(['id' => $id]))->createToken('support',
        ['membership:'.$fx['owner'], 'support:read-only'], now()->addHour())->plainTextToken;

    return compact('id', 'token');
}

test('owner code opens and exchanges a support device once, then ending revokes its token', function () {
    $fx = b6Fixture();
    $plain = 'CLT-SUPPORT-'.Str::random(16);
    $codeId = $this->platformId();
    $code = ['id' => $codeId, 'code_hash' => hash('sha256', $plain),
        'location_id' => $fx['location'], 'support_hours' => 1,
        'include_clinical' => false, 'audit_id' => $this->platformId()];
    $this->withToken($fx['token'])->postJson('/api/support/codes', $code)->assertCreated()
        ->assertJsonPath('id', $codeId);

    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.62', 'user_agent' => 'B6 support test']);
    $exchangePlain = 'exchange-'.Str::random(32);
    $payload = ['code_hash' => $code['code_hash'], 'device_id' => $this->platformId(),
        'exchange_hash' => hash('sha256', $exchangePlain)];
    $logId = $this->platformId();
    $opened = b6Open($session, $this->platformOtp($admin['secret']), $payload, $logId);
    expect($opened)->toMatchArray(['ok' => true, 'device_id' => $payload['device_id']]);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $logId)->sole();
    expect($log->ip)->toBe('192.0.2.62')->and($log->user_agent)->toBe('B6 support test')
        ->and($log->target_id)->toBe($payload['device_id']);

    $key = TestKey::make();
    $exchanged = $this->postJson('/api/support/exchange', [
        'exchange_code' => $exchangePlain, 'device_public_key' => $key->jwk,
    ])->assertOk();
    expect($exchanged->json('support.include_clinical'))->toBeFalse()
        ->and($exchanged->json('support.admin_name'))->toBe('Test admin');
    $supportToken = $exchanged->json('token');
    $this->postJson('/api/support/exchange', [
        'exchange_code' => $exchangePlain, 'device_public_key' => $key->jwk,
    ])->assertStatus(401)->assertJsonPath('error', 'registration_failed');
    $this->withToken($supportToken)->postJson('/api/support/exchange', [
        'exchange_code' => 'another-code', 'device_public_key' => $key->jwk,
    ])->assertStatus(403)->assertJsonPath('error', 'support_read_only');
    $this->withToken($supportToken)->getJson('/api/sync/pull')->assertOk()
        ->assertJsonPath('support_sessions.0.device_id', $payload['device_id']);
    $this->withToken($supportToken)->postJson('/api/sync/push', ['ops' => []])->assertStatus(403)
        ->assertJsonPath('error', 'support_read_only');
    $this->withToken($fx['token'])->postJson('/api/support/devices/'.$payload['device_id'].'/end')->assertOk();
    $this->withToken($supportToken)->getJson('/api/sync/pull')->assertStatus(401);
    expect($this->asApp()->table('personal_access_tokens')->where('tokenable_id', $payload['device_id'])->count())->toBe(0);
});

test('each platform support refusal returns and writes one attributed row', function (string $case, string $reason) {
    $fx = b6Fixture();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.63', 'user_agent' => 'B6 refusal']);
    $plain = 'CLT-'.Str::random(20);
    $purpose = $case === 'device_code' ? 'device' : 'support';
    $codeId = $this->makeActivationCode($fx['org'], $fx['location'], $plain,
        $purpose === 'support' ? ['purpose' => 'support', 'support_hours' => 1,
            'include_clinical' => false, 'created_by_membership_id' => $fx['owner']] : []);
    $exchangeHash = hash('sha256', 'exchange-'.Str::random(20));
    $payload = ['code_hash' => hash('sha256', $plain), 'device_id' => $this->platformId(),
        'exchange_hash' => $exchangeHash];
    if ($case === 'unknown') {
        $payload['code_hash'] = hash('sha256', 'unknown-'.Str::random(20));
    }
    if ($case === 'used') {
        $this->fx()->table('activation_codes')->where('id', $codeId)->update(['used_at' => now()->toIso8601String()]);
    }
    if ($case === 'expired') {
        $this->fx()->table('activation_codes')->where('id', $codeId)->update(['expires_at' => now()->subMinute()->toIso8601String()]);
    }
    if ($case === 'org_disabled') {
        $this->fx()->table('organizations')->where('id', $fx['org'])
            ->update(['disabled_at' => now()->toIso8601String(), 'disabled_reason' => 'B6 test']);
    }
    if ($case === 'no_owner') {
        $this->fx()->table('memberships')->where('id', $fx['owner'])->update(['is_active' => false]);
    }
    if ($case === 'support_active') {
        $this->fx()->table('device')->insert(['id' => $this->platformId(), 'org_id' => $fx['org'],
            'location_id' => $fx['location'], 'membership_id' => $fx['owner'], 'registered_at' => now()->toIso8601String(),
            'series' => null, 'kind' => 'support', 'expires_at' => now()->addHour()->toIso8601String(),
            'include_clinical' => false, 'support_admin_name' => 'Test admin', 'support_code_id' => $codeId]);
    }
    if ($case === 'existing_device') {
        $payload['device_id'] = $fx['clinic'];
    }
    if ($case === 'existing_exchange') {
        $this->asOwner()->table('platform.support_exchanges')->insert([
            'exchange_hash' => $exchangeHash, 'device_id' => $fx['clinic'],
            'expires_at' => now()->addMinute()->toIso8601String(),
        ]);
    }
    if ($case === 'invalid_payload') {
        unset($payload['exchange_hash']);
    }
    $otp = $case === 'step_up' ? '00000000' : $this->platformOtp($admin['secret']);
    $before = $this->asOwner()->table('platform.admin_log')->max('seq') ?? 0;
    $result = b6Open($session, $otp, $payload, $this->platformId());
    expect($result)->toMatchArray(['ok' => false, 'reason' => $reason]);
    $logs = $this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->get();
    expect($logs)->toHaveCount(1);
    $log = $logs[0];
    expect($log->action)->toBe('support.open')->and($log->ip)->toBe('192.0.2.63')
        ->and($log->user_agent)->toBe('B6 refusal')->and($log->succeeded)->toBeFalse()
        ->and(json_encode($log))->not->toContain($payload['code_hash']);
    if (isset($payload['exchange_hash'])) {
        expect(json_encode($log))->not->toContain($payload['exchange_hash']);
    }
    if (in_array($case, ['unknown', 'device_code'], true)) {
        expect($log->org_id)->toBeNull()->and($log->target_id)->toBeNull();
    }
})->with([
    ['unknown', 'not_found'], ['device_code', 'not_found'], ['used', 'unchanged'],
    ['expired', 'expired'], ['org_disabled', 'org_disabled'], ['no_owner', 'no_owner'],
    ['support_active', 'support_active'], ['existing_device', 'unchanged'],
    ['existing_exchange', 'unchanged'], ['invalid_payload', 'invalid_payload'],
    ['step_up', 'step_up_failed'],
]);

test('support tokens enforce device kind, expiry, read only routes and transaction writes', function () {
    $fx = b6Fixture();
    $support = b6SupportToken($fx, false);
    $plainOnSupport = (new Device(['id' => $support['id']]))->createToken('plain',
        ['membership:'.$fx['owner']])->plainTextToken;
    $supportOnClinic = (new Device(['id' => $fx['clinic']]))->createToken('support',
        ['membership:'.$fx['owner'], 'support:read-only'])->plainTextToken;
    $this->withToken($plainOnSupport)->getJson('/api/sync/pull')->assertStatus(401);
    $this->withToken($supportOnClinic)->getJson('/api/sync/pull')->assertStatus(401);

    foreach (['/api/sync/push', '/api/audit/push', '/api/staff', '/api/staff/'.$fx['owner'],
        '/api/auth/login', '/api/support/codes', '/api/support/devices/'.$support['id'].'/end'] as $path) {
        $this->withToken($support['token'])->postJson($path, [])->assertStatus(403)
            ->assertExactJson(['error' => 'support_read_only',
                'message' => 'جهاز الدعم للقراءة بس، مفيش تغيير بيتحفظ منه']);
    }
    Route::middleware('membership')->get('/api/support-write-probe', function () use ($fx) {
        DB::table('organizations')->where('id', $fx['org'])
            ->update(['name' => 'blocked']);

        return response()->json(['ok' => true]);
    });
    $this->withoutExceptionHandling();
    try {
        $this->withToken($support['token'])->getJson('/api/support-write-probe');
        $this->fail('A support request transaction must refuse a write');
    } catch (QueryException $error) {
        expect($error->getCode())->toBe('25006');
    }
    $this->withExceptionHandling();

    $this->fx()->table('device')->where('id', $support['id'])
        ->update(['expires_at' => now()->subMinute()->toIso8601String()]);
    $this->withToken($support['token'])->getJson('/api/sync/pull')->assertStatus(401);
});

test('a support token is refused on disabled clinic write routes before recovery or suspension handling', function () {
    $fx = b6Fixture();
    $support = b6SupportToken($fx, false);
    $this->fx()->table('organizations')->where('id', $fx['org'])->update([
        'disabled_at' => now()->toIso8601String(), 'disabled_reason' => 'B6 review',
    ]);

    foreach (['/api/auth/owner-recovery', '/api/sync/push'] as $path) {
        $this->withToken($support['token'])->postJson($path, [])->assertStatus(403)
            ->assertExactJson(['error' => 'support_read_only',
                'message' => 'جهاز الدعم للقراءة بس، مفيش تغيير بيتحفظ منه']);
    }
});

test('an invalid known support session logs its stored network context', function (array $sessionChange) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, array_merge([
        'ip' => '192.0.2.81', 'user_agent' => 'B6 invalid session',
    ], $sessionChange));
    $logId = $this->platformId();
    $payload = ['code_hash' => hash('sha256', 'unknown-code'), 'device_id' => $this->platformId(),
        'exchange_hash' => hash('sha256', 'unknown-exchange')];

    expect(b6Open($session, $this->platformOtp($admin['secret']), $payload, $logId))
        ->toMatchArray(['ok' => false, 'reason' => 'session_invalid']);
    $log = $this->asOwner()->table('platform.admin_log')->where('id', $logId)->sole();
    expect($log->action)->toBe('support.open')->and($log->reason)->toBe('session_invalid')
        ->and($log->ip)->toBe('192.0.2.81')->and($log->user_agent)->toBe('B6 invalid session');
})->with([
    'expired' => [['expires_at' => now()->subMinute()->toIso8601String()]],
    'ended' => [['ended_at' => now()->toIso8601String()]],
]);

test('failed support step ups consume the shared five in fifteen minute budget', function () {
    $fx = b6Fixture();
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $code = $this->makeActivationCode($fx['org'], $fx['location'], 'CLT-'.Str::random(20),
        ['purpose' => 'support', 'support_hours' => 1, 'include_clinical' => false,
            'created_by_membership_id' => $fx['owner']]);
    $hash = $this->fx()->table('activation_codes')->where('id', $code)->value('code_hash');
    $payload = ['code_hash' => $hash, 'device_id' => $this->platformId(),
        'exchange_hash' => hash('sha256', 'exchange-'.Str::random(20))];
    for ($i = 0; $i < 5; $i++) {
        expect(b6Open($session, '00000000', $payload, $this->platformId())['reason'])->toBe('step_up_failed');
    }
    $failures = $this->asOwner()->table('platform.admin_log')->where('admin_user_id', $admin['id'])
        ->where('reason', 'step_up_failed')->where('action', 'support.open')->count();
    expect($failures)->toBe(5);
    expect(b6Open($session, $this->platformOtp($admin['secret']), $payload, $this->platformId())['reason'])
        ->toBe('session_invalid');
});

test('support pulls redact clinical rows and visit notes while cursors advance', function (bool $includeClinical) {
    $fx = b6Fixture();
    $support = b6SupportToken($fx, $includeClinical);
    $template = $this->makeSpecialtyTemplate($fx['org']);
    $form = $this->makeFormDefinition($template);
    $practitioner = $this->makePractitioner($fx['org'], $template);
    $patient = $this->makePatient($fx['org']);
    $visit = $this->makeVisit($fx['org'], $fx['location'], $practitioner, $patient,
        $fx['owner'], ['note' => 'Clinical note']);
    $formData = $this->platformId();
    $prescription = $this->platformId();
    $item = $this->platformId();
    $this->fx()->table('visit_form_data')->insert([
        'id' => $formData, 'visit_id' => $visit, 'form_definition_id' => $form,
        'data' => json_encode(['secret' => 'clinical']),
    ]);
    $this->fx()->table('prescriptions')->insert([
        'id' => $prescription, 'org_id' => $fx['org'], 'location_id' => $fx['location'],
        'visit_id' => $visit, 'patient_id' => $patient, 'practitioner_id' => $practitioner,
        'series' => 1, 'issued_year' => (int) now()->format('Y'), 'number' => 1,
        'diagnosis' => 'clinical', 'created_by' => $fx['owner'], 'created_at' => now()->toIso8601String(),
    ]);
    $this->fx()->table('prescription_items')->insert([
        'id' => $item, 'prescription_id' => $prescription, 'name' => 'Medicine',
        'instructions' => 'clinical', 'position' => 1,
    ]);
    $this->cleanupFirst(function () use ($visit, $prescription) {
        $this->fx()->table('prescription_items')->where('prescription_id', $prescription)->delete();
        $this->fx()->table('prescriptions')->where('id', $prescription)->delete();
        $this->fx()->table('visit_form_data')->where('visit_id', $visit)->delete();
    });
    foreach (['visits' => $visit, 'visit_form_data' => $formData,
        'prescriptions' => $prescription, 'prescription_items' => $item] as $entity => $id) {
        $this->makeSyncLedgerRow($fx['org'], $fx['owner'], $fx['clinic'],
            ['entity' => $entity, 'entity_id' => $id]);
    }
    $this->makeDeviceAuditLog($fx['org'], $fx['owner'], $fx['clinic'],
        ['entity' => 'prescriptions', 'entity_id' => $prescription]);
    $this->makeDeviceAuditLog($fx['org'], $fx['owner'], $fx['clinic'],
        ['entity' => 'visits', 'entity_id' => $visit,
            'after' => json_encode(['id' => $visit, 'note' => 'Clinical note'])]);

    $pull = $this->withToken($support['token'])->getJson('/api/sync/pull')->assertOk();
    $entities = array_column($pull->json('rows'), 'entity');
    expect(in_array('visits', $entities, true))->toBeTrue()
        ->and(in_array('prescriptions', $entities, true))->toBe($includeClinical)
        ->and(in_array('prescription_items', $entities, true))->toBe($includeClinical)
        ->and(in_array('visit_form_data', $entities, true))->toBe($includeClinical);
    $visitRow = collect($pull->json('rows'))->firstWhere('entity', 'visits');
    expect($visitRow['payload']['note'])->toBe($includeClinical ? 'Clinical note' : null);
    $lastSeq = (int) $this->fx()->table('sync_ledger')->where('org_id', $fx['org'])->max('seq');
    expect((int) $pull->json('cursor'))->toBe($lastSeq);

    $audit = $this->withToken($support['token'])->getJson('/api/audit/pull?cursor=0')->assertOk();
    expect($audit->json('rows'))->toHaveCount($includeClinical ? 2 : 1);
    $auditVisit = collect($audit->json('rows'))->firstWhere('entity', 'visits');
    expect($auditVisit['after']['note'])->toBe($includeClinical ? 'Clinical note' : null);
    expect((int) $audit->json('cursor'))->toBeGreaterThan(0);

    $rows = [];
    $cursor = null;
    do {
        $url = '/api/sync/bootstrap'.($cursor === null ? '' : '?cursor='.urlencode($cursor));
        $page = $this->withToken($support['token'])->getJson($url)->assertOk();
        array_push($rows, ...$page->json('rows'));
        $cursor = $page->json('cursor');
    } while ($page->json('has_more'));
    $bootstrapEntities = array_column($rows, 'entity');
    expect(in_array('prescriptions', $bootstrapEntities, true))->toBe($includeClinical)
        ->and(in_array('prescription_items', $bootstrapEntities, true))->toBe($includeClinical);
    $bootstrapVisit = collect($rows)->firstWhere('entity', 'visits');
    expect($bootstrapVisit['payload']['note'])->toBe($includeClinical ? 'Clinical note' : null);
})->with([false, true]);

test('every listed clinical column is redacted from rows and audit snapshots', function () {
    $safe = ['id' => $this->platformId(), 'full_name' => 'Safe name', 'name' => 'Safe name',
        'phone' => '+201000000000', 'total_price' => 30000, 'status' => 'active'];

    foreach (SupportAccess::CLINICAL_COLUMNS as $entity => $columns) {
        $known = array_flip(Schema::getColumnListing($entity));
        $payload = array_intersect_key($safe, $known);
        foreach ($columns as $column) {
            $payload[$column] = in_array($column, ['data', 'previous_data', 'new_data'], true)
                ? ['complaint' => 'clinical text'] : 'clinical text';
        }

        $redacted = SyncPayload::fromRow($entity, $payload, withoutClinical: true);
        $full = SyncPayload::fromRow($entity, $payload);
        $audit = SupportAccess::redactAuditRow(['entity' => $entity, 'before' => $payload,
            'after' => [...$payload, 'unknown_clinical' => 'clinical text']]);
        foreach ($columns as $column) {
            expect($redacted[$column])->toBeNull()
                ->and($full[$column])->not->toBeNull()
                ->and($audit['before'][$column])->toBeNull()
                ->and($audit['after'][$column])->toBeNull();
        }
        foreach (array_intersect_key($safe, $known) as $column => $value) {
            expect($redacted[$column])->toBe($value)
                ->and($audit['before'][$column])->toBe($value)
                ->and($audit['after'][$column])->toBe($value);
        }
        expect($audit['after'])->not->toHaveKey('unknown_clinical');
    }
});

test('every listed credential column is null for support regardless of clinical access', function () {
    foreach (SupportAccess::CREDENTIAL_COLUMNS as $entity => $columns) {
        $known = array_flip(Schema::getColumnListing($entity));
        $payload = ['id' => $this->platformId()];
        foreach ($columns as $column) {
            expect($known)->toHaveKey($column);
            $payload[$column] = 'stored-credential-'.$column;
        }

        foreach ([false, true] as $withoutClinical) {
            $support = SyncPayload::fromRow($entity, $payload, withoutClinical: $withoutClinical,
                forSupport: true);
            $audit = SupportAccess::redactAuditRow(['entity' => $entity,
                'before' => $payload, 'after' => $payload], $withoutClinical);
            foreach ($columns as $column) {
                expect($support[$column])->toBeNull()
                    ->and($audit['before'][$column])->toBeNull()
                    ->and($audit['after'][$column])->toBeNull();
            }
        }

        $clinic = SyncPayload::fromRow($entity, $payload);
        foreach ($columns as $column) {
            expect($clinic[$column])->toBe($payload[$column]);
        }
    }
});

test('support pull, exchange bootstrap and audit never return PIN material', function (bool $includeClinical) {
    $fx = b6Fixture();
    $support = b6SupportToken($fx, $includeClinical);
    $otherClinic = $this->makeDevice($fx['org'], $fx['location'], $fx['owner']);
    $this->makeSyncLedgerRow($fx['org'], $fx['owner'], $fx['clinic'],
        ['entity' => 'memberships', 'entity_id' => $fx['owner']]);
    $snapshot = ['id' => $fx['owner'], 'pin_hash' => 'test-hash', 'pin_salt' => 'test-salt',
        'display_name' => 'Clinic owner', 'recovery_token' => 'unknown-secret'];
    $this->makeDeviceAuditLog($fx['org'], $fx['owner'], $otherClinic, [
        'entity' => 'memberships', 'entity_id' => $fx['owner'], 'action' => 'update',
        'before' => json_encode($snapshot), 'after' => json_encode($snapshot),
    ]);

    foreach (['support' => $support['token'], 'clinic' => $fx['token']] as $kind => $token) {
        $pull = $this->withToken($token)->getJson('/api/sync/pull')->assertOk();
        $member = collect($pull->json('rows'))->firstWhere('entity', 'memberships');
        expect($member)->not->toBeNull();
        $audit = $this->withToken($token)->getJson('/api/audit/pull?cursor=0')->assertOk();
        $auditRow = collect($audit->json('rows'))->firstWhere('entity', 'memberships');
        expect($auditRow)->not->toBeNull();
        foreach (SupportAccess::CREDENTIAL_COLUMNS['memberships'] as $column) {
            $expected = $kind === 'support' ? null : $snapshot[$column];
            expect($member['payload'][$column])->toBe($expected)
                ->and($auditRow['before'][$column])->toBe($expected)
                ->and($auditRow['after'][$column])->toBe($expected);
        }
        expect($auditRow['before']['display_name'])->toBe('Clinic owner')
            ->and(array_key_exists('recovery_token', $auditRow['before']))
            ->toBe($kind === 'clinic');
    }

    $exchangeCode = 'exchange-'.Str::random(32);
    $this->asOwner()->table('platform.support_exchanges')->insert([
        'exchange_hash' => hash('sha256', $exchangeCode), 'device_id' => $support['id'],
        'expires_at' => now()->addMinute()->toIso8601String(),
    ]);
    $bootstrap = $this->postJson('/api/support/exchange', [
        'exchange_code' => $exchangeCode, 'device_public_key' => TestKey::make()->jwk,
    ])->assertOk();
    $owner = collect($bootstrap->json('memberships'))->firstWhere('id', $fx['owner']);
    expect($owner)->not->toBeNull();
    foreach (SupportAccess::CREDENTIAL_COLUMNS['memberships'] as $column) {
        expect($owner[$column])->toBeNull();
    }
})->with([false, true]);

test('support care plan text is null in pull, bootstrap and both audit snapshots', function (bool $includeClinical) {
    $fx = b6Fixture();
    $support = b6SupportToken($fx, $includeClinical);
    $template = $this->makeSpecialtyTemplate($fx['org']);
    $practitioner = $this->makePractitioner($fx['org'], $template);
    $patient = $this->makePatient($fx['org']);
    $planId = $this->platformId();
    $this->fx()->table('care_plans')->insert([
        'id' => $planId, 'org_id' => $fx['org'], 'location_id' => $fx['location'],
        'template_id' => $template, 'patient_id' => $patient, 'practitioner_id' => $practitioner,
        'diagnosis' => 'Clinical diagnosis', 'goal' => 'Clinical goal', 'planned_count' => 1,
        'total_price' => 30000, 'paid' => 0, 'status' => 'active',
        'started_at' => now()->toIso8601String(), 'expected_end' => now()->addMonth()->toIso8601String(),
    ]);
    $this->cleanupFirst(fn () => $this->fx()->table('care_plans')->where('id', $planId)->delete());
    $this->makeSyncLedgerRow($fx['org'], $fx['owner'], $fx['clinic'],
        ['entity' => 'care_plans', 'entity_id' => $planId]);
    $snapshot = ['id' => $planId, 'status' => 'active', 'total_price' => 30000,
        'diagnosis' => 'Clinical diagnosis', 'goal' => 'Clinical goal'];
    $this->makeDeviceAuditLog($fx['org'], $fx['owner'], $fx['clinic'], [
        'entity' => 'care_plans', 'entity_id' => $planId, 'action' => 'update',
        'before' => json_encode($snapshot), 'after' => json_encode([...$snapshot,
            'unknown_clinical' => 'Clinical text']),
    ]);

    $pull = $this->withToken($support['token'])->getJson('/api/sync/pull')->assertOk();
    $row = collect($pull->json('rows'))->firstWhere('entity', 'care_plans');
    expect($row)->not->toBeNull();
    foreach (['diagnosis' => 'Clinical diagnosis', 'goal' => 'Clinical goal'] as $column => $value) {
        expect($row['payload'][$column])->toBe($includeClinical ? $value : null);
    }
    expect($row['payload']['status'])->toBe('active')->and($row['payload']['total_price'])->toBe(30000);

    $audit = $this->withToken($support['token'])->getJson('/api/audit/pull?cursor=0')->assertOk();
    $auditRow = collect($audit->json('rows'))->firstWhere('entity', 'care_plans');
    expect($auditRow)->not->toBeNull();
    foreach (['before', 'after'] as $snapshotField) {
        foreach (['diagnosis' => 'Clinical diagnosis', 'goal' => 'Clinical goal'] as $column => $value) {
            expect($auditRow[$snapshotField][$column])->toBe($includeClinical ? $value : null);
        }
        expect($auditRow[$snapshotField]['status'])->toBe('active')
            ->and($auditRow[$snapshotField]['total_price'])->toBe(30000);
    }
    expect($auditRow['after'])->not->toHaveKey('unknown_clinical');

    $rows = [];
    $cursor = null;
    do {
        $url = '/api/sync/bootstrap'.($cursor === null ? '' : '?cursor='.urlencode($cursor));
        $page = $this->withToken($support['token'])->getJson($url)->assertOk();
        array_push($rows, ...$page->json('rows'));
        $cursor = $page->json('cursor');
    } while ($page->json('has_more'));
    $bootstrap = collect($rows)->firstWhere('entity', 'care_plans');
    expect($bootstrap)->not->toBeNull();
    foreach (['diagnosis' => 'Clinical diagnosis', 'goal' => 'Clinical goal'] as $column => $value) {
        expect($bootstrap['payload'][$column])->toBe($includeClinical ? $value : null);
    }
    expect($bootstrap['payload']['status'])->toBe('active')
        ->and($bootstrap['payload']['total_price'])->toBe(30000);
})->with([false, true]);

test('000062 refuses rollback while a support device exists and leaves its schema intact', function () {
    $fx = b6Fixture();
    $support = b6SupportToken($fx, false);
    $migration = require database_path('migrations/2026_09_12_000062_add_support_access.php');
    $previous = DB::getDefaultConnection();
    DB::setDefaultConnection('pgsql_owner');
    try {
        $this->asOwner()->transaction(fn () => $migration->down());
        $this->fail('Expected the support device to prevent rollback');
    } catch (QueryException $error) {
        expect($error->getCode())->toBe('55000')
            ->and($error->getMessage())->toContain('rollback of 000062 requires that no support device rows exist');
    } finally {
        DB::setDefaultConnection($previous);
    }
    expect(Schema::hasColumn('device', 'kind'))->toBeTrue()
        ->and($this->fx()->table('device')->where('id', $support['id'])->exists())->toBeTrue()
        ->and($this->asOwner()->selectOne("SELECT to_regprocedure('support_exchange(jsonb)') AS fn")->fn)
        ->not->toBeNull();
});

test('only an owner can mint for their location and another clinic cannot end or see support', function () {
    $a = b6Fixture();
    $b = b6Fixture();
    $assistant = $this->makeMembership($this->makeUser(), $a['org'], ['role' => 'assistant']);
    $assistantDevice = $this->makeDevice($a['org'], $a['location'], $assistant);
    $assistantToken = (new Device(['id' => $assistantDevice]))->createToken('assistant',
        ['membership:'.$assistant])->plainTextToken;
    $payload = ['id' => $this->platformId(), 'code_hash' => hash('sha256', 'owner-test-'.Str::random(20)),
        'location_id' => $a['location'], 'support_hours' => 24,
        'include_clinical' => false, 'audit_id' => $this->platformId()];
    $this->withToken($assistantToken)->postJson('/api/support/codes', $payload)->assertStatus(403);
    $this->withToken($b['token'])->postJson('/api/support/codes', $payload)->assertStatus(403);
    $this->withToken($a['token'])->postJson('/api/support/codes', $payload)->assertCreated();

    $support = b6SupportToken($a, false);
    $this->withToken($b['token'])->getJson('/api/sync/pull')->assertOk()
        ->assertJsonPath('support_sessions', []);
    $this->withToken($b['token'])->postJson('/api/support/devices/'.$support['id'].'/end')->assertStatus(404);
    $this->withToken($a['token'])->getJson('/api/sync/pull')->assertOk()
        ->assertJsonPath('support_sessions.0.device_id', $support['id']);
});

test('a support code cannot register a clinic device and an expired exchange is generic', function () {
    $fx = b6Fixture();
    $plain = ActivationCode::generate();
    $this->makeActivationCode($fx['org'], $fx['location'], $plain,
        ['purpose' => 'support', 'support_hours' => 1, 'include_clinical' => false,
            'created_by_membership_id' => $fx['owner']]);
    $this->postJson('/api/devices/register', [
        'device_id' => $this->platformId(), 'phone' => '+201000000000',
        'activation_code' => $plain,
    ])->assertStatus(401)->assertJsonPath('error', 'registration_failed');

    $support = b6SupportToken($fx, false);
    $exchangePlain = 'exchange-'.Str::random(20);
    $this->asOwner()->table('platform.support_exchanges')->insert([
        'exchange_hash' => hash('sha256', $exchangePlain), 'device_id' => $support['id'],
        'expires_at' => now()->subMinute()->toIso8601String(),
    ]);
    $this->postJson('/api/support/exchange', [
        'exchange_code' => $exchangePlain, 'device_public_key' => TestKey::make()->jwk,
    ])->assertStatus(401)->assertExactJson([
        'error' => 'registration_failed', 'message' => 'فشل التفعيل — تأكد من رقم الهاتف وكود التفعيل',
    ]);
});

test('an identity-enforced support device requires its bound key proof', function () {
    $fx = b6Fixture();
    $support = b6SupportToken($fx, false);
    $key = TestKey::make();
    $this->fx()->table('device')->where('id', $support['id'])->update([
        'public_key' => json_encode($key->jwk), 'public_key_bound_at' => now()->toIso8601String(),
    ]);
    $this->fx()->table('organizations')->where('id', $fx['org'])
        ->update(['identity_enforced_at' => now()->toIso8601String()]);
    $this->withToken($support['token'])->getJson('/api/sync/pull')->assertStatus(401);
    $this->withToken($support['token'])->withHeader('X-Clintra-Device-Proof',
        IdentityHarness::deviceProof($key, 'GET', '/api/sync/pull', '[]'))
        ->getJson('/api/sync/pull')->assertOk();
});

test('support_sessions includes only live support devices in the calling clinic', function () {
    $fx = b6Fixture();
    $live = b6SupportToken($fx, false);
    $expired = b6SupportToken($fx, false);
    $revoked = b6SupportToken($fx, false);
    $this->fx()->table('device')->where('id', $expired['id'])
        ->update(['expires_at' => now()->subMinute()->toIso8601String()]);
    $this->fx()->table('device')->where('id', $revoked['id'])
        ->update(['revoked_at' => now()->toIso8601String()]);

    foreach (['/api/sync/pull', '/api/sync/bootstrap'] as $path) {
        $response = $this->withToken($fx['token'])->getJson($path)->assertOk();
        expect(array_column($response->json('support_sessions'), 'device_id'))->toBe([$live['id']]);
    }
});
