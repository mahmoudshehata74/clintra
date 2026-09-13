<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // /api/devices/register needs no limiter registered here — it
        // already rate-limits itself, dual-keyed by IP and by the
        // submitted activation code, inside
        // App\Http\Controllers\DeviceRegistrationController (see routes/api.php's
        // own comment on that route for why this endpoint deliberately
        // isn't also wrapped in a throttle: middleware).
        //
        // /api/sync/push, /api/sync/pull, /api/sync/bootstrap are all
        // authenticated (behind `membership`) — keyed by the bearer token
        // itself, not IP. IP-keying would be wrong here specifically: a
        // clinic's several tablets typically share one public IP (one
        // office network), and Laravel's own default `api` limiter keys
        // by `$request->user()?->id ?: $request->ip()` — this app never
        // populates `Auth::user()` (ApplyMembership verifies tokens by
        // hand, see its own doc comment), so the default would silently
        // fall through to IP and let one busy or malfunctioning device
        // exhaust the whole clinic's shared budget. Keying by the token
        // string instead gives each device its own independent bucket
        // regardless of network. 120/minute is well above the steady
        // state (sync/engine.ts's own 10-second interval is ~6 pushes +
        // 6 pulls/minute per device even under constant activity) while
        // still bounding a genuinely malfunctioning or malicious client.
        RateLimiter::for('sync', function (Request $request) {
            return Limit::perMinute(120)->by($request->bearerToken() ?? $request->ip());
        });
    }
}
