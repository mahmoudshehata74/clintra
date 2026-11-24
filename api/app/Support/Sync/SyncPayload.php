<?php

namespace App\Support\Sync;

use App\Support\Identity\Identity;
use Carbon\CarbonImmutable;

/**
 * A row read back from Postgres, in the shape devices store
 * (docs/schema.md's conventions): instants as ISO 8601 UTC strings with
 * milliseconds ("2026-10-16T06:00:00.000Z", what a device's own
 * Date.toISOString() writes), times as "HH:MM", and a jsonb column as the
 * value it holds. The query builder hands every one of these back as
 * Postgres text ("2026-10-16 09:00:00+03", "09:00:00", '{"a":1}'), which a
 * device would store as is: a schedule read "17:00:00" on screen, a
 * visit's times stopped sorting against the device's own, and a visit
 * form's data arrived as a string. Used by every pull (SyncPuller,
 * SyncBootstrapPuller).
 */
final class SyncPayload
{
    /** table => its `time` columns. */
    private const TIME_COLUMNS = [
        'schedules' => ['start_time', 'end_time'],
        'schedule_exceptions' => ['start_time', 'end_time'],
    ];

    /** table => its jsonb columns. */
    private const JSON_COLUMNS = [
        'visit_form_data' => ['data'],
        'visit_form_revisions' => ['previous_data', 'new_data'],
        'device_audit_log' => ['before', 'after'],
    ];

    /** Postgres's text form of a timestamptz value. */
    private const TIMESTAMPTZ = '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/';

    /** memberships' identity columns (identity A1): in a pull only once the organization is enforced. */
    private const IDENTITY_COLUMNS = ['username', 'permissions'];

    /**
     * $identityEnforced: whether the pulling device's organization is
     * enforced ("A1 decisions", 4). Until it is, a membership row leaves out
     * username and permissions, so the device receives exactly the bytes it
     * did before they existed; once it is, permissions arrive as a list.
     *
     * @param  array<string, mixed>|object  $row
     * @return array<string, mixed>
     */
    public static function fromRow(string $table, array|object $row, bool $identityEnforced = false,
        bool $withoutClinical = false): array
    {
        $payload = (array) $row;

        if ($table === 'memberships') {
            if ($identityEnforced) {
                $payload['permissions'] = Identity::parseTextArray($payload['permissions'] ?? null);
                unset($payload['pin_hash'], $payload['pin_salt']);
            } else {
                $payload = array_diff_key($payload, array_flip(self::IDENTITY_COLUMNS));
            }
        }

        if ($withoutClinical && $table === 'visits') {
            $payload['note'] = null;
        }

        foreach ($payload as $column => $value) {
            if (is_string($value) && preg_match(self::TIMESTAMPTZ, $value) === 1) {
                $payload[$column] = CarbonImmutable::parse($value)->utc()->format('Y-m-d\TH:i:s.v\Z');
            }
        }

        foreach (self::TIME_COLUMNS[$table] ?? [] as $column) {
            if (is_string($payload[$column] ?? null)) {
                $payload[$column] = substr($payload[$column], 0, 5);
            }
        }

        foreach (self::JSON_COLUMNS[$table] ?? [] as $column) {
            if (is_string($payload[$column] ?? null)) {
                $payload[$column] = json_decode($payload[$column], associative: true, flags: JSON_THROW_ON_ERROR);
            }
        }

        return $payload;
    }
}
