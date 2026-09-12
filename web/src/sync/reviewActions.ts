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
}

/**
 * What to show the assistant before either action is offered. Never
 * itself mutates anything — read-only, safe to call on every render.
 */
export async function getReviewComparison(db: ClintraDatabase, review: SyncReview): Promise<ReviewComparison> {
  if (isCreateConflict(review)) {
    return { mine: review.payload, server: null, ready: true };
  }

  const table = resolveTable(db, review.entity);
  const currentLocal = await table.get(review.entity_id);
  const currentRev = (currentLocal as { rev?: number } | undefined)?.rev;
  const pulled = review.base_rev !== null && currentRev !== undefined && currentRev > review.base_rev;

  if (!pulled) {
    return { mine: review.payload, server: null, ready: false };
  }
  return { mine: review.payload, server: currentLocal ?? null, ready: true };
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
 * caller (the review sheet) must not offer this action before then.
 */
export async function keepMine(db: ClintraDatabase, reviewId: string): Promise<void> {
  const review = await db.sync_review.get(reviewId);
  if (!review) {
    return;
  }
  const actor = await resolveActingMembership(db);
  const table = resolveTable(db, review.entity);

  if (isCreateConflict(review)) {
    if (review.entity === "visits") {
      const current = await table.get(review.entity_id);
      if (current) {
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
 * Throws if called before `getReviewComparison` reports `ready`, same as
 * keepMine.
 */
export async function discardMine(db: ClintraDatabase, reviewId: string): Promise<void> {
  const review = await db.sync_review.get(reviewId);
  if (!review) {
    return;
  }

  if (isCreateConflict(review)) {
    const actor = await resolveActingMembership(db);
    const table = resolveTable(db, review.entity);
    const current = await table.get(review.entity_id);
    if (current) {
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
    }
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
