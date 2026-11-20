<?php

namespace App\Support\Identity;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Per-request identity facts (docs/design-identity-permissions.md), read on
 * the ordinary RLS-bound connection: whether the caller's organization is
 * enforced, the calling device's own key, a credential of that device, and
 * the person behind it.
 *
 * Every check in A1 that changes what a request does is active only when the
 * organization's identity_enforced_at is set ("A1 decisions", 4); until
 * then the sync paths behave exactly as before.
 */
final class Identity
{
    /** The permission catalogue (section 4). An owner holds every one by role. */
    public const PERMISSIONS = [
        'reports.view', 'services.manage', 'invoices.edit_items', 'invoices.void', 'cash.close',
        'staff.manage', 'schedules.manage', 'clinical.view', 'patients.archive', 'messages.send',
    ];

    /** The current organization's switch, read through organizations' own policy. */
    public static function enforcementTimeForCurrentOrg(): ?string
    {
        $at = DB::selectOne(
            'select identity_enforced_at from organizations where id = current_org()'
        )?->identity_enforced_at;

        return $at === null ? null : Carbon::parse($at)->toISOString();
    }

    /** Set by ApplyMembership: false on the local-only bridge, which has no device. */
    public static function enforced(Request $request): bool
    {
        return $request->attributes->get('identity_enforced_at') !== null;
    }

    /** @return array{identity_enforced_at?: string} */
    public static function syncMetadata(Request $request): array
    {
        $at = $request->attributes->get('identity_enforced_at');

        return $at === null ? [] : ['identity_enforced_at' => $at];
    }

    /** @return array<string, mixed>|null the device's bound public key */
    public static function devicePublicKey(string $deviceId): ?array
    {
        $key = DB::table('device')->where('id', $deviceId)->value('public_key');

        return is_string($key) ? json_decode($key, associative: true) : null;
    }

    /**
     * A live credential of this device, read through member_credentials'
     * policy (the caller's organization only).
     *
     * @return object{id: string, membership_id: string, public_key: array<string, mixed>}|null
     */
    public static function liveCredential(mixed $credentialId, string $deviceId): ?object
    {
        if (! is_string($credentialId) || ! Str::isUuid($credentialId)) {
            return null;
        }

        $row = DB::table('member_credentials')
            ->where('id', $credentialId)
            ->where('device_id', $deviceId)
            ->whereNull('revoked_at')
            ->first(['id', 'membership_id', 'public_key']);

        if ($row === null) {
            return null;
        }

        $row->public_key = json_decode($row->public_key, associative: true);

        return $row;
    }

    /**
     * The person a credential belongs to, with permissions as a list; null
     * when the membership no longer exists.
     *
     * @return array{membership_id: string, role: string, permissions: list<string>, is_active: bool}|null
     */
    public static function person(string $membershipId): ?array
    {
        $row = DB::table('memberships')->where('id', $membershipId)->first(['id', 'role', 'permissions', 'is_active']);

        if ($row === null) {
            return null;
        }

        return [
            'membership_id' => $row->id,
            'role' => $row->role,
            'permissions' => self::parseTextArray($row->permissions),
            'is_active' => (bool) $row->is_active,
        ];
    }

    /**
     * Postgres's text form of a text[] of catalogue keys ("{a,b}"). Catalogue
     * keys hold no comma, quote, brace or space, so none is ever quoted.
     *
     * @return list<string>
     */
    public static function parseTextArray(mixed $value): array
    {
        if (is_array($value)) {
            return array_values($value);
        }
        if (! is_string($value) || $value === '{}' || $value === '') {
            return [];
        }

        return array_values(array_map(fn (string $item) => trim($item, '"'), explode(',', trim($value, '{}'))));
    }

    /** A request may not continue: the same generic 401 every rejection in ApplyMembership returns. */
    public static function unauthenticated(): JsonResponse
    {
        return response()->json([
            'error' => 'unauthenticated',
            'message' => 'يجب تسجيل الدخول',
        ], 401);
    }
}
