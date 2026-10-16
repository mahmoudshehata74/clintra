<?php

use App\Support\Sync\SyncPayload;

/**
 * App\Support\Sync\SyncPayload — the shape every pulled row takes, per
 * docs/schema.md's conventions (instants ISO 8601 UTC, times "HH:MM").
 */
test('a timestamptz in Postgres text form becomes an ISO 8601 UTC instant with milliseconds', function () {
    $payload = SyncPayload::fromRow('visits', (object) [
        'scheduled_at' => '2026-10-16 09:00:00+03',
        'created_at' => '2026-10-16 18:49:29.123456+03',
        'ended_at' => null,
    ]);

    expect($payload['scheduled_at'])->toBe('2026-10-16T06:00:00.000Z');
    expect($payload['created_at'])->toBe('2026-10-16T15:49:29.123Z');
    expect($payload['ended_at'])->toBeNull();
});

test('a schedule\'s times lose their seconds', function () {
    $payload = SyncPayload::fromRow('schedules', ['start_time' => '09:00:00', 'end_time' => '17:30:00', 'slot_minutes' => 30]);

    expect($payload['start_time'])->toBe('09:00');
    expect($payload['end_time'])->toBe('17:30');
    expect($payload['slot_minutes'])->toBe(30);
});

test('a visit form\'s jsonb data arrives as the value it holds, not as text', function () {
    $payload = SyncPayload::fromRow('visit_form_data', ['data' => '{"complaint": "ألم", "diagnosis": null}']);

    expect($payload['data'])->toBe(['complaint' => 'ألم', 'diagnosis' => null]);
});

test('plain values are left as they are', function () {
    $row = ['id' => 'a', 'full_name' => '2026-10-16 09:00 موعد', 'visit_date' => '2026-10-16', 'is_active' => true, 'note' => '09:00:00'];

    expect(SyncPayload::fromRow('patients', $row))->toBe($row);
});
