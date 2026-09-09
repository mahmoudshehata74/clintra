import type { ClintraDatabase } from "../db/database";

/**
 * Both actions the needs-review list currently offers ("خليها كده" and
 * "شيلها") dismiss the review row the same way: it is kept for history, not
 * deleted, but stops counting as open, so it stops driving the status chip
 * and stops being excluded from the engine's resend set. If the underlying
 * conflict was never actually resolved, the same op can surface a new review
 * row on a later sync cycle — designing that resolution flow is a later
 * task; this only wires the plumbing.
 */
export async function dismissSyncReview(db: ClintraDatabase, reviewId: string): Promise<void> {
  await db.sync_review.update(reviewId, { needs_review: false });
}
