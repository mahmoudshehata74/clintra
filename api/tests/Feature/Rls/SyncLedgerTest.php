<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * 2026_09_12_000013_create_sync_ledger_table.php: the server-side receipt
 * of every accepted sync_op, backing the future pull cursor
 * (docs/sync-plan.md's Q9). RLS shape matches audit_log exactly: FORCE,
 * org-scoped, append-only.
 */
test('sync_ledger rows are isolated per org', function () {
    $orgA = $this->makeOrganization();
    $userA = $this->makeUser();
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);
    $locationA = $this->makeLocation($orgA);
    $deviceA = $this->makeDevice($orgA, $locationA, $membershipA);
    $this->makeSyncLedgerRow($orgA, $membershipA, $deviceA);

    $orgB = $this->makeOrganization();
    $userB = $this->makeUser();
    $membershipB = $this->makeMembership($userB, $orgB, ['role' => 'owner']);
    $locationB = $this->makeLocation($orgB);
    $deviceB = $this->makeDevice($orgB, $locationB, $membershipB);
    $this->makeSyncLedgerRow($orgB, $membershipB, $deviceB);

    $this->withMembership($this->asApp(), $membershipA, function ($db) use ($orgA) {
        $rows = $db->table('sync_ledger')->get();
        expect($rows)->toHaveCount(1);
        expect($rows->first()->org_id)->toBe($orgA);
    });

    $this->withMembership($this->asApp(), $membershipB, function ($db) use ($orgB) {
        $rows = $db->table('sync_ledger')->get();
        expect($rows)->toHaveCount(1);
        expect($rows->first()->org_id)->toBe($orgB);
    });
});

test('a duplicate op_id is rejected by the unique constraint', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);
    $location = $this->makeLocation($org);
    $device = $this->makeDevice($org, $location, $membership);
    $opId = (string) Str::uuid();

    $this->makeSyncLedgerRow($org, $membership, $device, ['op_id' => $opId]);

    $caught = null;

    try {
        $this->fx()->table('sync_ledger')->insert([
            'op_id' => $opId,
            'org_id' => $org,
            'entity' => 'patients',
            'entity_id' => (string) Str::uuid(),
            'rev' => 1,
            'actor_membership_id' => $membership,
            'device_id' => $device,
            'applied_at' => now()->toIso8601String(),
            'client_created_at' => now()->toIso8601String(),
        ]);
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('a duplicate op_id must be rejected, not silently accepted');
    expect($caught->getCode())->toBe('23505');
});

test('sync_ledger rows cannot be updated or deleted through clintra_app', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);
    $location = $this->makeLocation($org);
    $device = $this->makeDevice($org, $location, $membership);
    $opId = $this->makeSyncLedgerRow($org, $membership, $device);

    // Since 2026_09_12_000015_revoke_inert_write_grants.php, clintra_app
    // holds no UPDATE/DELETE grant on sync_ledger at all — the statement
    // never reaches the (still-absent) RLS policy check, it fails loudly
    // on the grant itself instead of silently affecting zero rows.
    $updateCaught = null;
    $deleteCaught = null;

    $this->withMembership($this->asApp(), $membership, function ($db) use ($opId, &$updateCaught) {
        try {
            $db->table('sync_ledger')->where('op_id', $opId)->update(['rev' => 99]);
        } catch (QueryException $e) {
            $updateCaught = $e;
        }
    });

    $this->withMembership($this->asApp(), $membership, function ($db) use ($opId, &$deleteCaught) {
        try {
            $db->table('sync_ledger')->where('op_id', $opId)->delete();
        } catch (QueryException $e) {
            $deleteCaught = $e;
        }
    });

    expect($updateCaught)->not->toBeNull('UPDATE must be rejected by the grant, not silently no-op');
    expect($updateCaught->getCode())->toBe('42501');
    expect($deleteCaught)->not->toBeNull('DELETE must be rejected by the grant, not silently no-op');
    expect($deleteCaught->getCode())->toBe('42501');

    expect($this->fx()->table('sync_ledger')->where('op_id', $opId)->where('rev', 1)->exists())->toBeTrue();
});

test('seq is monotonic and collision-free under two concurrent writers', function () {
    $orgA = $this->makeOrganization();
    $userA = $this->makeUser();
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);
    $locationA = $this->makeLocation($orgA);
    $deviceA = $this->makeDevice($orgA, $locationA, $membershipA);
    $opIdA = (string) Str::uuid();
    $entityIdA = (string) Str::uuid();
    $this->track('sync_ledger', $opIdA);

    $orgB = $this->makeOrganization();
    $userB = $this->makeUser();
    $membershipB = $this->makeMembership($userB, $orgB, ['role' => 'owner']);
    $locationB = $this->makeLocation($orgB);
    $deviceB = $this->makeDevice($orgB, $locationB, $membershipB);
    $opIdB = (string) Str::uuid();
    $entityIdB = (string) Str::uuid();
    $this->track('sync_ledger', $opIdB);

    $config = config('database.connections.pgsql');
    $script = __DIR__.'/../../scripts/sync_ledger_concurrent_insert.php';

    $buildCommand = fn (string $membershipId, string $orgId, string $deviceId, string $opId, string $entityId) => [
        PHP_BINARY, $script,
        $config['host'], (string) $config['port'], $config['database'],
        $config['username'], $config['password'],
        $membershipId, $orgId, $deviceId, $opId, $entityId,
    ];

    $processA = proc_open($buildCommand($membershipA, $orgA, $deviceA, $opIdA, $entityIdA), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesA);
    $processB = proc_open($buildCommand($membershipB, $orgB, $deviceB, $opIdB, $entityIdB), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesB);

    $outputA = trim(stream_get_contents($pipesA[1]));
    $outputB = trim(stream_get_contents($pipesB[1]));
    foreach ($pipesA as $pipe) {
        fclose($pipe);
    }
    foreach ($pipesB as $pipe) {
        fclose($pipe);
    }
    proc_close($processA);
    proc_close($processB);

    expect($outputA)->not->toBe('');
    expect($outputB)->not->toBe('');
    expect((int) $outputA)->not->toBe((int) $outputB);

    $rowA = $this->fx()->table('sync_ledger')->where('op_id', $opIdA)->first();
    $rowB = $this->fx()->table('sync_ledger')->where('op_id', $opIdB)->first();
    expect($rowA)->not->toBeNull();
    expect($rowB)->not->toBeNull();
    expect($rowA->seq)->not->toBe($rowB->seq);
});
