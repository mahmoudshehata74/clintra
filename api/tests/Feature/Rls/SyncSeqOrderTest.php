<?php

use App\Models\Device;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * One organization's sync writes commit in seq order (App\Support\Sync\SyncSeqLock,
 * api/docs/rls.md's "One organization's sync writes commit in seq order").
 */

/** The SyncSeqLock key of one organization, from a session with no organization of its own. */
function trySyncSeqLock(string $orgId): bool
{
    return test()->fx()->transaction(fn ($db) => (bool) $db->selectOne(
        "select pg_try_advisory_xact_lock(hashtextextended('sync_seq:' || ?::text, 0)) as locked",
        [$orgId],
    )->locked);
}

/** A second registered device of the credential's organization, with its own token. */
function secondDeviceToken(array $credential): string
{
    $deviceId = test()->makeDevice($credential['orgId'], $credential['locationId'], $credential['membershipId']);

    return (new Device(['id' => $deviceId]))->createToken('test-device', ['membership:'.$credential['membershipId']])->plainTextToken;
}

/**
 * Starts tests/scripts/sync_request.php in its own process, with this
 * test's database environment.
 *
 * @return array{0: resource, 1: array<int, resource>}
 */
function startSyncRequest(string $method, string $uri, string $token, ?string $body = null): array
{
    $command = [PHP_BINARY, base_path('tests/scripts/sync_request.php'), $method, $uri, $token];
    if ($body !== null) {
        $command[] = $body;
    }
    $env = array_merge(getenv(), [
        'APP_ENV' => 'testing',
        'DB_DATABASE' => config('database.connections.pgsql.database'),
        'CACHE_STORE' => 'array',
    ]);

    $process = proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);

    return [$process, $pipes];
}

/** Waits for the process to exit and returns its decoded JSON body, failing on any status but 200. */
function finishSyncRequest(array $started): array
{
    [$process, $pipes] = $started;
    $output = stream_get_contents($pipes[1]);
    $errors = stream_get_contents($pipes[2]);
    foreach ($pipes as $pipe) {
        fclose($pipe);
    }
    proc_close($process);

    [$status, $body] = explode("\n", $output, 2) + [1 => ''];
    expect($status)->toBe('HTTP 200', $errors.$output);

    return json_decode($body, true, flags: JSON_THROW_ON_ERROR);
}

function runSyncRequest(string $method, string $uri, string $token, ?string $body = null): array
{
    return finishSyncRequest(startSyncRequest($method, $uri, $token, $body));
}

/** Removes the committed rows one test's pushes left behind. */
function removePushedPatients(array $entityIds): void
{
    test()->fx()->table('audit_log')->whereIn('entity_id', $entityIds)->delete();
    test()->fx()->table('sync_ledger')->whereIn('entity_id', $entityIds)->delete();
    test()->fx()->table('patients')->whereIn('id', $entityIds)->delete();
}

test('an open push holds its organization\'s sync lock and no other organization\'s', function () {
    $orgX = makeAuthenticatedDevice();
    $orgY = makeAuthenticatedDevice();

    // The request's own transaction nests inside this one, so the push's
    // lock stays held after the response, as it would until the commit.
    DB::connection('pgsql')->beginTransaction();

    try {
        $response = pushOps($orgX['token'], [patientOp($orgX['orgId'])]);
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'accepted');

        expect(trySyncSeqLock($orgX['orgId']))->toBeFalse();
        expect(trySyncSeqLock($orgY['orgId']))->toBeTrue();
    } finally {
        DB::connection('pgsql')->rollBack();
    }

    // Released with the transaction.
    expect(trySyncSeqLock($orgX['orgId']))->toBeTrue();
});

test('an open staff add holds its organization\'s sync lock', function () {
    $credential = makeAuthenticatedDevice();

    DB::connection('pgsql')->beginTransaction();

    try {
        // Refused (the location is not the organization's), but only after
        // the lock is taken: it comes before the first write.
        $this->withToken($credential['token'])->postJson('/api/staff', staffPayload([
            'location_scope' => 'listed',
            'locations' => [['id' => (string) Str::uuid(), 'location_id' => (string) Str::uuid()]],
        ]))->assertNotFound();

        expect(trySyncSeqLock($credential['orgId']))->toBeFalse();
    } finally {
        DB::connection('pgsql')->rollBack();
    }
});

test('an open audit push holds the same organization lock as a sync push', function () {
    $orgX = makeAuthenticatedDevice();
    $orgY = makeAuthenticatedDevice();

    DB::connection('pgsql')->beginTransaction();

    try {
        $response = $this->withToken($orgX['token'])->postJson('/api/audit/push', ['rows' => [auditRow($orgX)]]);
        $response->assertOk();
        $response->assertJsonPath('results.0.status', 'accepted');

        expect(trySyncSeqLock($orgX['orgId']))->toBeFalse();
        expect(trySyncSeqLock($orgY['orgId']))->toBeTrue();
    } finally {
        DB::connection('pgsql')->rollBack();
    }
});

test('a pull run between two pushes never skips a seq once both have committed', function () {
    $credential = makeAuthenticatedDevice();
    $otherToken = secondDeviceToken($credential);
    $first = patientOp($credential['orgId']);
    $second = patientOp($credential['orgId']);

    try {
        // Push 1 is applied and left open: its ledger row holds the lower seq.
        DB::connection('pgsql')->beginTransaction();
        pushOps($credential['token'], [$first])->assertJsonPath('results.0.status', 'accepted');

        // Push 2, from the organization's other device, in its own process.
        $secondPush = startSyncRequest('POST', '/api/sync/push', $otherToken, json_encode(['ops' => [$second]]));

        // Wait until push 2 is either waiting on the lock or done: done
        // means it committed a higher seq while push 1 was still open,
        // which is exactly the gap.
        do {
            $waiting = DB::connection('pgsql_fixtures')->selectOne(
                "select count(*) as n from pg_locks where locktype = 'advisory' and not granted",
            )->n > 0;
        } while (! $waiting && proc_get_status($secondPush[0])['running']);

        // A pull from a third connection, between the two commits.
        $between = runSyncRequest('GET', '/api/sync/pull', $otherToken);

        DB::connection('pgsql')->commit();
        expect(finishSyncRequest($secondPush)['results'][0]['status'])->toBe('accepted');

        $after = runSyncRequest('GET', '/api/sync/pull?cursor='.$between['cursor'], $otherToken);

        $received = array_column([...$between['rows'], ...$after['rows']], 'entity_id');
        expect($received)->toContain($first['entity_id'], $second['entity_id']);
    } finally {
        if (DB::connection('pgsql')->transactionLevel() > 0) {
            DB::connection('pgsql')->rollBack();
        }
        removePushedPatients([$first['entity_id'], $second['entity_id']]);
    }
});
