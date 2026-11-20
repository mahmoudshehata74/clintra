<?php

namespace App\Http\Middleware;

use App\Support\DatabaseSession;
use App\Support\Identity\Identity;
use App\Support\Identity\RequestProof;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A request made by a person signed in on this device
 * (docs/design-identity-permissions.md, 6.5): `X-Clintra-Person-Proof`
 * names a live credential of the calling device, its person is active, and
 * the credential's key signed this request. The rest of the request then
 * runs as that person — app.membership_id is theirs for the whole
 * transaction — so every function and policy sees the proven caller as
 * current_membership().
 *
 * `person:required` — always (the password, reset and revoke endpoints).
 * `person:enforced` — only when the organization is enforced; otherwise the
 * request runs as the device token's membership, exactly as before (POST
 * /api/staff, the username endpoint).
 *
 * Runs after `membership` (and `device.proof` where the route has it).
 * Every refusal is the generic 401.
 */
class RequirePersonProof
{
    public function handle(Request $request, Closure $next, string $mode = 'required'): Response
    {
        $deviceId = $request->attributes->get('device_id');

        if ($deviceId === null) {
            return Identity::unauthenticated();
        }

        if ($mode === 'enforced' && ! Identity::enforced($request)) {
            return $next($request);
        }

        $proof = RequestProof::parsePerson($request);
        $credential = $proof === null ? null : Identity::liveCredential($proof['credential_id'], $deviceId);
        $person = $credential === null ? null : Identity::person($credential->membership_id);

        if ($person === null || ! $person['is_active'] || ! RequestProof::verifyPerson($request, $proof, $credential->public_key)) {
            return Identity::unauthenticated();
        }

        app(DatabaseSession::class)->actAs($person['membership_id']);

        $request->attributes->set('person', $person);
        $request->attributes->set('credential_id', $credential->id);

        return $next($request);
    }
}
