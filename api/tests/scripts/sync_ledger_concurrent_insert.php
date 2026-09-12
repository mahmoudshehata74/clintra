<?php

/**
 * Standalone, no-Laravel-bootstrap script used only by
 * tests/Feature/Rls/SyncLedgerTest.php's concurrency test. Two
 * invocations insert two independent sync_ledger rows (different orgs,
 * different op_ids — no contention on any row either would touch)
 * concurrently, proving the identity-column seq assigns distinct,
 * monotonically increasing values under real concurrency rather than a
 * read-then-write counter that could collide (see
 * api/docs/rls.md's "Sequence-backed audit ordering" for the exact bug
 * class this pattern already found and fixed once, for audit_log.seq).
 *
 * Args: host port database username password membership_id org_id
 *       device_id op_id entity_id
 * Prints the seq value this insert was assigned, via RETURNING.
 */
[, $host, $port, $database, $username, $password, $membershipId, $orgId, $deviceId, $opId, $entityId] = $argv;

$pdo = new PDO(
    "pgsql:host={$host};port={$port};dbname={$database}",
    $username,
    $password,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);

$pdo->beginTransaction();

$statement = $pdo->prepare("SELECT set_config('app.membership_id', ?, true)");
$statement->execute([$membershipId]);

$statement = $pdo->prepare(<<<'SQL'
    INSERT INTO sync_ledger (op_id, org_id, entity, entity_id, rev, actor_membership_id, device_id, applied_at)
    VALUES (?, ?, 'patients', ?, 1, ?, ?, now())
    RETURNING seq
SQL);
$statement->execute([$opId, $orgId, $entityId, $membershipId, $deviceId]);
$row = $statement->fetch(PDO::FETCH_ASSOC);

usleep(200000);

$pdo->commit();

echo $row['seq'];
