<?php

namespace App\Support;

use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use ReflectionClass;
use Throwable;

/**
 * bootstrap/app.php configures `trustProxies(at: '*')` — trust every hop,
 * the standard choice for a platform whose edge IPs aren't fixed or
 * published (see that file's own comment). If this app is ever directly
 * reachable — not exclusively through that platform's own proxy — a
 * caller can forge X-Forwarded-For and get a fresh identity on every
 * request, which specifically defeats the IP-keyed half of the
 * activation-code rate limiter
 * (App\Http\Controllers\DeviceRegistrationController): each forged IP
 * looks like a first attempt, so the real defense against trying many
 * *different* codes collapses to nothing (the code-keyed half only ever
 * limits repeated guesses at the *same* code, which a real attacker
 * never repeats).
 *
 * This never fails the request or blocks boot — a diagnostic warning
 * logged at most once a day, not a gate. See docs/deployment.md's
 * "HTTPS and reverse proxies" for the actual required action (narrow the
 * trusted range, or confirm direct reachability is impossible).
 */
class TrustedProxyGuard
{
    private const LOG_DEDUP_KEY = 'trusted-proxy-guard:wildcard-warning-logged';

    /**
     * Pure and directly testable — no environment simulation needed to
     * prove the condition itself, only to prove the wiring around it.
     */
    public static function shouldWarn(string $environment, array|string|null $configuredProxies): bool
    {
        return $environment === 'production' && $configuredProxies === '*';
    }

    /**
     * Reads TrustProxies' own configured value via reflection — there is
     * no public accessor for it (`Illuminate\Http\Middleware\TrustProxies::at()`
     * only ever writes). Returns null on any failure (a future Laravel
     * upgrade renaming the property, for instance) rather than throwing:
     * a diagnostic guard that can't determine the state should stay
     * silent, never break boot over its own uncertainty.
     */
    public static function currentlyConfiguredProxies(): array|string|null
    {
        try {
            $property = (new ReflectionClass(TrustProxies::class))->getProperty('alwaysTrustProxies');
            $property->setAccessible(true);

            return $property->getValue();
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * The actual side effect, called with no arguments from
     * AppServiceProvider::boot() — both real values, resolved live. The
     * two parameters exist so a test can force the true-condition path
     * directly (including the real dedup below) without needing to boot
     * a literal production application; `shouldWarn()`'s own unit tests
     * already cover the condition logic in isolation.
     *
     * Every failure mode inside is swallowed — a clinic must never go
     * down because this diagnostic itself broke (a cache backend outage,
     * for instance).
     */
    public static function warnIfNeeded(?string $environment = null, array|string|null $configuredProxies = null): void
    {
        try {
            $environment ??= app()->environment();
            $configuredProxies ??= self::currentlyConfiguredProxies();

            if (! self::shouldWarn($environment, $configuredProxies)) {
                return;
            }

            // Cache::add is atomic "set only if absent" — this is what
            // keeps a classic per-request boot (no persistent worker) from
            // writing this line to the log on every single request.
            if (Cache::add(self::LOG_DEDUP_KEY, true, now()->addDay())) {
                Log::warning(
                    'TrustProxies is configured to trust every proxy (\'*\') in production. '.
                    'If this app is ever reachable directly — not exclusively through your load '.
                    'balancer/proxy — a caller can forge X-Forwarded-For to get a fresh rate-limit '.
                    'identity on every request, defeating IP-keyed limits (in particular, the '.
                    "activation-code registration endpoint's brute-force protection). See ".
                    "docs/deployment.md's \"HTTPS and reverse proxies\": narrow the trusted range to ".
                    'your provider\'s actual proxy IPs, or confirm direct reachability is impossible.',
                );
            }
        } catch (Throwable) {
            // See class doc comment — never let this take a running app down.
        }
    }
}
