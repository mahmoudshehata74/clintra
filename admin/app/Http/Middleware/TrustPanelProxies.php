<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use RuntimeException;

final class TrustPanelProxies
{
    public function handle(Request $request, Closure $next)
    {
        $proxies = config('panel.trusted_proxies', []);
        foreach ($proxies as $proxy) {
            $parts = explode('/', $proxy, 2);
            $maximum = str_contains($parts[0], ':') ? 128 : 32;
            if (! filter_var($parts[0], FILTER_VALIDATE_IP) || (isset($parts[1]) && (! ctype_digit($parts[1]) || (int) $parts[1] > $maximum))) {
                throw new RuntimeException('Trusted proxies must be explicit IP addresses or CIDRs.');
            }
        }
        // Explicit configuration only: no cloud-provider or calling-IP fallback.
        $request::setTrustedProxies($proxies, Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_HOST | Request::HEADER_X_FORWARDED_PORT | Request::HEADER_X_FORWARDED_PROTO);

        return $next($request);
    }
}
