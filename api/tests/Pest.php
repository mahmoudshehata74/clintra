<?php

use Illuminate\Support\Facades\DB;
use Tests\Support\RlsFixtures;
use Tests\TestCase;

// No RefreshDatabase: migrations only ever run as pgsql_owner. Tests assume
// an already-migrated database (see api/docs/rls.md and tests/Feature/Rls).
// RlsFixtures is mixed into every Feature test (not just Feature/Rls) —
// Pest rejects two overlapping ->in() scopes bound to the same TestCase —
// but cleanupFixtures() is a no-op for tests that never created fixtures.
//
// DB::disconnect() on every named connection after every test: Laravel's
// TestCase boots a fresh Application per test method (no RefreshDatabase
// here to short-circuit that), so each test's PDO connections become
// unreachable garbage the moment the next test's Application replaces the
// container — but PHP's reference-counting GC doesn't collect them
// immediately given Laravel's container's circular references, so they
// pile up across a long run instead of closing straight away. Confirmed by
// watching pg_stat_activity during a run: connection count climbed
// linearly test over test until Postgres's max_connections was exhausted
// (clintra_fixtures, a non-superuser role, was the one rejected), then
// dropped back to baseline the instant the PHP process exited. Explicit
// disconnects make every test close its own connections deterministically
// instead of leaving that to GC timing.
pest()->extend(TestCase::class)
    ->use(RlsFixtures::class)
    ->afterEach(function () {
        $this->cleanupFixtures();

        foreach (['pgsql', 'pgsql_owner', 'pgsql_fixtures'] as $connection) {
            DB::disconnect($connection);
        }
    })
    ->in('Feature');
pest()->extend(PHPUnit\Framework\TestCase::class)->in('Unit');
