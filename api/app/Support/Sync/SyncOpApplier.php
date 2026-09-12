<?php

namespace App\Support\Sync;

use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Applies one pushed sync op, per docs/sync-plan.md's decisions. Each op
 * runs in its own transaction (SyncPushController is the one that
 * sequences ops and enforces the same-entity_id blocking rule between
 * them — this class only ever sees one op at a time and knows nothing
 * about the batch it came from).
 *
 * Every code path here returns a result array
 * (`{op_id, status, rev?, reason?}`) rather than throwing outward for
 * anything a client could plausibly trigger — an *uncaught* exception is
 * exactly the "leak a SQLSTATE or query text" failure mode this class
 * exists to prevent (see api/docs/rls.md's ApplyMembership hardening
 * pass for the same principle applied to authentication).
 */
class SyncOpApplier
{
    /**
     * docs/reference/clintra-cli-brief.md, section 8: "Local storage
     * covers the last 60 days and the next 60 days." An op whose
     * client-claimed created_at falls further in the past than this is
     * treated the same as a future-dated one — both mean the timestamp
     * this endpoint would otherwise trust to resolve a slot conflict
     * (docs/sync-plan.md's Q5) is outside the range that trust was ever
     * meant to cover.
     */
    private const CLOCK_WINDOW_DAYS = 60;

    /**
     * @param  array{op_id: string, entity: string, entity_id: string, action: string, payload: ?array, created_at: string, base_rev: ?int}  $op
     * @return array{op_id: string, status: string, rev?: int, reason?: string}
     */
    public function apply(array $op, string $membershipId, string $deviceId): array
    {
        try {
            return DB::transaction(fn () => $this->applyInTransaction($op, $membershipId, $deviceId));
        } catch (Throwable $e) {
            report($e);

            return $this->failed($op, 'internal_error');
        }
    }

    /**
     * @param  array{op_id: string, entity: string, entity_id: string, action: string, payload: ?array, created_at: string, base_rev: ?int}  $op
     */
    private function applyInTransaction(array $op, string $membershipId, string $deviceId): array
    {
        $alreadySeen = DB::table('sync_ledger')->where('op_id', $op['op_id'])->exists();

        if ($alreadySeen) {
            return ['op_id' => $op['op_id'], 'status' => 'duplicate'];
        }

        $table = $op['entity'];

        if (SyncableTables::isSlotTable($table)) {
            $clockCheck = $this->checkClientClock($op, $deviceId);

            if ($clockCheck !== null) {
                return $clockCheck;
            }
        }

        $currentOrgId = DB::selectOne('select current_org() as id')->id;

        if (SyncableTables::hasDirectOrgId($table)
            && array_key_exists('org_id', $op['payload'] ?? [])
            && $op['payload']['org_id'] !== $currentOrgId) {
            return $this->failed($op, 'org_mismatch');
        }

        try {
            return match ($op['action']) {
                'create' => $this->applyCreate($op, $table, $membershipId, $deviceId, $currentOrgId),
                'update' => $this->applyUpdate($op, $table, $membershipId, $deviceId, $currentOrgId),
                'delete' => $this->applyDelete($op, $table, $membershipId, $deviceId, $currentOrgId),
            };
        } catch (QueryException $e) {
            // Any constraint violation not already handled by name above
            // (a foreign key pointing at a row that doesn't exist, for
            // instance) is unexpected — a bug for engineering to look at,
            // not a business conflict for the assistant to resolve.
            report($e);

            return $this->failed($op, 'internal_error');
        }
    }

    /**
     * Only for slot-table ops — created_at is never trusted for anything
     * on an edit-conflict table (rev does that job there), so there is
     * nothing to defend for those. Always records the observed skew,
     * whether or not the op is ultimately rejected on it, so a device's
     * clock drifting slowly stays visible (device.clock_skew_ms) even
     * while every individual op still lands inside the valid window.
     *
     * @return array{op_id: string, status: string, reason: string}|null null means the clock passed both checks.
     */
    private function checkClientClock(array $op, string $deviceId): ?array
    {
        $serverNow = now();
        $clientCreatedAt = Carbon::parse($op['created_at']);

        DB::table('device')->where('id', $deviceId)->update([
            'clock_skew_ms' => (int) round($serverNow->diffInMilliseconds($clientCreatedAt, false)),
            'clock_skew_observed_at' => $serverNow->toIso8601String(),
        ]);

        if ($clientCreatedAt->greaterThan($serverNow)) {
            return $this->failed($op, 'future_dated_created_at');
        }

        if ($clientCreatedAt->lessThan($serverNow->copy()->subDays(self::CLOCK_WINDOW_DAYS))) {
            return $this->failed($op, 'created_at_outside_window');
        }

        return null;
    }

