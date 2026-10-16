<?php

namespace App\Support\Sync;

use Illuminate\Support\Facades\DB;

/**
 * Makes one organization's sync writes commit in seq order. sync_ledger.seq
 * is an identity column, so a value is assigned at insert, not at commit:
 * two concurrent push transactions of one organization could otherwise
 * commit out of seq order, and a device pulling in between would move its
 * cursor past the lower, still-uncommitted seq and never receive that row.
 *
 * Every transaction that inserts into sync_ledger takes this lock first,
 * before its first insert, and holds it to commit (a transaction-scoped
 * advisory lock), so within an organization the next seq is only ever
 * assigned once the previous writer has committed. The key is per
 * organization: other organizations never wait on each other. An advisory
 * lock needs no grant. See api/docs/rls.md's "One organization's sync
 * writes commit in seq order".
 */
final class SyncSeqLock
{
    /** The key's SQL, for the calling session's own organization. */
    public const KEY_SQL = "hashtextextended('sync_seq:' || current_org()::text, 0)";

    /**
     * Takes the calling session's organization's lock, waiting for any other
     * writer of the same organization to commit. Must run inside the
     * request's transaction (ApplyMembership), before the first insert. With
     * no organization declared the key is null and nothing is locked — such
     * a session can insert nothing anyway (every policy is org-scoped).
     */
    public static function acquire(): void
    {
        DB::select('select pg_advisory_xact_lock('.self::KEY_SQL.')');
    }
}
