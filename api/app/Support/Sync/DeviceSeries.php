<?php

namespace App\Support\Sync;

use Illuminate\Support\Facades\DB;

/**
 * The calling device's own number series (device.series, docs/schema.md's
 * v16 additions), read through device's ordinary RLS policy
 * (`org_id = current_org()`) on the request's own connection — no
 * hand-written org filter, and no SECURITY DEFINER helper needed: a device
 * can only ever read device rows of its own org, and this asks only for
 * its own id. Null when the request has no device behind it (the
 * local-only X-Membership-Id bridge) or the row is not visible.
 */
class DeviceSeries
{
    public static function of(?string $deviceId): ?int
    {
        if ($deviceId === null) {
            return null;
        }

        $series = DB::table('device')->where('id', $deviceId)->value('series');

        return $series === null ? null : (int) $series;
    }
}
