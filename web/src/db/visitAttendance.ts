import { canTransitionVisitStatus } from "../domain/transitions";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Visit } from "./types";

/**
 * Marks a visit arrived and stamps arrived_at, validating the transition
 * before writing anything. Returns the id of the audit_log row this call
 * wrote — an opaque token to pass to undoMostRecentVisitMutation if the user
 * asks to undo it. It is not a snapshot: the undo path re-reads history from
 * this id rather than trusting anything the caller holds onto.
 */
export async function markVisitArrived(db: ClintraDatabase, visitId: string): Promise<string> {
  const before = await db.visits.get(visitId);
  if (!before) {
    throw new Error("visit_not_found");
  }
  if (!canTransitionVisitStatus(before.status, VisitStatus.Arrived)) {
    throw new Error(`invalid_transition:${before.status}->${VisitStatus.Arrived}`);
  }

  const actor = await resolveActingMembership(db);
  const after: Visit = { ...before, status: VisitStatus.Arrived, arrived_at: new Date().toISOString() };

  return mutate(db, {
    table: db.visits,
    entity: "visits",
    entityId: visitId,
    action: AuditAction.Update,
    before,
    after,
    actorMembershipId: actor.id,
    orgId: before.org_id,
  });
}
