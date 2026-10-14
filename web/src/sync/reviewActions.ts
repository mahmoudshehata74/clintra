import type { Table } from "dexie";
import { resolveActingMembership } from "../db/actingMembership";
import type { ClintraDatabase } from "../db/database";
import { mutate } from "../db/mutate";
import { AuditAction, type SyncReview } from "../db/types";
import { CancelReason, VisitStatus } from "../domain/visitStatus";

/** Same reasoning as engine.ts's own resolveTable/tableForEntity: ask the database itself, never a second hand-maintained list. */
function resolveTable(db: ClintraDatabase, entity: string): Table<unknown, string> {
  try {
    return db.table(entity) as Table<unknown, string>;
  } catch {
    throw new Error(`review_actions_unknown_entity:${entity}`);
  }
}

/**
 * A rejected `create` (docs/sync-plan.md's Q7 — a slot or unique-key
 * collision) has no server row under this `entity_id` to compare against
 * at all; the loser's `entity_id` never existed server-side. Every other
 * rejection reason (`conflict_stale_rev`, `conflict_day_closed`) is an
 * `update`/`delete` against a row that does exist server-side, and is
 * potentially rebasable.
 */
function isCreateConflict(review: SyncReview): boolean {
  return review.action === AuditAction.Create;
}

/**
 * Thrown by keepMine/discardMine on a create conflict whose local row no
 * longer exists — a pull displaced it (sync/pullCollisions.ts), which also
 * closed this review and folded it into the displacement's own row. There
 * is no version of mine left to keep or remove; getReviewComparison reports
 * `rowGone`, and the review sheet never offers either action then.
 */
export const REVIEW_ROW_GONE = "review_row_gone";

async function assertCreateConflictRowExists(db: ClintraDatabase, review: SyncReview): Promise<void> {
  if (isCreateConflict(review) && (await resolveTable(db, review.entity).get(review.entity_id)) === undefined) {
    throw new Error(REVIEW_ROW_GONE);
  }
}

export interface ReviewComparison {
  /** The rejected op's own payload — what the assistant was trying to do. */
  mine: unknown;
  /**
   * The server's current row, or null when there either isn't one under
   * this entity_id (a create conflict — Q7) or it hasn't arrived yet
   * (an edit conflict still waiting on a pull; see `ready`).
   */
  server: unknown | null;
  /**
   * False only for an edit conflict (`conflict_stale_rev`/`conflict_day_closed`)
   * whose local row has not yet been updated by a pull past the rejected
   * op's own `base_rev` — until then this device has no way to show the
   * server's actual current version, and neither action below is safe to
   * offer (docs/sync-plan.md's Q6: "the assistant must see what she is
   * choosing between before choosing"). Always true for a create
   * conflict — there is nothing to wait for.
   */
  ready: boolean;
  /**
   * True for a create conflict whose local row no longer exists (see
   * REVIEW_ROW_GONE): neither keepMine nor discardMine may be offered.
   */
  rowGone: boolean;
}

/**
 * What to show the assistant before either action is offered. Never
 * itself mutates anything — read-only, safe to call on every render.
 */
export async function getReviewComparison(db: ClintraDatabase, review: SyncReview): Promise<ReviewComparison> {
  if (isCreateConflict(review)) {
    const current = await resolveTable(db, review.entity).get(review.entity_id);
    const rowGone = current === undefined;
    return { mine: review.payload, server: null, ready: !rowGone, rowGone };
  }

  const table = resolveTable(db, review.entity);
  const currentLocal = await table.get(review.entity_id);
  const currentRev = (currentLocal as { rev?: number } | undefined)?.rev;
  const pulled = review.base_rev !== null && currentRev !== undefined && currentRev > review.base_rev;

  if (!pulled) {
    return { mine: review.payload, server: null, ready: false, rowGone: false };
  }
  return { mine: review.payload, server: currentLocal ?? null, ready: true, rowGone: false };
}

async function closeReview(db: ClintraDatabase, review: SyncReview): Promise<void> {
  await db.sync_ops.delete(review.op_id);
  await db.sync_review.update(review.id, { needs_review: false });
}

/**
 * For a create-conflict's own resolution specifically: mutate() itself
 * queues a brand new op for the local write keepMine/discardMine just
 * made (the cancellation, or the delete) — on top of that, this
 * entity_id's original `create` never existed server-side and never
 * will, so ANY further op naming it (including that fresh one) would
 * only ever come back `conflict_stale_rev` forever, since there is no
 * server row under this id to update or delete. getReviewComparison
 * would then report that follow-up review as permanently not-ready — a
 * pull can never bring in a version of a row that was never created.
 * Every still-unsent op for this entity_id is therefore dropped, not
 * just the original stale one: this id's story with the server ends
 * here, by the assistant's own deliberate choice.
 */
async function closeReviewAndDropEntityHistory(db: ClintraDatabase, review: SyncReview): Promise<void> {
  const allOps = await db.sync_ops.toArray();
  const unsentForEntity = allOps.filter((op) => op.entity_id === review.entity_id && op.synced_at === null);
  await Promise.all(unsentForEntity.map((op) => db.sync_ops.delete(op.op_id)));
  await db.sync_review.update(review.id, { needs_review: false });
}

/**
 * "تمام" on a displaced_by_server row (sync/pullCollisions.ts): the server's
 * version has already replaced the local one, and the displaced row's queued
 * ops are already gone, so the only thing left is to close the row.
 */
