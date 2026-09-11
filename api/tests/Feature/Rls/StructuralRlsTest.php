<?php

// Every table in the public schema must carry both ENABLE and FORCE row
// level security, except Laravel's own infrastructure tables — a new
// domain table that forgets this is a silent isolation hole, not a loud
// one, since Postgres would otherwise let its owner (clintra_owner, who
// creates every table) read every org's rows unfiltered. See api/docs/rls.md.
test('every table has row level security enabled and forced, except Laravel infrastructure tables', function () {
    $rows = $this->asApp()->select(<<<'SQL'
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname
    SQL);

    expect($rows)->not->toBeEmpty();

    $allowlist = $this::laravelInfrastructureTables();
    $checked = [];

    foreach ($rows as $row) {
        if (in_array($row->relname, $allowlist, true)) {
            continue;
        }

        $checked[] = $row->relname;

        expect($row->relrowsecurity)
            ->toBeTrue("table \"{$row->relname}\" is missing ENABLE ROW LEVEL SECURITY");
        expect($row->relforcerowsecurity)
            ->toBeTrue("table \"{$row->relname}\" is missing FORCE ROW LEVEL SECURITY");
    }

    // Sanity check: this test only means something if it actually walked a
    // realistic number of domain tables, not an empty or truncated list.
    expect(count($checked))->toBeGreaterThan(20);
});
