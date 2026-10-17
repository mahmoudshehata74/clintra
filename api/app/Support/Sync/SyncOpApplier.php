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
     * @param  array{op_id: string, entity: string, entity_id: string, action: string, payload: ?array, created_at: string, base_rev: ?int}  $op
     * @return array{op_id: string, status: string, rev?: int, reason?: string}
     */
    public function apply(array $op, string $membershipId, string $deviceId): array
    {
        // An entity the server does not sync (a stuck device's `users` op,
        // say) is refused here, for this op alone — never by the request's
        // validation, which would fail the whole batch and leave the device's
        // other uploads stuck behind it. Checked before any query: the name
        // never reaches DB::table().
        if (! in_array($op['entity'], SyncableTables::NAMES, true)) {
            return $this->rejected($op, 'unknown_entity');
        }

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

        if ($op['action'] === 'create' && SyncableTables::hasNumberSeries($table)
            && ! $this->carriesDeviceSeries($op, $deviceId)) {
            return $this->rejected($op, 'series_mismatch');
        }

        if (! $this->claimsActorInOrg($op, $table, $currentOrgId)) {
            return $this->rejected($op, 'actor_not_in_org');
        }

        $op = $this->withStoredEmptyTitle($op, $table);
        $profileRule = $this->applyProfileRule($op, $table);

        if ($profileRule !== null) {
            return $profileRule;
        }

        $messageRule = $this->applyMessageRule($op, $table);

        if (isset($messageRule['status'])) {
            return $messageRule;
        }

        $op = $messageRule ?? $op;
        $templateRule = $this->applyTemplateRule($op, $table);

        if ($templateRule !== null) {
            return $templateRule;
        }

        $carePlanRule = $this->applyCarePlanRule($op, $table);

        if ($carePlanRule !== null) {
            return $carePlanRule;
        }

        $printedLock = $this->applyPrintedLock($op, $table);

        if ($printedLock !== null) {
            return $printedLock;
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

        if ($clientCreatedAt->lessThan($serverNow->copy()->subDays(SyncWindow::DAYS))) {
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
                return $this->resolveSlotConflict($op, $table, $attributes);
            }

            // invoices, payments and prescriptions carry a second unique
            // constraint besides the primary key: their number within a
            // device's series. series_mismatch above already refused a create
            // outside the pushing device's own series, so a device that
            // mints only in its own series can never hit this — but if one
            // ever does, the row it collided with is a *different* entity,
            // never "this entity_id already exists".
            if ($this->violatesNumberConstraint($e, $table)) {
                return $this->rejected($op, 'conflict_number_taken');
            }

            // A one-per-parent rule (a visit's one prescription): the row
            // it collided with is another entity holding the same parent.
            $parentReason = $this->parentUniqueReason($e, $table);

            if ($parentReason !== null) {
                return $this->rejected($op, $parentReason);
            }

            // Otherwise the violated constraint is the primary key: the
            // entity_id this "create" names already has a row. That is a
            // conflict, not something to overwrite.
            return $this->rejected($op, 'conflict_already_exists');
        }

        $rev = (int) DB::table($table)->where('id', $op['entity_id'])->value('rev');
        $this->recordAcceptedWrite($op, $table, $rev, $membershipId, $deviceId, $orgId, before: null);

        return ['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => $rev];
    }

    private function applyUpdate(array $op, string $table, string $membershipId, string $deviceId, string $orgId): array
    {
        $before = DB::table($table)->where('id', $op['entity_id'])->first();

        if ($before !== null && $this->changesNumber($op, $table, $before)) {
            return $this->rejected($op, 'number_immutable');
        }

        $attributes = $this->buildAttributes($op, $table, $membershipId);
        unset($attributes['id']);

        try {
            $updated = DB::table($table)
                ->where('id', $op['entity_id'])
                ->where('rev', $op['base_rev'])
                ->update($attributes);
        } catch (QueryException $e) {
            if ($this->isClosedDayViolation($e)) {
                return $this->rejected($op, 'conflict_day_closed');
            }

            throw $e;
        }

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

        try {
            $deleted = DB::table($table)
                ->where('id', $op['entity_id'])
                ->where('rev', $op['base_rev'])
                ->delete();
        } catch (QueryException $e) {
            if ($this->isClosedDayViolation($e)) {
                return $this->rejected($op, 'conflict_day_closed');
            }

            throw $e;
        }

        if ($deleted === 0) {
            return $this->rejected($op, 'conflict_stale_rev');
        }

        $this->recordAcceptedWrite($op, $table, (int) $op['base_rev'], $membershipId, $deviceId, $orgId, before: $before);

        return ['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => (int) $op['base_rev']];
    }

    /**
     * A "create" that collides with an existing row on a slot's natural
     * key (not the primary key — a genuinely different entity_id) always
     * loses, regardless of `created_at`. This endpoint accepts or rejects
     * the op in front of it — it never mutates a row it wasn't given
     * (see api/docs/rls.md's "The sync push endpoint is accept-or-reject
     * only" for the standing rule and why an earlier version of this
     * method violated it). The brief's "chronologically older wins" is
     * therefore honoured only when the older op happens to arrive first;
     * see docs/sync-plan.md's Q4/Q5 for the accepted cost of that and the
     * exact scenario it gives up.
     */
    private function resolveSlotConflict(array $op, string $table, array $attributes): array
    {
        foreach (SyncableTables::SLOT_CONSTRAINTS[$table] as $columns) {
            $values = [];

            foreach ($columns as $column) {
                if (! array_key_exists($column, $attributes) || $attributes[$column] === null) {
                    continue 2;
                }

                $values[$column] = $attributes[$column];
            }

            if (DB::table($table)->where($values)->exists()) {
                return $this->rejected($op, 'conflict_slot_taken');
            }
        }

        // Every constraint's key had a null component (so none of them
        // should have been able to collide) yet the insert still raised a
        // unique violation — something this method doesn't model. Treat
        // as unexpected rather than guessing.
        return $this->failed($op, 'internal_error');
    }

    /**
     * A create on a numbered table (invoices, payments, prescriptions) must
     * be minted in the pushing device's own series — the guarantee that two devices can
     * never mint the same number (docs/schema.md's v16 additions). The
     * device's series is read through device's own RLS policy (its own org
     * only), so the comparison can never reveal another org's device.
     */
    private function carriesDeviceSeries(array $op, string $deviceId): bool
    {
        $payloadSeries = ($op['payload'] ?? [])['series'] ?? null;

        return is_int($payloadSeries) && $payloadSeries === DeviceSeries::of($deviceId);
    }

    /**
     * A printed number never changes: an update that would alter a
     * numbered row's series or number columns is refused outright. A
     * column the payload leaves out is not a change (the update only ever
     * sets the columns it is given).
     */
    private function changesNumber(array $op, string $table, object $before): bool
    {
        $payload = $op['payload'] ?? [];

        foreach (SyncableTables::NUMBER_COLUMNS[$table] ?? [] as $column) {
            if (array_key_exists($column, $payload) && (string) $payload[$column] !== (string) $before->{$column}) {
                return true;
            }
        }

        return false;
    }

    /**
     * The printed lock (docs/schema.md's v17 additions): once a
     * prescription's printed_at is set, that prescription and its items
     * never change again.
     *
     * - A prescription that is already printed refuses every delete, and
     *   every update that would change any column it names — including
     *   clearing or changing printed_at or diagnosis — as
     *   `prescription_printed`. The push that first sets printed_at finds
     *   the row unprinted and goes through normally.
     * - An update to an already-printed prescription that changes nothing
     *   (a second device re-sending the same print, for instance) is
     *   `accepted` as a no-op: nothing is written — no rev bump, no ledger
     *   or audit row — and the result carries the row's current rev. The
     *   actor column (created_by) is left out of the comparison: it says
     *   who acted, not what the prescription holds, and a no-op writes
     *   nothing, so the stored creator stays.
     * - A prescription_items create, update or delete is refused as
     *   `prescription_printed` when its parent is printed — the parent the
     *   payload names and, for an update or delete, the parent the row
     *   currently has.
     *
     * The parent row is read FOR UPDATE, so an item write and a concurrent
     * first print of the same prescription are serialised: whichever
     * commits second sees the other's result. Every read goes through the
     * table's own RLS policy; a row the caller cannot see is simply not
     * locked here, and the write itself then fails exactly as it would
     * without this check.
     *
     * @return array{op_id: string, status: string, rev?: int, reason?: string}|null null means the op is not affected by the lock.
     */
    private function applyPrintedLock(array $op, string $table): ?array
    {
        if (in_array($table, SyncableTables::PRINTED_LOCK_TABLES, true) && $op['action'] !== 'create') {
            $current = DB::table($table)->where('id', $op['entity_id'])->lockForUpdate()->first();

            if ($current === null || $current->printed_at === null) {
                return null;
            }

            if ($op['action'] === 'delete' || ! $this->leavesRowUnchanged($op, $table, $current)) {
                return $this->rejected($op, 'prescription_printed');
            }

            return ['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => (int) $current->rev];
        }

        $child = SyncableTables::PRINTED_LOCK_CHILDREN[$table] ?? null;

        if ($child === null) {
            return null;
        }

        [$parentTable, $parentColumn] = $child;
        $parentIds = [];

        if ($op['action'] !== 'delete' && isset(($op['payload'] ?? [])[$parentColumn])) {
            $parentIds[] = $op['payload'][$parentColumn];
        }

        if ($op['action'] !== 'create') {
            $currentParentId = DB::table($table)->where('id', $op['entity_id'])->value($parentColumn);

            if ($currentParentId !== null) {
                $parentIds[] = $currentParentId;
            }
        }

        foreach (array_unique($parentIds) as $parentId) {
            $printedAt = DB::table($parentTable)->where('id', $parentId)->lockForUpdate()->value('printed_at');

            if ($printedAt !== null) {
                return $this->rejected($op, 'prescription_printed');
            }
        }

        return null;
    }

    /**
     * The practitioner profile rule (docs/schema.md's v18 additions):
     * practitioners are created only by provisioning, so a pushed create or
     * delete is refused as `practitioner_not_editable`, and an update may
     * change only full_name, title and syndicate_number — any other column
     * the payload names with a value different from the stored one is
     * refused the same way (a column carried unchanged, as a device's whole
     * row is, is fine). The profile itself is validated as the device
     * validates it: full_name is not empty once trimmed, title is a string
     * ("" is no title; the column is NOT NULL — see withStoredEmptyTitle),
     * and syndicate_number is null or at most 50 characters
     * (`practitioner_profile_invalid`).
     *
     * Who may edit — the owner — is enforced on the device only, like every
     * other settings write (api/docs/rls.md's "Practitioners"). The row is
     * read through practitioners' own policy; one the caller cannot see is
     * left to the update itself, which then matches nothing
     * (`conflict_stale_rev`).
     *
     * @return array{op_id: string, status: string, reason: string}|null null means the op is not affected by the rule.
     */
    private function applyProfileRule(array $op, string $table): ?array
    {
        $editable = SyncableTables::PROFILE_ONLY_COLUMNS[$table] ?? null;

        if ($editable === null) {
            return null;
        }

        if ($op['action'] !== 'update') {
            return $this->rejected($op, 'practitioner_not_editable');
        }

        $payload = $op['payload'] ?? [];
        $current = DB::table($table)->where('id', $op['entity_id'])->first();

        if ($current !== null) {
            foreach ($payload as $column => $incoming) {
                if ($column === 'id' || $column === 'rev' || in_array($column, $editable, true)) {
                    continue;
                }

                if (! property_exists($current, $column) || ! $this->sameValue($incoming, $current->{$column})) {
                    return $this->rejected($op, 'practitioner_not_editable');
                }
            }
        }

        $isValid = (! array_key_exists('full_name', $payload)
                || (is_string($payload['full_name']) && trim($payload['full_name']) !== ''))
            && (! array_key_exists('title', $payload) || is_string($payload['title']))
            && (($payload['syndicate_number'] ?? null) === null
                || (is_string($payload['syndicate_number']) && mb_strlen($payload['syndicate_number']) <= 50));

        return $isValid ? null : $this->rejected($op, 'practitioner_profile_invalid');
    }

    /**
     * The message rule (docs/schema.md's v19 additions): a message is written
     * once, when the device opens WhatsApp or SMS for it, and only
     * `marked_sent_at` may change afterwards (SyncableTables::APPEND_ONLY_COLUMNS).
     *
     * - A delete is refused as `message_immutable`: messages are never deleted.
     * - An update whose payload names any other column with a value different
     *   from the stored one is refused as `message_immutable` (a column
     *   carried unchanged, as a device's whole row is, is fine; timestamps
     *   compare as instants; the actor column is left out of the comparison,
     *   as in leavesRowUnchanged, since an update never writes it). An
     *   accepted update is narrowed to the allowed
     *   columns, so it writes `marked_sent_at` and nothing else — not even the
     *   actor column, which stays the creator's (buildAttributes).
     *   `marked_sent_at` must be null or a timestamp (`message_invalid`).
     * - A create is validated as the device validates it (`message_invalid`):
     *   a known template key, a channel of whatsapp or sms, an E.164 phone, a
     *   timestamp attempted_at, and a body that is a string not empty once
     *   trimmed. The request pipeline delivers a pushed "" as null (Laravel's
     *   global ConvertEmptyStringsToNull middleware), so an empty body arrives
     *   as null and is refused here — never stored, and never left to the NOT
     *   NULL column to surface as an internal_error.
     *
     * The row is read through messages' own policy; one the caller cannot see
     * is left to the update itself, which then matches nothing
     * (`conflict_stale_rev`).
     *
     * @return array<string, mixed>|null null when the op is not a message op;
     *                                   a result (it carries `status`) when it is refused;
     *                                   otherwise the op to apply, narrowed for an update.
     */
    private function applyMessageRule(array $op, string $table): ?array
    {
        $editable = SyncableTables::APPEND_ONLY_COLUMNS[$table] ?? null;

        if ($editable === null) {
            return null;
        }

        if ($op['action'] === 'delete') {
            return $this->rejected($op, 'message_immutable');
        }

        $payload = $op['payload'] ?? [];

        if ($op['action'] === 'create') {
            return $this->isValidMessage($payload) ? $op : $this->rejected($op, 'message_invalid');
        }

        $current = DB::table($table)->where('id', $op['entity_id'])->first();
        $actorColumn = SyncableTables::actorColumn($table);

        if ($current !== null) {
            foreach ($payload as $column => $incoming) {
                if ($column === 'id' || $column === 'rev' || $column === $actorColumn || in_array($column, $editable, true)) {
                    continue;
                }

                if (! property_exists($current, $column) || ! $this->sameColumnValue($column, $incoming, $current->{$column})) {
                    return $this->rejected($op, 'message_immutable');
                }
            }
        }

        $markedSentAt = $payload['marked_sent_at'] ?? null;

        if ($markedSentAt !== null && ! $this->isTimestamp($markedSentAt)) {
            return $this->rejected($op, 'message_invalid');
        }

        $op['payload'] = array_intersect_key($payload, array_flip($editable));

        return $op;
    }

    /** @param  array<string, mixed>  $payload */
    private function isValidMessage(array $payload): bool
    {
        $body = $payload['body'] ?? null;
        $phone = $payload['phone'] ?? null;
        $markedSentAt = $payload['marked_sent_at'] ?? null;

        return in_array($payload['template_key'] ?? null, SyncableTables::MESSAGE_TEMPLATE_KEYS, true)
            && in_array($payload['channel'] ?? null, ['whatsapp', 'sms'], true)
            && is_string($phone) && preg_match('/^\+[1-9]\d{7,14}$/', $phone) === 1
            && is_string($body) && trim($body) !== ''
            && $this->isTimestamp($payload['attempted_at'] ?? null)
            && ($markedSentAt === null || $this->isTimestamp($markedSentAt));
    }

    /**
     * The template override rule (docs/schema.md's v19 additions): an
     * organization's edited body for one of the five editable keys may be
     * created, updated and deleted ("reset to default" deletes it). A create
     * or update is refused as `template_invalid` unless its key is one of
     * SyncableTables::EDITABLE_TEMPLATE_KEYS ("custom" has no override) and
     * its body is a string, not empty once trimmed and at most 4000
     * characters. An empty body arrives as null (ConvertEmptyStringsToNull,
     * as for messages) and is refused, never stored.
     *
     * Who may edit — the owner — is enforced on the device only, like every
     * other settings write (api/docs/rls.md's "Messages and message templates").
     *
     * @return array{op_id: string, status: string, reason: string}|null null means the op is not affected by the rule.
     */
    private function applyTemplateRule(array $op, string $table): ?array
    {
        if ($table !== 'message_templates' || $op['action'] === 'delete') {
            return null;
        }

        $payload = $op['payload'] ?? [];
        $body = $payload['body'] ?? null;

        $isValid = in_array($payload['key'] ?? null, SyncableTables::EDITABLE_TEMPLATE_KEYS, true)
            && is_string($body) && trim($body) !== ''
            && mb_strlen($body) <= SyncableTables::TEMPLATE_BODY_MAX_LENGTH;

        return $isValid ? null : $this->rejected($op, 'template_invalid');
    }

    /**
     * The care plan rule (docs/schema.md's v20 additions). Plans and their
     * sessions are never deleted, a session never changes plan, service or
     * place, and only what the device stores is accepted:
     *
     * - A delete of either table is refused as `care_plan_immutable`.
     * - A care_plan_items update whose payload changes care_plan_id,
     *   service_id or sequence from the stored value is refused as
     *   `care_plan_immutable` (a column carried unchanged, as a device's whole
     *   row is, is fine).
     * - A status outside its table's set (plans: active, stopped; sessions:
     *   planned, skipped), on a create or wherever an update names one, is
     *   `care_plan_invalid`; so is a care_plans.paid other than 0 — a plan's
     *   paid amount is derived on the device from the payments on its
     *   sessions' invoices, and the column is never written with anything
     *   else.
     * - A session's visit_id, when not null, must name a visit of the plan's
     *   own patient and practitioner (`care_plan_invalid`). The visit and the
     *   plan are read through their own policies: a visit the caller cannot
     *   see is refused the same way; a plan the caller cannot see (or a row it
     *   cannot see, on an update) is left to the write itself, which then
     *   fails or matches nothing exactly as it would without this rule.
     *
     * Who writes — only the plan's own practitioner — is enforced on the
     * device only, the same known gap as prescriptions (api/docs/rls.md's
     * "Care plans").
     *
     * @return array{op_id: string, status: string, reason: string}|null null means the op passes the rule.
     */
    private function applyCarePlanRule(array $op, string $table): ?array
    {
        if (! SyncableTables::isCarePlanTable($table)) {
            return null;
        }

        if ($op['action'] === 'delete') {
            return $this->rejected($op, 'care_plan_immutable');
        }

        $payload = $op['payload'] ?? [];
        $current = $op['action'] === 'update' ? DB::table($table)->where('id', $op['entity_id'])->first() : null;

        if ($op['action'] === 'update' && $current === null) {
            return null;
        }

        if ($current !== null && $table === 'care_plan_items') {
            foreach (SyncableTables::CARE_PLAN_ITEM_FIXED_COLUMNS as $column) {
                if (array_key_exists($column, $payload) && ! $this->sameValue($payload[$column], $current->{$column})) {
                    return $this->rejected($op, 'care_plan_immutable');
                }
            }
        }

        if (($op['action'] === 'create' || array_key_exists('status', $payload))
            && ! in_array($payload['status'] ?? null, SyncableTables::CARE_PLAN_STATUSES[$table], true)) {
            return $this->rejected($op, 'care_plan_invalid');
        }

        if ($table === 'care_plans') {
            $paidIsZero = array_key_exists('paid', $payload) ? $payload['paid'] === 0 : $op['action'] === 'update';

            return $paidIsZero ? null : $this->rejected($op, 'care_plan_invalid');
        }

        $visitId = $payload['visit_id'] ?? null;

        if ($visitId === null) {
            return null;
        }

        $plan = DB::table('care_plans')->where('id', $current->care_plan_id ?? $payload['care_plan_id'] ?? null)->first();

        if ($plan === null) {
            return null;
        }

        $visit = is_string($visitId) ? DB::table('visits')->where('id', $visitId)->first() : null;

        return $visit !== null && $visit->patient_id === $plan->patient_id && $visit->practitioner_id === $plan->practitioner_id
            ? null
            : $this->rejected($op, 'care_plan_invalid');
    }

    private function isTimestamp(mixed $value): bool
    {
        if (! is_string($value) || trim($value) === '') {
            return false;
        }

        try {
            Carbon::parse($value);
        } catch (Throwable) {
            return false;
        }

        return true;
    }

    /** A payload value against a stored one, comparing timestamp columns as instants (as leavesRowUnchanged does). */
    private function sameColumnValue(string $column, mixed $incoming, mixed $stored): bool
    {
        if ($incoming !== null && $stored !== null && str_ends_with($column, '_at') && $this->isTimestamp($incoming)) {
            return Carbon::parse($incoming)->equalTo(Carbon::parse($stored));
        }

        return $this->sameValue($incoming, $stored);
    }

    /**
     * A practitioner's title is NOT NULL, and "" means "no title"
     * (docs/schema.md's v18 additions). The request pipeline turns every
     * empty string in a pushed payload into null (Laravel's global
     * ConvertEmptyStringsToNull middleware), so the "" a device sends for no
     * title arrives as null; it is stored as "" again. Every other table's
     * payload is left as it arrives.
     */
    private function withStoredEmptyTitle(array $op, string $table): array
    {
        if ($table === 'practitioners' && is_array($op['payload'] ?? null)
            && array_key_exists('title', $op['payload']) && $op['payload']['title'] === null) {
            $op['payload']['title'] = '';
        }

        return $op;
    }

    /** A payload value against a stored one: null only equals null; booleans and numbers compare as Postgres returns them. */
    private function sameValue(mixed $incoming, mixed $stored): bool
    {
        if ($incoming === null || $stored === null) {
            return $incoming === $stored;
        }

        if (is_array($incoming)) {
            return false;
        }

        return (string) $incoming === (string) $stored;
    }

    /**
     * True when every column the update names already holds that value.
     * Timestamps are compared as instants: a payload's ISO 8601 string and
     * Postgres' own rendering of the same moment differ as text.
     */
    private function leavesRowUnchanged(array $op, string $table, object $current): bool
    {
        $actorColumn = SyncableTables::actorColumn($table);

        foreach ($op['payload'] ?? [] as $column => $incoming) {
            if ($column === 'id' || $column === 'rev' || $column === $actorColumn) {
                continue;
            }

            if (! property_exists($current, $column)) {
                return false;
            }

            $stored = $current->{$column};

            if ($incoming === null || $stored === null) {
                if ($incoming !== $stored) {
                    return false;
                }

                continue;
            }

            if (is_array($incoming)) {
                return false;
            }

            $same = str_ends_with($column, '_at')
                ? Carbon::parse($incoming)->equalTo(Carbon::parse($stored))
                : (string) $incoming === (string) $stored;

            if (! $same) {
                return false;
            }
        }

        return true;
    }

    private function parentUniqueReason(QueryException $e, string $table): ?string
    {
        foreach (SyncableTables::PARENT_UNIQUE_CONSTRAINTS[$table] ?? [] as $constraint => $reason) {
            if (str_contains($e->getMessage(), "\"{$constraint}\"")) {
                return $reason;
            }
        }

        return null;
    }

    private function violatesNumberConstraint(QueryException $e, string $table): bool
    {
        $constraint = SyncableTables::NUMBER_CONSTRAINTS[$table] ?? null;

        return $constraint !== null && str_contains($e->getMessage(), "\"{$constraint}\"");
    }

    /**
     * The actor column's claim (SyncableTables::ACTOR_COLUMNS): the person
     * signed in on the device, which the token cannot tell — every device's
     * token carries the owner who registered it. A claim is accepted when it
     * names a membership of the token's own organization, active or not (a
     * row written offline before a deactivation must still go up), the same
     * rule as device audit rows (docs/audit-sync.md's decision 2). A claim
     * that is not one — another organization's membership, a membership that
     * does not exist, anything but a uuid — is refused as `actor_not_in_org`.
     * An absent or null claim is not checked: buildAttributes falls back to
     * the token's membership.
     *
     * Attribution only: no permission check reads the claim — every one
     * stays on the token's membership (the RLS policies' current_membership(),
     * the ledger and the server's own audit_log). A device with a stolen
     * token could name any staff member of its organization; server-side
     * per-person identity (the backlog) closes that (api/docs/rls.md's
     * "Actor attribution").
     *
     * Not checked where the column is not written: a delete, and an update
     * of an append-only row (it keeps its creator).
     */
    private function claimsActorInOrg(array $op, string $table, string $orgId): bool
    {
        $actorColumn = SyncableTables::actorColumn($table);

        if ($actorColumn === null || $op['action'] === 'delete' || $this->keepsCreator($op, $table)) {
            return true;
        }

        $claim = ($op['payload'] ?? [])[$actorColumn] ?? null;

        if ($claim === null) {
            return true;
        }

        // Read through memberships' own policy (the caller's organization
        // only), with the organization named as well; a non-uuid never
        // reaches the uuid column.
        return is_string($claim) && Str::isUuid($claim)
            && DB::table('memberships')->where('id', $claim)->where('org_id', $orgId)->exists();
    }

    /** An append-only row's actor column is its creator's: an update there (a message marked sent) leaves it alone. */
    private function keepsCreator(array $op, string $table): bool
    {
        return $op['action'] === 'update' && array_key_exists($table, SyncableTables::APPEND_ONLY_COLUMNS);
    }

    /**
     * @return array<string, mixed>
     */
    private function buildAttributes(array $op, string $table, string $membershipId): array
    {
        $attributes = array_merge($op['payload'] ?? [], ['id' => $op['entity_id']]);

        // "Who did this" is the device's claim, already held to the token's
        // organization (claimsActorInOrg); without one, the token's
        // membership. sync_ledger and audit_log keep the token's membership
        // regardless (recordAcceptedWrite).
        $actorColumn = SyncableTables::actorColumn($table);

        if ($actorColumn !== null && ! $this->keepsCreator($op, $table)) {
            $attributes[$actorColumn] = $attributes[$actorColumn] ?? $membershipId;
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

    /**
     * SQLSTATE 55000 (object_not_in_prerequisite_state) is what
     * prevent_closed_day_state_mutation() raises
     * (2026_09_12_000018_lock_closed_day_state.php) — a real Postgres
     * error class matching this case: the operation itself is otherwise
     * valid, the object's current state just doesn't allow it. Distinct
     * from a generic `internal_error`, since this is a genuine business
     * conflict a client's own assumptions could reasonably have avoided,
     * not a bug.
     */
    private function isClosedDayViolation(QueryException $e): bool
    {
        return $e->getCode() === '55000';
    }
}
