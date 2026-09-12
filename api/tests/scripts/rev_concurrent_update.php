<?php

/**
 * Standalone, no-Laravel-bootstrap script used only by
 * tests/Feature/Rls/RowVersioningTest.php's concurrency test. Two
 * invocations race an UPDATE against the same membership row — Postgres's
 * own row-level locking (not application logic) is what's actually under
 * test: the second transaction to reach the lock must block, then
 * re-evaluate OLD.rev against the first transaction's already-committed
 * value, never against a stale snapshot.
 *
 * Args: host port database username password membership_id
 * Prints the rev value this process observed via RETURNING, after
 * holding the row lock briefly to widen the race window.
 */
[, $host, $port, $database, $username, $password, $membershipId] = $argv;

$pdo = new PDO(
    "pgsql:host={$host};port={$port};dbname={$database}",
    $username,
    $password,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);

$pdo->beginTransaction();

// set_config(..., true): scoped to this transaction only, same mechanism
// App\Support\DatabaseSession uses for a real request — this membership
// updating its own row needs current_org() to resolve to its own org_id.
$statement = $pdo->prepare("SELECT set_config('app.membership_id', ?, true)");
$statement->execute([$membershipId]);

// A no-op self-assignment still fires the BEFORE UPDATE trigger — Postgres
// does not skip a trigger just because the new value equals the old one
// (no WHEN clause was added to enforce_row_rev()'s trigger definition).
$statement = $pdo->prepare('UPDATE memberships SET role = role WHERE id = ? RETURNING rev');
$statement->execute([$membershipId]);
$row = $statement->fetch(PDO::FETCH_ASSOC);

// Held while still inside the transaction, before commit, to maximize the
// chance the second process is genuinely blocked on this row's lock
// rather than racing ahead of it by accident.
usleep(200000);

$pdo->commit();

echo $row['rev'];
