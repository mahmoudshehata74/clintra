import { canTransitionVisitStatus } from "../domain/transitions";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Visit } from "./types";

/**
 * Marks a visit arrived and stamps arrived_at, validating the transition
 * before writing anything. Returns the visit's state just before this call,
 * so the caller can offer an undo within the specification's five-minute
 * window by passing that snapshot to restoreVisitSnapshot.
 */
export async function markVisitArrived(db: ClintraDatabase, visitId: string): Promise<Visit> {
  const before = await db.visits.get(visitId);
  if (!before) {
    throw new Error("visit_not_found");
  }
  if (!canTransitionVisitStatus(before.status, VisitStatus.Arrived)) {
    throw new Error(`invalid_transition:${before.status}->${VisitStatus.Arrived}`);
  }

  const actor = await resolveActingMembership(db);
  const after: Visit = { ...before, status: VisitStatus.Arrived, arrived_at: new Date().toISOString() };

  await mutate(db, {
    table: db.visits,
    entity: "visits",
    entityId: visitId,
    action: AuditAction.Update,
    before,
    after,
    actorMembershipId: actor.id,
    orgId: before.org_id,
  });

  return before;
}

/**
 * Restores a visit to a prior snapshot — used to undo marking it arrived.
 * This is a compensating write, not a forward workflow transition, so it
 * intentionally does not go through canTransitionVisitStatus (which only
 * governs forward transitions in the status machine). It still goes through
 * the same audited mutation pipeline as any other write: this appends a new
 * audit_log and sync_ops row rather than erasing the ones the original
 * change produced, so the history of what happened is never deleted.
 */
export async function restoreVisitSnapshot(db: ClintraDatabase, snapshot: Visit): Promise<void> {
  const before = await db.visits.get(snapshot.id);
  if (!before) {
    throw new Error("visit_not_found");
  }

  const actor = await resolveActingMembership(db);

  await mutate(db, {
    table: db.visits,
    entity: "visits",
    entityId: snapshot.id,
    action: AuditAction.Update,
    before,
    after: snapshot,
    actorMembershipId: actor.id,
    orgId: snapshot.org_id,
  });
}
