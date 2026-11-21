<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

function withCurrentPreflightMigrations(Closure $assertions): void
{
    $owner = DB::connection('pgsql_owner');
    expect($owner->selectOne('SELECT current_database() AS name')->name)->toBe('clintra_test');
    $owner->beginTransaction();

    try {
        $files = array_map(fn ($file) => pathinfo($file, PATHINFO_FILENAME), glob(database_path('migrations/*.php')));
        $owner->table('migrations')->whereNotIn('migration', $files)->delete();
        $recorded = $owner->table('migrations')->pluck('migration')->all();
        foreach (array_diff($files, $recorded) as $migration) {
            $owner->table('migrations')->insert(['migration' => $migration, 'batch' => 1]);
        }

        $assertions($owner, $files);
    } finally {
        $owner->rollBack();
    }
}

function readOnlyPreflightOutput(): string
{
    $writes = [];
    $recording = true;
    DB::listen(function ($query) use (&$writes, &$recording) {
        if ($recording && ! preg_match('/^\s*(select|show)\b/i', $query->sql)) {
            $writes[] = $query->sql;
        }
    });

    try {
        expect(Artisan::call('clintra:preflight'))->toBe(1);
        $output = Artisan::output();
    } finally {
        $recording = false;
    }
    expect($writes)->toBe([]);

    return $output;
}

test('preflight inspects the test database read-only and reports the production exclusion of its fixtures role', function () {
    config(['deployment.scheduler_configured' => true, 'app.debug' => false, 'app.url' => 'https://api.example.com']);
    withCurrentPreflightMigrations(function () {
        $output = readOnlyPreflightOutput();
        foreach (['app connection uses clintra_app', 'tenant tables FORCE RLS', 'migrations up to date',
            'scheduler configured', 'CORS origins configured', 'APP_DEBUG false', 'HTTPS application URL',
            'identity CORS headers configured'] as $check) {
            expect($output)->toContain('PASS '.$check);
        }
        foreach (['clintra_owner', 'clintra_app', 'clintra_rls', 'clintra_provision', 'clintra_mint', 'clintra_register', 'clintra_staff', 'clintra_auth'] as $role) {
            expect($output)->toContain("PASS role {$role} attributes");
        }
        expect($output)->toContain('FAIL clintra_fixtures absent');
    });
});

test('preflight refuses an extra migration record without a file', function () {
    withCurrentPreflightMigrations(function ($owner) {
        $owner->table('migrations')->insert(['migration' => '2099_01_01_000000_preflight_extra', 'batch' => 1]);
        expect(readOnlyPreflightOutput())->toContain('FAIL migrations up to date')->not->toContain('PASS migrations up to date');
    });
});

test('preflight refuses a migration file without a record', function () {
    withCurrentPreflightMigrations(function ($owner, $files) {
        $owner->table('migrations')->where('migration', $files[0])->delete();
        expect(readOnlyPreflightOutput())->toContain('FAIL migrations up to date')->not->toContain('PASS migrations up to date');
    });
});

test('preflight reports independent environment failures without exposing configuration secrets', function () {
    config(['deployment.scheduler_configured' => false, 'app.debug' => true, 'app.url' => 'http://api.example.com',
        'cors.allowed_origins' => ['http://localhost:5173'], 'cors.allowed_headers' => ['Authorization']]);
    expect(Artisan::call('clintra:preflight'))->toBe(1);
    $output = Artisan::output();
    foreach (['scheduler configured', 'CORS origins configured', 'identity CORS headers configured', 'APP_DEBUG false', 'HTTPS application URL'] as $check) {
        expect($output)->toContain('FAIL '.$check);
    }
    expect($output)->not->toContain(config('database.connections.pgsql.password'));
});

test('preflight refuses wildcard or credential-bearing CORS origins and application URLs', function () {
    config(['cors.allowed_origins' => ['https://*.example.com'], 'app.url' => 'https://user:secret@api.example.com']);
    Artisan::call('clintra:preflight');
    expect(Artisan::output())->toContain('FAIL CORS origins configured', 'FAIL HTTPS application URL')->not->toContain('secret');
});
