<?php

/**
 * Removes the live run's organizations from clintra_test, with every row
 * that hangs off them, through the local-only fixtures connection
 * (pgsql_fixtures, BYPASSRLS — the one the Pest fixtures clean up with).
 * Refuses any other database. Usage, from api/:
 *
 *   DB_DATABASE=clintra_test php ../web/e2e-live/removeLiveOrgs.php [org-id ...]
 *
 * With no ids it removes every organization named "Live Clinic …" (what
 * liveServer.ts provisions), so a run that stopped half way leaves nothing
 * behind for the next run or for the Pest suite.
 *
 * Which rows go: those with the organization's org_id, and then, through
 * the schema's own foreign keys, every row that references a row already
 * going. They are read first and deleted afterwards, children before
 * parents (a pass that hits a reference still pointing at a row is simply
 * retried after the next pass). Users are left: they are not the
 * organization's and may be shared.
 */

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../api/vendor/autoload.php';
$app = require __DIR__.'/../../api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$db = DB::connection('pgsql_fixtures');
if ($db->getDatabaseName() !== 'clintra_test') {
    fwrite(STDERR, "refusing: connected to {$db->getDatabaseName()}, not clintra_test\n");
    exit(1);
}

$orgIds = array_slice($argv, 1);
if ($orgIds === []) {
    $orgIds = $db->table('organizations')->where('name', 'like', 'Live Clinic %')->pluck('id')->all();
}
if ($orgIds === []) {
    exit(0);
}

$tables = $db->table('information_schema.tables')
    ->where('table_schema', 'public')->where('table_type', 'BASE TABLE')
    ->pluck('table_name')->all();
$orgColumnTables = $db->table('information_schema.columns')
    ->where('table_schema', 'public')->where('column_name', 'org_id')
    ->pluck('table_name')->all();
$foreignKeys = $db->select(<<<'SQL'
    select child.relname as child_table, child_col.attname as child_column,
           parent.relname as parent_table, parent_col.attname as parent_column
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace n on n.oid = child.relnamespace and n.nspname = 'public'
    join pg_attribute child_col on child_col.attrelid = c.conrelid and child_col.attnum = c.conkey[1]
    join pg_attribute parent_col on parent_col.attrelid = c.confrelid and parent_col.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1
    SQL);
$primaryKeys = [];
foreach ($db->select(<<<'SQL'
    select t.relname as table_name, a.attname as column_name
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
    where i.indisprimary
    SQL) as $row) {
    $primaryKeys[$row->table_name][] = $row->column_name;
}

// Read every row that goes, table by table, until no foreign key adds more.
$rows = [];
foreach (array_intersect($orgColumnTables, $tables) as $table) {
    if ($table !== 'users') {
        $rows[$table] = $db->table($table)->whereIn('org_id', $orgIds)->get()->map(fn ($r) => (array) $r)->all();
    }
}
$rows['organizations'] = $db->table('organizations')->whereIn('id', $orgIds)->get()->map(fn ($r) => (array) $r)->all();
do {
    $grew = false;
    foreach ($foreignKeys as $fk) {
        if ($fk->child_table === 'users' || empty($rows[$fk->parent_table])) {
            continue;
        }
        $values = array_values(array_unique(array_filter(array_column($rows[$fk->parent_table], $fk->parent_column), fn ($v) => $v !== null)));
        if ($values === []) {
            continue;
        }
        $known = $rows[$fk->child_table] ?? [];
        $keys = $primaryKeys[$fk->child_table] ?? [];
        $knownIds = array_map(fn ($r) => implode('|', array_map(fn ($k) => $r[$k], $keys)), $known);
        foreach (array_chunk($values, 500) as $chunk) {
            foreach ($db->table($fk->child_table)->whereIn($fk->child_column, $chunk)->get() as $found) {
                $found = (array) $found;
                $id = implode('|', array_map(fn ($k) => $found[$k], $keys));
                if (! in_array($id, $knownIds, true)) {
                    $known[] = $found;
                    $knownIds[] = $id;
                    $grew = true;
                }
            }
        }
        $rows[$fk->child_table] = $known;
    }
} while ($grew);

// Delete, retrying any table still referenced until a pass deletes nothing more.
$remaining = array_filter($rows);
for ($pass = 0; $remaining !== [] && $pass < 20; $pass++) {
    foreach ($remaining as $table => $tableRows) {
        $keys = $primaryKeys[$table] ?? null;
        if ($keys === null) {
            fwrite(STDERR, "skipping {$table}: no primary key\n");
            unset($remaining[$table]);

            continue;
        }
        try {
            $db->transaction(function () use ($db, $table, $keys, $tableRows) {
                foreach ($tableRows as $row) {
                    $query = $db->table($table);
                    foreach ($keys as $key) {
                        $query->where($key, $row[$key]);
                    }
                    $query->delete();
                }
            });
            unset($remaining[$table]);
        } catch (Throwable) {
            // Still referenced by a row a later table holds; retried next pass.
        }
    }
}

if ($remaining !== []) {
    fwrite(STDERR, 'could not remove: '.implode(', ', array_keys($remaining))."\n");
    exit(1);
}

echo 'removed '.count($orgIds)." organization(s)\n";