    private function applyCreate(array $op, string $table, string $membershipId, string $deviceId, string $orgId): array
    {
        $attributes = $this->buildAttributes($op, $table, $membershipId);

        try {
            // A caught QueryException leaves Postgres refusing every
            // further statement in the *current* transaction until a
            // ROLLBACK — including the lookups resolveSlotConflict() needs
            // to run next. Wrapping just this insert in its own nested
            // DB::transaction() makes Laravel issue a real SAVEPOINT
            // (transactionLevel() > 1 triggers this automatically) and
            // roll back to it on failure, so the outer transaction stays
            // usable afterward instead of staying aborted.
            DB::transaction(fn () => DB::table($table)->insert($attributes));
        } catch (QueryException $e) {
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }

            if (SyncableTables::isSlotTable($table)) {
                return $this->resolveSlotConflict($op, $table, $attributes, $membershipId, $deviceId, $orgId);
            }

            // Not a slot table: the only unique constraint is the primary
            // key itself — the entity_id this "create" names already has
            // a row. That is a conflict, not something to overwrite.
            return $this->rejected($op, 'conflict_already_exists');
        }

        $rev = (int) DB::table($table)->where('id', $op['entity_id'])->value('rev');
        $this->recordAcceptedWrite($op, $table, $rev, $membershipId, $deviceId, $orgId, before: null);

        return ['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => $rev];
    }

