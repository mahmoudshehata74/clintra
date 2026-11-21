<?php

use App\Http\Middleware\PanelSecurity;
use App\Http\Middleware\ResolvePlatformSession;
use App\Http\Middleware\TrustPanelProxies;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\TrustProxies;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php', health: '/up')
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->replace(TrustProxies::class, TrustPanelProxies::class);
        $middleware->append(PanelSecurity::class);
        $middleware->prependToPriorityList(AuthenticatesRequests::class, ResolvePlatformSession::class);
        $middleware->redirectGuestsTo(fn () => route('filament.admin.auth.login'));
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontFlash(['password', 'current_password', 'password_confirmation', 'otp']);
    })->create();
