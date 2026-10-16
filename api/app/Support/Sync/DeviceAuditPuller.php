<?php

namespace App\Support\Sync;

use Illuminate\Support\Facades\DB;

/**
 * GET /api/audit/pull's work (docs/audit-sync.md's "Rows going down"): the
 * organization's device audit rows other devices wrote, in seq order, from
 * a cursor. Organization and scope isolation come from device_audit_log's
 * SELECT policy alone — there is no org filter here to forget, as in
 * SyncPuller. The calling device's own rows are left out: an audit row has
 * no rev to learn back, and the device already holds it.
 *
 * Seq order is commit order within an organization (SyncSeqLock), so a
 * cursor never moves past a row that commits later.
 */
class DeviceAuditPuller
{
    private const PAGE_SIZE = 200;

    private const COLUMNS = [
        'id', 'org_id', 'location_id', 'practitioner_id', 'actor_membership_id', 'device_id',
        'entity', 'entity_id', 'action', 'before', 'after', 'at', 'seq',
    ];

    /** The highest seq the caller can see, its own device's rows included. */
    public function currentMaxSeq(): int
    {
        return (int) (DB::table('device_audit_log')->max('seq') ?? 0);
    }

    /**
     * Where a device's first pull starts: just before the first row the
     * caller can see whose `at` falls in the last AUDIT_FIRST_PULL_DAYS Cairo
     * days, or the caller's current end when there is none.
     */
    public function firstPullStart(): int
    {
        $from = now('Africa/Cairo')->subDays(SyncWindow::AUDIT_FIRST_PULL_DAYS - 1)->startOfDay()->toIso8601String();
        $first = DB::table('device_audit_log')->where('at', '>=', $from)->min('seq');

        return $first === null ? $this->currentMaxSeq() : (int) $first - 1;
    }

    /**
     * @return array{cursor: string, has_more: bool, rows: list<array<string, mixed>>}
     */
    public function pull(int $since, string $deviceId): array
    {
        $rows = DB::table('device_audit_log')
            ->select(self::COLUMNS)
            ->where('seq', '>', $since)
            ->where('device_id', '<>', $deviceId)
            ->orderBy('seq')
            ->limit(self::PAGE_SIZE + 1)
            ->get();

        $hasMore = $rows->count() > self::PAGE_SIZE;
        $page = $hasMore ? $rows->take(self::PAGE_SIZE) : $rows;

        return [
            'cursor' => (string) ($page->isNotEmpty() ? (int) $page->last()->seq : $since),
            'has_more' => $hasMore,
            'rows' => $page->map(function ($row) {
                $payload = SyncPayload::fromRow('device_audit_log', $row);
                $payload['seq'] = (int) $payload['seq'];

                return $payload;
            })->values()->all(),
        ];
    }
}
