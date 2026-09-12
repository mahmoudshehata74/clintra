<?php

/**
 * 2026_09_12_000012_add_row_versioning.php: every syncable table gets a
 * server-assigned `rev`, enforced by a shared trigger (enforce_row_rev())
 * rather than column-level grants — see that migration's own doc comment
 * for why a trigger is the only mechanism that actually computes the
 * increment, and why it needs no grant changes at all.
 */
const SYNCABLE_TABLES = [
    'cash_close', 'day_state', 'invoice_items', 'invoices',
    'membership_locations', 'membership_practitioners', 'memberships',
    'patients', 'payments', 'schedules', 'service_price_overrides',
    'services', 'visit_form_data', 'visits',
];

test('every syncable table has a rev column and the enforcement trigger attached', function () {
    foreach (SYNCABLE_TABLES as $table) {
        $column = $this->asOwner()->selectOne(<<<'SQL'
            SELECT data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = ? AND column_name = 'rev'
        SQL, [$table]);

        expect($column)->not->toBeNull("{$table} is missing a rev column");
        expect($column->data_type)->toBe('integer');
        expect($column->is_nullable)->toBe('NO');

        $trigger = $this->asOwner()->selectOne(<<<'SQL'
            SELECT t.tgname
            FROM pg_trigger t
            JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE t.tgrelid = ?::regclass AND p.proname = 'enforce_row_rev' AND NOT t.tgisinternal
        SQL, [$table]);

        expect($trigger)->not->toBeNull("{$table} has no enforce_row_rev trigger attached");
    }
});

test('an insert lands rev 1 and an update bumps it to 2', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);

    $row = $this->fx()->table('memberships')->where('id', $membership)->first();
    expect($row->rev)->toBe(1);

    $this->withMembership($this->asApp(), $membership, function ($db) use ($membership) {
        $db->table('memberships')->where('id', $membership)->update(['role' => 'assistant']);
    });

    $row = $this->fx()->table('memberships')->where('id', $membership)->first();
    expect($row->rev)->toBe(2);
});

test('a client-supplied rev is never honoured, on insert or update', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();

    // Insert: even the fixtures connection (which builds the row directly,
    // no membership context needed) cannot make an explicit rev value
    // stick — the trigger overwrites it regardless of who is inserting.
    $membership = $this->makeMembership($user, $org, ['role' => 'owner', 'rev' => 999]);
    $row = $this->fx()->table('memberships')->where('id', $membership)->first();
    expect($row->rev)->toBe(1);

    // Update: clintra_app explicitly tries to set rev in its own SET
    // clause; the trigger still recomputes it from OLD.rev, ignoring the
    // client's value entirely.
    $this->withMembership($this->asApp(), $membership, function ($db) use ($membership) {
        $db->table('memberships')->where('id', $membership)->update(['role' => 'assistant', 'rev' => 999]);
    });

    $row = $this->fx()->table('memberships')->where('id', $membership)->first();
    expect($row->rev)->toBe(2);
});

test('provisioning creates its membership row at rev 1', function () {
    $ids = provisionViaCommand(
        'عيادة اختبار النسخ', 'الفرع الرئيسي', 'شارع الاختبار', '01001234599',
        'د. نسخ', '01000000099',
    );

    $row = $this->fx()->table('memberships')->where('id', $ids['membership'])->first();
    expect($row->rev)->toBe(1);

    cleanupProvisioned($ids);
    $this->fx()->table('users')->where('id', $ids['user'])->delete();
});

test('two concurrent updates to the same row never land on the same rev', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);

    $config = config('database.connections.pgsql');
    $script = __DIR__.'/../../scripts/rev_concurrent_update.php';

    $buildCommand = fn () => [
        PHP_BINARY, $script,
        $config['host'], (string) $config['port'], $config['database'],
        $config['username'], $config['password'], $membership,
    ];

    $processA = proc_open($buildCommand(), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesA);
    $processB = proc_open($buildCommand(), [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipesB);

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

    $revs = [(int) $outputA, (int) $outputB];
    sort($revs);

    // Both updates succeed (Postgres's own row lock serializes them —
    // there is no unique constraint to reject a loser here, unlike the
    // activation-code race). What must never happen is both landing on
    // the same value.
    expect($revs)->toBe([2, 3]);

    $final = $this->fx()->table('memberships')->where('id', $membership)->first();
    expect($final->rev)->toBe(3);
});
