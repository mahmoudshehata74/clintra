<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

final class ResolvePlatformSession
{
    public function handle(Request $request, Closure $next)
    {
        $guard = Auth::guard('platform');
        $guard->setRequest($request);
        $user = $guard->user();
        if ($user === null && ! $request->routeIs('filament.admin.auth.login', 'panel.sign-in', 'panel.logout')) {
            return redirect()->route('filament.admin.auth.login');
        }
        if ($user?->must_change_password && ! $request->routeIs('filament.admin.pages.change-password', 'panel.password', 'panel.logout', 'filament.admin.auth.logout')) {
            return redirect()->route('filament.admin.pages.change-password');
        }

        return $next($request);
    }
}
