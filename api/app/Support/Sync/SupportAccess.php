<?php

namespace App\Support\Sync;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class SupportAccess
{
    public const CLINICAL_ENTITIES = [
        'visit_form_data', 'visit_form_revisions', 'prescriptions', 'prescription_items',
    ];

    /** Entity columns whose unrestricted text or JSON can describe clinical care. */
    public const CLINICAL_COLUMNS = [
        'care_plans' => ['diagnosis', 'goal'],
        'cash_close' => ['difference_note'],
        'invoice_items' => ['description'],
        'message_templates' => ['body'],
        'messages' => ['body'],
        'patients' => ['note'],
        'payments' => ['note'],
        'schedule_exceptions' => ['reason'],
        'visits' => ['cancel_reason', 'note'],
    ];

    /** Stored credentials that a support device must never receive. */
    public const CREDENTIAL_COLUMNS = [
        'memberships' => ['pin_hash', 'pin_salt'],
    ];

    /** @var array<string, array<string, int>> */
    private static array $auditColumns = [];

    public static function omitsEntity(string $entity): bool
    {
        return in_array($entity, self::CLINICAL_ENTITIES, true);
    }

    /** @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public static function redactEntity(string $entity, array $payload, bool $withoutClinical = true): array
    {
        foreach (self::CREDENTIAL_COLUMNS[$entity] ?? [] as $column) {
            $payload[$column] = null;
        }
        if ($withoutClinical) {
            foreach (self::CLINICAL_COLUMNS[$entity] ?? [] as $column) {
                if (array_key_exists($column, $payload)) {
                    $payload[$column] = null;
                }
            }
        }

        return $payload;
    }

    /** @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function redactAuditRow(array $row, bool $withoutClinical = true): array
    {
        $entity = $row['entity'];
        self::$auditColumns[$entity] ??= array_flip(Schema::getColumnListing($entity));

        foreach (['before', 'after'] as $field) {
            if (is_array($row[$field] ?? null)) {
                // Audit JSON is accepted from devices. Unknown keys have no
                // table column to classify, so they cannot be sent to support.
                $known = array_intersect_key($row[$field], self::$auditColumns[$entity]);
                $row[$field] = self::redactEntity($entity, $known, $withoutClinical);
            }
        }

        return $row;
    }

    /** Read the calling device through its ordinary clinic RLS policy.
     * @return array{support: bool, without_clinical: bool}
     */
    public static function filters(?string $deviceId): array
    {
        if ($deviceId === null) {
            return ['support' => false, 'without_clinical' => false];
        }

        $device = DB::table('device')->where('id', $deviceId)->first(['kind', 'include_clinical']);

        $support = $device?->kind === 'support';

        return ['support' => $support, 'without_clinical' => $support && ! $device->include_clinical];
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
