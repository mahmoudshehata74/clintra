<?php

use App\Support\ActivationCode;
use Illuminate\Support\Str;

/**
 * 2026_09_12_000010_sequence_backed_audit_seq.php replaced every
 * provisioning function's `SELECT COALESCE(MAX(seq), 0) + 1` with a real
 * Postgres identity column — the old approach let two concurrent
 * transactions read the same MAX and compute the same next value, which
 * (since audit_log.seq carries a UNIQUE constraint) failed the *entire*
 * surrounding transaction with a unique-violation, not just the audit
 * write. This test proves the fix under genuine concurrency: two
 * completely independent, valid registrations — different orgs, different
 * activation codes, no contention on any row either would touch — racing
 * via separate OS processes (register_device_race.php, the same
 * proc_open() harness RegisterDeviceValidationTest.php's single-use race
 * test uses; pcntl isn't available on Windows). Both must succeed, and
 * both audit rows must survive with distinct seq values.
 */
test('two concurrent, independent register_device calls produce distinct, monotonically increasing seq values and both audit rows survive', function () {
    $fixtureA = makeRegistrationFixture();
    $fixtureB = makeRegistrationFixture();

    $deviceIdA = (string) Str::uuid();
    $deviceIdB = (string) Str::uuid();

    $config = config('database.connections.pgsql');
    $script = __DIR__.'/../../scripts/register_device_race.php';

    $buildCommand = function (array $fixture, string $deviceId) use ($config, $script) {
        $payload = json_encode([
            'device_id' => $deviceId,
            'phone' => $fixture['phone'],
            'code_hash' => ActivationCode::hash($fixture['plainCode']),
            'audit_device_id' => (string) Str::uuid(),
            'audit_code_used_id' => (string) Str::uuid(),
        ]);

        return [
            PHP_BINARY, $script,
            $config['host'], (string) $config['port'], $config['database'],
            $config['username'], $config['password'], $payload,
        ];
    };

    // Launched without waiting on each other — genuinely overlapping
    // transactions, not "call it twice in sequence."
    $processA = proc_open($buildCommand($fixtureA, $deviceIdA), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesA);
    $processB = proc_open($buildCommand($fixtureB, $deviceIdB), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesB);

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

    // Unlike the single-use race (same code, one must lose), these two
    // calls share nothing — both must succeed. Before the identity-column
    // fix, a MAX(seq)+1 collision between the two could make one of these
    // fail outright on an unrelated unique-violation despite a perfectly
    // valid code and phone.
    expect(trim($outputA))->toBe('OK');
    expect(trim($outputB))->toBe('OK');

    $auditRows = $this->fx()->table('audit_log')
        ->whereIn('org_id', [$fixtureA['orgId'], $fixtureB['orgId']])
        ->orderBy('seq')
        ->get();

    // Two audit rows per registration (device create, activation-code-used
    // update) — four total, none lost to a rolled-back transaction.
    expect($auditRows)->toHaveCount(4);

    $seqValues = $auditRows->pluck('seq')->all();
    expect($seqValues)->toBe(collect($seqValues)->unique()->values()->all(), 'seq values must be pairwise distinct');
    expect($seqValues)->toBe(collect($seqValues)->sort()->values()->all(), 'fetched in seq order, so this just confirms no duplicate ties');

    // Strictly monotonic: no two rows share a value, and every value is a
    // real, increasing integer — exactly what a shared unique constraint
    // fed by a read-then-write counter cannot guarantee under concurrency.
    for ($i = 1; $i < count($seqValues); $i++) {
        expect($seqValues[$i])->toBeGreaterThan($seqValues[$i - 1]);
    }

    $this->fx()->table('activation_codes')->where('id', $fixtureA['codeId'])->update(['used_by_device_id' => null]);
    $this->fx()->table('activation_codes')->where('id', $fixtureB['codeId'])->update(['used_by_device_id' => null]);
    $this->fx()->table('device')->whereIn('org_id', [$fixtureA['orgId'], $fixtureB['orgId']])->delete();
    $this->fx()->table('audit_log')->whereIn('org_id', [$fixtureA['orgId'], $fixtureB['orgId']])->delete();
});

test('migrating an already-provisioned table keeps existing seq values untouched and starts the sequence above the current max', function () {
    // Reproduces 2026_09_12_000010_sequence_backed_audit_seq.php's exact
    // migration pattern against a throwaway table seeded with "existing"
    // high seq values (as an already-provisioned production database would
    // have), rather than relying on the live audit_log table's history —
    // by now that table's sequence position reflects this whole test run,
    // not a freshly-migrated database, so it can't demonstrate the
    // migration's own correctness at the moment it runs.
    $this->asOwner()->statement('DROP TABLE IF EXISTS seq_migration_probe');
    $this->asOwner()->statement('CREATE TABLE seq_migration_probe (id serial primary key, seq bigint NOT NULL)');
    $this->asOwner()->statement('INSERT INTO seq_migration_probe (seq) VALUES (5), (12), (47)');

    // The exact DO block from the migration, verbatim except for the table name.
    $this->asOwner()->statement(<<<'SQL'
        DO $$
        DECLARE
            v_next bigint;
        BEGIN
            SELECT COALESCE(MAX(seq), 0) + 1 INTO v_next FROM seq_migration_probe;
            EXECUTE format(
                'ALTER TABLE seq_migration_probe ALTER COLUMN seq ADD GENERATED BY DEFAULT AS IDENTITY (START WITH %s)',
                v_next
            );
        END $$;
    SQL);

    // Existing rows: untouched.
    $existingSeqValues = $this->asOwner()->table('seq_migration_probe')->orderBy('id')->pluck('seq')->all();
    expect($existingSeqValues)->toBe([5, 12, 47]);

    // A fresh row that omits seq entirely — exactly what every provisioning
    // function does now — must land strictly above the old max (47), never
    // colliding with it or restarting from 1.
    $this->asOwner()->statement('INSERT INTO seq_migration_probe DEFAULT VALUES');
    $freshSeq = $this->asOwner()->table('seq_migration_probe')->orderBy('id', 'desc')->value('seq');
    expect($freshSeq)->toBeGreaterThan(47);

    $this->asOwner()->statement('DROP TABLE seq_migration_probe');
});