    private function applyUpdate(array $op, string $table, string $membershipId, string $deviceId, string $orgId): array
    {
        $before = DB::table($table)->where('id', $op['entity_id'])->first();
        $attributes = $this->buildAttributes($op, $table, $membershipId);
        unset($attributes['id']);

        $updated = DB::table($table)
            ->where('id', $op['entity_id'])
            ->where('rev', $op['base_rev'])
            ->update($attributes);

        if ($updated === 0) {
            // Either the row doesn't exist at all, or its rev has moved
            // on — both mean "what you thought was true about this row
            // no longer holds," the same edit-conflict family
            // (docs/sync-plan.md's Q5). Never distinguished further: that
            // distinction isn't useful to the client, only the fact that
            // its base_rev assumption was wrong.
            return $this->rejected($op, 'conflict_stale_rev');
        }

        $rev = (int) DB::table($table)->where('id', $op['entity_id'])->value('rev');
        $this->recordAcceptedWrite($op, $table, $rev, $membershipId, $deviceId, $orgId, before: $before);

        return ['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => $rev];
    }

    private function applyDelete(array $op, string $table, string $membershipId, string $deviceId, string $orgId): array
    {
        $before = DB::table($table)->where('id', $op['entity_id'])->first();

        $deleted = DB::table($table)
            ->where('id', $op['entity_id'])
            ->where('rev', $op['base_rev'])
            ->delete();

        if ($deleted === 0) {
            return $this->rejected($op, 'conflict_stale_rev');
        }

        $this->recordAcceptedWrite($op, $table, (int) $op['base_rev'], $membershipId, $deviceId, $orgId, before: $before);

        return ['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => (int) $op['base_rev']];
    }

    /**
     * A "create" that collides with an existing row on a slot's natural
     * key (not the primary key — a genuinely different entity_id) is
     * resolved per docs/sync-plan.md's Q5: the chronologically older
     * client `created_at` wins, regardless of arrival order. The
     * occupant's own original `created_at` is read from `sync_ledger`
     * (not the entity row itself — `day_state` has no `created_at` column
     * of its own, so the ledger is the one place every syncable table's
     * original op timestamp is guaranteed to be recorded).
     */
    private function resolveSlotConflict(array $op, string $table, array $attributes, string $membershipId, string $deviceId, string $orgId): array
    {
        foreach (SyncableTables::SLOT_CONSTRAINTS[$table] as $columns) {
            $values = [];

            foreach ($columns as $column) {
                if (! array_key_exists($column, $attributes) || $attributes[$column] === null) {
                    continue 2;
                }

                $values[$column] = $attributes[$column];
            }

            $existing = DB::table($table)->where($values)->first();

            if ($existing === null) {
                continue;
            }

            $existingOriginalOp = DB::table('sync_ledger')
                ->where('entity', $table)
                ->where('entity_id', $existing->id)
                ->orderBy('seq')
                ->first();

            $existingCreatedAt = $existingOriginalOp->client_created_at ?? null;

            // Compared as real instants, never as raw strings: Postgres
            // renders client_created_at back in its own textual format
            // ("2026-09-12 17:35:00+03"), not the client's original
            // ISO 8601 shape — a string comparison between the two would
            // not reliably reflect true chronological order.
            $incomingIsOlder = $existingCreatedAt !== null
                && Carbon::parse($op['created_at'])->lessThan(Carbon::parse($existingCreatedAt));

            if ($incomingIsOlder) {
                $this->evictSlotLoser($table, $existing);
                DB::table($table)->insert($attributes);

                $rev = (int) DB::table($table)->where('id', $op['entity_id'])->value('rev');
                $this->recordAcceptedWrite($op, $table, $rev, $membershipId, $deviceId, $orgId, before: null);

                return ['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => $rev];
            }

            return $this->rejected($op, 'conflict_slot_taken');
        }

        // Every constraint's key had a null component (so none of them
        // should have been able to collide) yet the insert still raised a
        // unique violation — something this method doesn't model. Treat
        // as unexpected rather than guessing.
        return $this->failed($op, 'internal_error');
    }

    /**
     * Displaces the losing occupant of a slot without deleting it or its
     * patient record (docs/sync-plan.md's Q7: "never silently deleted").
     * Uses only fields the web app already renders — no new status value
     * is introduced here, since that is a web-side decision out of scope
     * for this step. `day_state` has no equivalent "still exists, just
     * displaced" concept (it is a day's settings, not a booking), so the
     * loser is simply removed; the winning insert takes its place.
     */
    private function evictSlotLoser(string $table, object $existing): void
    {
        if ($table === 'day_state') {
            DB::table('day_state')->where('id', $existing->id)->delete();

            return;
        }

        if ($table === 'visits') {
            $maxPosition = (int) DB::table('visits')
                ->where('practitioner_id', $existing->practitioner_id)
                ->where('visit_date', $existing->visit_date)
                ->max('position');

            DB::table('visits')->where('id', $existing->id)->update([
                'is_overbooked' => true,
                'unique_scheduled_at' => null,
                'position' => $maxPosition + 1,
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function buildAttributes(array $op, string $table, string $membershipId): array
    {
        $attributes = array_merge($op['payload'] ?? [], ['id' => $op['entity_id']]);

        // "Who did this" is always the token's membership, never the
        // payload's — docs/sync-plan.md's Q12, extended from
        // audit_log.actor_membership_id to every table with an equivalent
        // column.
        $actorColumn = SyncableTables::actorColumn($table);

        if ($actorColumn !== null) {
            $attributes[$actorColumn] = $membershipId;
        }

        // rev is never accepted from a client under any name — the
        // enforce_row_rev() trigger (2026_09_12_000012_add_row_versioning.php)
        // overwrites it unconditionally regardless, but it is also simply
        // never placed in the attributes list to begin with.
        unset($attributes['rev']);

        return $attributes;
    }

    private function recordAcceptedWrite(array $op, string $table, int $rev, string $membershipId, string $deviceId, string $orgId, ?object $before): void
    {
        $now = now()->toIso8601String();

        DB::table('sync_ledger')->insert([
            'op_id' => $op['op_id'],
            'org_id' => $orgId,
            'entity' => $table,
            'entity_id' => $op['entity_id'],
            'rev' => $rev,
            'actor_membership_id' => $membershipId,
            'device_id' => $deviceId,
            'applied_at' => $now,
            'client_created_at' => $op['created_at'],
        ]);

        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'org_id' => $orgId,
            'actor_membership_id' => $membershipId,
            'entity' => $table,
            'entity_id' => $op['entity_id'],
            'action' => $op['action'],
            'before' => $before === null ? null : json_encode((array) $before),
            'after' => $op['action'] === 'delete' ? null : json_encode($op['payload']),
            'at' => $now,
        ]);
    }

    private function rejected(array $op, string $reason): array
    {
        return ['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => $reason];
    }

    private function failed(array $op, string $reason): array
    {
        return ['op_id' => $op['op_id'], 'status' => 'failed', 'reason' => $reason];
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        return $e->getCode() === '23505';
    }
}
