<?php

use Tests\Support\RlsFixtures;
use Tests\TestCase;

// No RefreshDatabase: migrations only ever run as pgsql_owner. Tests assume
// an already-migrated database (see api/docs/rls.md and tests/Feature/Rls).
// RlsFixtures is mixed into every Feature test (not just Feature/Rls) —
// Pest rejects two overlapping ->in() scopes bound to the same TestCase —
// but cleanupFixtures() is a no-op for tests that never created fixtures.
pest()->extend(TestCase::class)
    ->use(RlsFixtures::class)
    ->afterEach(fn () => $this->cleanupFixtures())
    ->in('Feature');
pest()->extend(PHPUnit\Framework\TestCase::class)->in('Unit');