export async function acknowledgeReview(db: ClintraDatabase, reviewId: string): Promise<void> {
  await db.sync_review.update(reviewId, { needs_review: false });
}

/**
 * "خليها كده" (keep mine) — docs/sync-plan.md's Q6/Q7. What this means
 * depends entirely on why the op was rejected:
 *
 * - A slot/unique-key collision (`create` rejected): the patient's record
 *   must survive, and the slot must stop looking confirmed (Q7's own
 *   wording) — the local row already holds "mine" from the original
 *   optimistic write, so this only changes a `visits` row's status to
 *   `cancelled`/`sync_conflict` (freeing the slot, per
 *   domain/visitStatus.ts's `occupiesSlot`) and drops the now-pointless
 *   queued op, since resending an op for a slot that is permanently
 *   someone else's would just be rejected again.
 * - `conflict_day_closed`: a permanent state block, not a rev problem —
 *   resending would fail identically every time. "Keep mine" here can
 *   only mean "stop trying"; the local row is left exactly as it is.
 * - `conflict_stale_rev`: a genuine rebase. The assistant's own payload
 *   is written over the server's now-known current row (`ready` must be
 *   true — see getReviewComparison), and a fresh op is queued with
 *   `base_rev` set to that row's real current `rev`, so the resend
 *   actually succeeds instead of failing the identical way again.
 *
 * Throws if called before `getReviewComparison` reports `ready` — the
 * caller (the review sheet) must not offer this action before then — and
 * REVIEW_ROW_GONE on a create conflict whose local row a pull displaced.
 */
export async function keepMine(db: ClintraDatabase, reviewId: string): Promise<void> {
  const review = await db.sync_review.get(reviewId);
  if (!review) {
    return;
  }
  await assertCreateConflictRowExists(db, review);
  const actor = await resolveActingMembership(db);
  const table = resolveTable(db, review.entity);

  if (isCreateConflict(review)) {
    const current = await table.get(review.entity_id);
    if (review.entity === "visits") {
      const after = { ...(current as object), status: VisitStatus.Cancelled, cancel_reason: CancelReason.SyncConflict };
      await mutate(db, {
        table,
        entity: review.entity,
        entityId: review.entity_id,
        action: AuditAction.Update,
        before: current,
        after,
        actorMembershipId: actor.id,
        orgId: actor.org_id,
      });
    }
    await closeReviewAndDropEntityHistory(db, review);
    return;
  }

  if (review.reason === "conflict_day_closed") {
    await closeReview(db, review);
    return;
  }

  // conflict_stale_rev: rebase onto the server's now-known current row.
  const comparison = await getReviewComparison(db, review);
  if (!comparison.ready) {
    throw new Error("review_not_ready_to_keep_mine");
  }

  const currentLocal = await table.get(review.entity_id);
  if (!currentLocal) {
    // The server deleted this row entirely since the rejection — nothing
    // to rebase onto; recreate it fresh instead.
    await mutate(db, {
      table,
      entity: review.entity,
      entityId: review.entity_id,
      action: AuditAction.Create,
      before: null,
      after: review.payload,
      actorMembershipId: actor.id,
      orgId: actor.org_id,
    });
    await closeReview(db, review);
    return;
  }

  const rebasedAfter =
    review.action === AuditAction.Delete
      ? null
      : { ...(review.payload as object), rev: (currentLocal as { rev: number }).rev };

  await mutate(db, {
    table,
    entity: review.entity,
    entityId: review.entity_id,
    action: review.action,
    before: currentLocal,
    after: rebasedAfter,
    actorMembershipId: actor.id,
    orgId: actor.org_id,
  });
  await closeReview(db, review);
}

/**
 * "شيلها" (discard mine) — docs/sync-plan.md's Q6/Q7. The counterpart to
 * keepMine, symmetric per rejection reason:
 *
 * - A slot/unique-key collision (`create` rejected): my row never existed
 *   server-side at all — there is nothing to overwrite it *with*, so it
 *   is simply removed. The winner's own visit is whatever the day grid
 *   already shows (or will, once pulled) under that slot.
 * - `conflict_stale_rev`/`conflict_day_closed`: the local row, once a
 *   pull has updated it, already holds the server's current version —
 *   engine.ts's runPullCycle applies every pulled change directly to its
 *   local table. Nothing to write; this only drops the now-pointless
 *   queued op.
 *
 * Throws if called before `getReviewComparison` reports `ready`, and
 * REVIEW_ROW_GONE when the create conflict's local row is gone, same as
 * keepMine.
 */
export async function discardMine(db: ClintraDatabase, reviewId: string): Promise<void> {
  const review = await db.sync_review.get(reviewId);
  if (!review) {
    return;
  }
  await assertCreateConflictRowExists(db, review);

  if (isCreateConflict(review)) {
    const actor = await resolveActingMembership(db);
    const table = resolveTable(db, review.entity);
    const current = await table.get(review.entity_id);
    await mutate(db, {
      table,
      entity: review.entity,
      entityId: review.entity_id,
      action: AuditAction.Delete,
      before: current,
      after: null,
      actorMembershipId: actor.id,
      orgId: actor.org_id,
    });
    await closeReviewAndDropEntityHistory(db, review);
    return;
  }

  const comparison = await getReviewComparison(db, review);
  if (!comparison.ready) {
    throw new Error("review_not_ready_to_discard_mine");
  }

  // The local row already is the server's version (applied by the pull
  // that made this ready) — nothing left to do but stop resending mine.
  await closeReview(db, review);
}
