<?php

namespace App\Support\Sync;

use Illuminate\Support\Facades\DB;

/**
 * GET /api/sync/pull's actual work, matching SyncTransport.pullSince's
 * contract: one opaque cursor in, a batch of changes and a new cursor
 * out. See SyncPushController's own doc comment for the request-level
 * validation this class assumes has already happened (a well-formed,
 * non-negative cursor).
 *
 * Org isolation is never hand-written here — every query in this class
 * reads `sync_ledger` or an entity table exactly as any other RLS-bound
 * `clintra_app` query would, relying entirely on each table's own SELECT
 * policy (`sync_ledger_select`: `org_id = current_org()`; every entity
 * table's own policy) to scope the result. There is no `->where('org_id', ...)`
 * anywhere in this class to forget — see
 * tests/Feature/Rls/SyncPullTest.php's org-isolation tests, which prove
 * this holds even against a cursor or entity_id borrowed from another
 * org, not just a same-org request.
 */
class SyncPuller
{
    /**
     * Kept deliberately small: a first sync's response has to complete
     * over a connection bad enough that the offline-first architecture
     * exists for in the first place (docs/reference/clintra-cli-brief.md
     * section 1: "the web app... opens and works with the network down").
     * 200 rows keeps a single page's JSON small even when every row's
     * `payload` is a full entity (a `visits` row has ~20 columns), so one
     * round trip stays resumable within an ordinary request timeout
     * instead of one giant page risking a timeout with no partial
     * progress to show for it.
     */
    private const PAGE_SIZE = 200;

    public function currentMaxSeq(): int
    {
        return (int) (DB::table('sync_ledger')->max('seq') ?? 0);
    }

    /**
     * @return array{cursor: string, has_more: bool, rows: list<array{seq: int, entity: string, entity_id: string, rev: int, device_id: string, payload: ?array}>}
     */
    public function pull(int $since): array
    {
        $rows = DB::table('sync_ledger')
            ->where('seq', '>', $since)
            ->orderBy('seq')
            ->limit(self::PAGE_SIZE + 1)
            ->get();

        $hasMore = $rows->count() > self::PAGE_SIZE;
        $page = $hasMore ? $rows->take(self::PAGE_SIZE) : $rows;

        $newCursor = $page->isNotEmpty() ? (int) $page->last()->seq : $since;

        $result = $page->map(function ($row) {
            return [
                'seq' => (int) $row->seq,
                'entity' => $row->entity,
                'entity_id' => $row->entity_id,
                'rev' => (int) $row->rev,
                'device_id' => $row->device_id,
                'payload' => $this->currentPayload($row->entity, $row->entity_id),
            ];
        })->values()->all();

        return [
            'cursor' => (string) $newCursor,
            'has_more' => $hasMore,
            'rows' => $result,
        ];
    }

    /**
     * The ledger records that entity_id changed and what rev it reached —
     * never the row's actual content (docs/schema.md's "v12 additions"),
     * so the row's *current* state is read fresh here, through that
     * table's own RLS policy, not a historical snapshot. Null means the
     * row no longer exists (deleted since, by this op or a later one) —
     * the pulling device's own job to interpret, once HttpTransport
     * exists to hand it this response at all.
     *
     * @return array<string, mixed>|null
     */
    private function currentPayload(string $entity, string $entityId): ?array
    {
        // Every value ever written to sync_ledger.entity came from
        // PushSyncOpsRequest's own `in:` validation against this same
        // list — this check is defense against querying an unexpected
        // table name some other way, not a case expected to ever trigger.
        if (! in_array($entity, SyncableTables::NAMES, true)) {
            return null;
        }

        $row = DB::table($entity)->where('id', $entityId)->first();

        return $row === null ? null : (array) $row;
    }
}
