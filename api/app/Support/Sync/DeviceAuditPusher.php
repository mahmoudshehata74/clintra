<?php

namespace App\Support\Sync;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * POST /api/audit/push's work: stores one device audit row
 * (docs/audit-sync.md's "Rows going up"). Every row gets its own result and
 * its own savepoint, so a refused row never aborts the rest of the batch.
 *
 * Results, one meaning each:
 * - `accepted` — inserted.
 * - `duplicate` — a row with that id is already stored, with the same
 *   content; nothing written. A resend is a no-op.
 * - `rejected` — final: the row is refused and will be refused again.
 * - `failed` — anything this class does not model (`internal_error`): the
 *   device sends the row again later.
 *
 * Who pushed and from which device is the server's (the token's membership
 * and device); the actor is the device's claim, limited to the
 * organization's members (api/docs/rls.md's "Device audit rows"). No
 * sync_ledger row and no audit_log row is written for an audit row.
 */
class DeviceAuditPusher
{
    /** At most this much JSON in a row's before and after together. */
    public const MAX_RECORD_BYTES = 65536;

    /** Fields of a memberships record that never leave the device. */
    private const SECRET_FIELDS = ['pin_hash', 'pin_salt'];

    private const ACTIONS = ['create', 'update', 'delete'];

    /**
     * @param  array<string, mixed>  $row
     * @return array{id: mixed, status: string, reason?: string}
     */
    public function push(array $row, string $membershipId, string $deviceId): array
    {
        $id = $row['id'] ?? null;

        $reason = $this->refusal($row);
        if ($reason !== null) {
            return ['id' => $id, 'status' => 'rejected', 'reason' => $reason];
        }

        try {
            return DB::transaction(fn () => $this->store($row, $membershipId, $deviceId));
        } catch (Throwable $e) {
            report($e);

            return ['id' => $id, 'status' => 'failed', 'reason' => 'internal_error'];
        }
    }

    /**
     * Everything that can be decided before the insert, in order; null when
     * the row may be stored.
     *
     * @param  array<string, mixed>  $row
     */
    private function refusal(array $row): ?string
    {
        if (! $this->isWellFormed($row)) {
            return 'audit_invalid';
        }

        if ($row['org_id'] !== DB::selectOne('select current_org() as id')->id) {
            return 'org_mismatch';
        }

        if (! in_array($row['entity'], [...SyncableTables::NAMES, 'users'], true)) {
            return 'unknown_entity';
        }

        if ($row['entity'] === 'memberships' && $this->carriesSecret($row)) {
            return 'audit_secret_field';
        }

        // Read through memberships' own policy: only the organization's.
        if (! DB::table('memberships')->where('id', $row['actor_membership_id'])->exists()) {
            return 'actor_not_in_org';
        }

        if (! $this->tagsMatchRecord($row) || ! $this->tagsInScope($row)) {
            return 'scope_mismatch';
        }

        return null;
    }

    /** @param  array<string, mixed>  $row */
    private function isWellFormed(array $row): bool
    {
        foreach (['id', 'org_id', 'actor_membership_id', 'entity_id'] as $field) {
            if (! is_string($row[$field] ?? null) || ! Str::isUuid($row[$field])) {
                return false;
            }
        }
        foreach (['location_id', 'practitioner_id'] as $field) {
            $value = $row[$field] ?? null;
            if ($value !== null && (! is_string($value) || ! Str::isUuid($value))) {
                return false;
            }
        }

        $entity = $row['entity'] ?? null;
        if (! is_string($entity) || $entity === '' || strlen($entity) > 64) {
            return false;
        }

        $action = $row['action'] ?? null;
        if (! in_array($action, self::ACTIONS, true)) {
            return false;
        }

        $before = $row['before'] ?? null;
        $after = $row['after'] ?? null;
        foreach ([$before, $after] as $record) {
            if ($record !== null && (! is_array($record) || array_is_list($record) && $record !== [])) {
                return false;
            }
        }
        $shapeMatches = match ($action) {
            'create' => $before === null && $after !== null,
            'update' => $before !== null && $after !== null,
            'delete' => $before !== null && $after === null,
        };
        if (! $shapeMatches) {
            return false;
        }

        if (strlen(json_encode([$before, $after])) > self::MAX_RECORD_BYTES) {
            return false;
        }

        return is_string($row['at'] ?? null) && $this->parsesAsInstant($row['at']);
    }

