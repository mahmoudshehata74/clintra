<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

test('the platform migration refuses a replay over an installed schema instead of hiding it', function () {
    $owner = $this->asOwner();
    $before = $owner->table('platform.admin_log')->count();
    $migration = require database_path('migrations/2026_09_12_000053_create_platform_schema.php');
    $previous = DB::getDefaultConnection();
    DB::setDefaultConnection('pgsql_owner');
    try {
        $owner->transaction(fn () => $migration->up());
        $this->fail('Expected a populated platform schema to refuse replay');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('55000');
    } finally {
        DB::setDefaultConnection($previous);
    }
    expect($owner->table('platform.admin_log')->count())->toBe($before);
    expect($owner->selectOne("SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform'")->n)->toBe(9);
    expect($owner->selectOne("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")->nspname)->toBe('platform_crypto');
});
