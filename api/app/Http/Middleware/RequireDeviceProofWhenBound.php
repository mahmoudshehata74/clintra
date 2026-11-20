<?php

namespace App\Http\Middleware;

use App\Support\Identity\Identity;
use App\Support\Identity\RequestProof;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The identity endpoints (routes/api.php, "Identity") need the device key's
 * proof whenever the device has a bound key, enforced organization or not:
 * they are new, so nothing that worked before depends on them working
 * without one. A device with no key yet passes; POST /api/auth/login then
 * holds a device key it is about to bind to its own proof of possession
 * (App\Http\Controllers\AuthController).
 *
 * Runs after `membership`, inside its transaction. Every refusal is the
 * generic 401.
 */
class RequireDeviceProofWhenBound
{
    public function handle(Request $request, Closure $next): Response
    {
        $deviceId = $request->attributes->get('device_id');

        if ($deviceId === null) {
            return Identity::unauthenticated();
        }

        if ($request->attributes->get('device_proof_verified') !== true) {
            $publicKey = Identity::devicePublicKey($deviceId);

            if ($publicKey !== null) {
                if (! RequestProof::verifyDevice($request, $deviceId, $publicKey)) {
                    return Identity::unauthenticated();
                }

                $request->attributes->set('device_proof_verified', true);
            }
        }

        return $next($request);
    }
}