    private function parsesAsInstant(string $value): bool
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/', $value) !== 1) {
            return false;
        }

        try {
            Carbon::parse($value);
        } catch (Throwable) {
            return false;
        }

        return true;
    }

    /** @param  array<string, mixed>  $row */
    private function carriesSecret(array $row): bool
    {
        foreach ([$row['before'] ?? null, $row['after'] ?? null] as $record) {
            foreach (self::SECRET_FIELDS as $field) {
                if (is_array($record) && array_key_exists($field, $record)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * The tags agree with the record's own location_id and practitioner_id
     * where it has them, and a practitioner's row is tagged with itself —
     * the device derives them the same way (web/src/domain/auditScope.ts).
     *
     * @param  array<string, mixed>  $row
     */
    private function tagsMatchRecord(array $row): bool
    {
        $record = $row['after'] ?? $row['before'];
        $locationTag = $row['location_id'] ?? null;
        $practitionerTag = $row['practitioner_id'] ?? null;

        if ($row['entity'] === 'practitioners') {
            return $practitionerTag === $row['entity_id'] && $locationTag === null;
        }

        if (is_string($record['location_id'] ?? null) && $record['location_id'] !== $locationTag) {
            return false;
        }

        return ! (is_string($record['practitioner_id'] ?? null) && $record['practitioner_id'] !== $practitionerTag);
    }

    /**
     * Each tag is a location / practitioner the pushing membership may see —
     * the INSERT policy's own condition, checked first for a clean reason.
     *
     * @param  array<string, mixed>  $row
     */
    private function tagsInScope(array $row): bool
    {
        $locationId = $row['location_id'] ?? null;
        $practitionerId = $row['practitioner_id'] ?? null;

        $check = DB::selectOne(
            'select (?::uuid is null or ?::uuid in (select * from allowed_locations())) as location_ok,'
            .' (?::uuid is null or ?::uuid in (select * from allowed_practitioners())) as practitioner_ok',
            [$locationId, $locationId, $practitionerId, $practitionerId],
        );

        return $check->location_ok && $check->practitioner_ok;
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array{id: string, status: string, reason?: string}
     */
    private function store(array $row, string $membershipId, string $deviceId): array
    {
        $values = [
            $row['id'], $row['org_id'], $row['location_id'] ?? null, $row['practitioner_id'] ?? null,
            $row['actor_membership_id'], $row['entity'], $row['entity_id'], $row['action'],
            $this->json($row['before'] ?? null), $this->json($row['after'] ?? null), $row['at'],
        ];

        $inserted = DB::select(<<<'SQL'
            INSERT INTO device_audit_log
                (id, org_id, location_id, practitioner_id, actor_membership_id, entity, entity_id, action,
                 before, after, at, pushed_by_membership_id, device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::timestamptz, ?, ?)
            ON CONFLICT (id) DO NOTHING
            RETURNING id
            SQL, [...$values, $membershipId, $deviceId]);

        if ($inserted !== []) {
            return ['id' => $row['id'], 'status' => 'accepted'];
        }

        // The id is taken. The same row sent again is a duplicate; anything
        // else — different content, or a row this organization cannot see —
        // keeps the stored row and refuses this one.
        $same = DB::selectOne(<<<'SQL'
            SELECT EXISTS (
                SELECT 1 FROM device_audit_log
                WHERE id = ? AND org_id = ?
                  AND location_id IS NOT DISTINCT FROM ?::uuid AND practitioner_id IS NOT DISTINCT FROM ?::uuid
                  AND actor_membership_id = ? AND entity = ? AND entity_id = ? AND action = ?
                  AND before IS NOT DISTINCT FROM ?::jsonb AND after IS NOT DISTINCT FROM ?::jsonb
                  AND at = ?::timestamptz
            ) AS same
            SQL, $values)->same;

        return $same
            ? ['id' => $row['id'], 'status' => 'duplicate']
            : ['id' => $row['id'], 'status' => 'rejected', 'reason' => 'audit_id_taken'];
    }

    private function json(mixed $record): ?string
    {
        return $record === null ? null : json_encode($record, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    }
}
