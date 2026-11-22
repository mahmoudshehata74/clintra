<?php

namespace App\Providers;

use App\Auth\PlatformGuard;
use App\Auth\PlatformUserProvider;
use App\Support\Platform;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Laravel merges its base configuration; remove all unused database/auth defaults.
        config(['database.connections' => ['pgsql' => config('database.connections.pgsql')],
            'auth.guards' => ['platform' => config('auth.guards.platform')],
            'auth.providers' => ['platform' => config('auth.providers.platform')],
            'cache.stores' => ['file' => config('cache.stores.file'), 'array' => config('cache.stores.array')]]);
    }

    public function boot(): void
    {
        Auth::provider('platform', fn ($app) => new PlatformUserProvider($app->make(Platform::class)));
        Auth::extend('platform', fn ($app, $name, $config) => new PlatformGuard(Auth::createUserProvider($config['provider']), $app['request'], $app->make(Platform::class)));
        RateLimiter::for('panel-sign-in', fn (Request $request) => Limit::perMinutes(15, 10)->by($request->ip())->response(fn () => response()->view('errors.429', [], 429)));
    }
}
