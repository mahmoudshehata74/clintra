import { canTransitionVisitStatus } from "../domain/transitions";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Visit } from "./types";
import { completeVisitWithInvoice, type CompleteVisitResult } from "./visitCompletion";

/**
 * Advances a visit to toStatus, validating the transition before writing
 * anything, stamping whatever extra fields that stage records (arrived_at,
 * started_at, ended_at). Shared by the three one-tap row actions below.
 * Returns the audit_log id — an opaque undo token, not a snapshot; the undo
 * path re-reads history from this id rather than trusting anything the
 * caller holds onto.
 */
async function advanceVisit(
  db: ClintraDatabase,
  visitId: string,
  toStatus: VisitStatus,
  extraFields: Partial<Visit>,
): Promise<string> {
  const before = await db.visits.get(visitId);
  if (!before) {
    throw new Error("visit_not_found");
  }
  if (!canTransitionVisitStatus(before.status, toStatus)) {
    throw new Error(`invalid_transition:${before.status}->${toStatus}`);
  }

  const actor = await resolveActingMembership(db);
  const after: Visit = { ...before, status: toStatus, ...extraFields };

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

/** The tap for a booked or confirmed row: the patient has arrived. */
export function markVisitArrived(db: ClintraDatabase, visitId: string): Promise<string> {
  return advanceVisit(db, visitId, VisitStatus.Arrived, { arrived_at: new Date().toISOString() });
}

/** The tap for an arrived row: the patient has gone in to see the practitioner. */
export function markVisitInRoom(db: ClintraDatabase, visitId: string): Promise<string> {
  return advanceVisit(db, visitId, VisitStatus.InRoom, { started_at: new Date().toISOString() });
}

/**
 * The tap for an in-room row: the consultation is done. Unlike the other two
 * advances above, this does not go through the generic advanceVisit — it
 * also creates the visit's invoice in the same transaction (see
 * db/visitCompletion.ts), so the one-tap contract stays "tap once, the
 * invoice appears as a consequence" rather than a separate step.
 */
export function markVisitCompleted(db: ClintraDatabase, visitId: string): Promise<CompleteVisitResult> {
  return completeVisitWithInvoice(db, visitId);
}
