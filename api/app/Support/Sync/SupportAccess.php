<?php

namespace App\Support\Sync;

use Illuminate\Support\Facades\DB;

final class SupportAccess
{
    public const CLINICAL_ENTITIES = [
        'visit_form_data', 'visit_form_revisions', 'prescriptions', 'prescription_items',
    ];

    /** Read the calling device through its ordinary clinic RLS policy. */
    public static function withoutClinical(?string $deviceId): bool
    {
        if ($deviceId === null) {
            return false;
        }

        $device = DB::table('device')->where('id', $deviceId)->first(['kind', 'include_clinical']);

        return $device?->kind === 'support' && ! $device->include_clinical;
    }

    /** Live sessions visible through device's own RLS policy. */
    public static function sessions(): array
    {
        return DB::table('device')->where('kind', 'support')->whereNull('revoked_at')
            ->where('expires_at', '>', now()->toIso8601String())
            ->orderBy('id')->get(['id', 'support_admin_name', 'expires_at'])
            ->map(fn ($row) => [
                'device_id' => $row->id,
                'admin_name' => $row->support_admin_name,
                'expires_at' => $row->expires_at,
            ])->all();
    }
}
