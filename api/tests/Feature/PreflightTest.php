<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

test('preflight inspects the test database read-only and reports the production exclusion of its fixtures role', function () {
    config(['deployment.scheduler_configured' => true, 'app.debug' => false, 'app.url' => 'https://api.example.com']);
    $writes = [];
    DB::listen(function ($query) use (&$writes) {
        if (! preg_match('/^\s*(select|show)\b/i', $query->sql)) {
            $writes[] = $query->sql;
        }
    });
    expect(Artisan::call('clintra:preflight'))->toBe(1);
    $output = Artisan::output();
    foreach (['app connection uses clintra_app', 'tenant tables FORCE RLS', 'migrations up to date',
        'scheduler configured', 'CORS origins configured', 'APP_DEBUG false', 'HTTPS application URL',
        'identity CORS headers configured'] as $check) {
        expect($output)->toContain('PASS '.$check);
    }
    foreach (['clintra_owner', 'clintra_app', 'clintra_rls', 'clintra_provision', 'clintra_mint', 'clintra_register', 'clintra_staff', 'clintra_auth'] as $role) {
        expect($output)->toContain("PASS role {$role} attributes");
    }
    expect($output)->toContain('FAIL clintra_fixtures absent')->and($writes)->toBe([]);
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
