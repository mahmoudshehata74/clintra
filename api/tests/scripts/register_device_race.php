<?php

/**
 * Standalone, no-Laravel-bootstrap script used only by
 * tests/Feature/Rls/RegisterDeviceValidationTest.php's concurrency test.
 * Launched via proc_open() as a genuinely separate OS process (not a
 * thread, not a fork — pcntl isn't available on Windows, where this suite
 * also runs), so two invocations racing on the same activation code are a
 * real concurrency test, not a simulated one.
 *
 * Args: host port database username password payload_json
 * Prints exactly "OK" (registration succeeded) or "FAIL" (rejected, for
 * any reason) to stdout and exits 0 either way — the test asserts on the
 * printed word, not the exit code, since a rejected registration is an
 * expected, successful test outcome for the losing side of the race.
 */
[, $host, $port, $database, $username, $password, $payloadJson] = $argv;

try {
    $pdo = new PDO(
        "pgsql:host={$host};port={$port};dbname={$database}",
        $username,
        $password,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
    );

    $statement = $pdo->prepare('select register_device(?::jsonb)');
    $statement->execute([$payloadJson]);

    echo 'OK';
} catch (Throwable) {
    echo 'FAIL';
}
