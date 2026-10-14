import { canTransitionVisitStatus } from "../domain/transitions";
import { CancelReason, VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import { clearSessionLinks, sessionLinkTables } from "./carePlans";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, type Visit } from "./types";

/** The only two reasons the overflow menu's cancel prompt offers — no free-text. */
export type VisitCancelReason = typeof CancelReason.Patient | typeof CancelReason.Clinic;

/**
 * Cancels a visit with the given reason, writing status and cancel_reason
 * together in the same mutate() call — cancelling without a reason, or a
 * reason without the status change, would both be defects. Frees the slot:
 * cancelled no longer occupies it (see domain/visitStatus.ts's occupiesSlot),
 * so the row keeps showing the patient name with the "still free" hint.
 * A care plan session the visit booked is unlinked in the same transaction
 * and becomes suggested again (db/carePlans.ts's clearSessionLinks). Returns
 * the visit write's audit_log id.
 */
export async function cancelVisit(
  db: ClintraDatabase,
  visitId: string,
  reason: VisitCancelReason,
): Promise<string> {
  const before = await db.visits.get(visitId);
  if (!before) {
    throw new Error("visit_not_found");
  }
  if (!canTransitionVisitStatus(before.status, VisitStatus.Cancelled)) {
    throw new Error(`invalid_transition:${before.status}->${VisitStatus.Cancelled}`);
  }

  const actor = await resolveActingMembership(db);
  const after: Visit = { ...before, status: VisitStatus.Cancelled, cancel_reason: reason };

  return writeFreedVisit(db, before, after, actor.id);
}

/**
 * Marks a visit a no-show: one tap, no confirmation, no free-text reason.
 * Writes status and cancel_reason together, same as cancelVisit — no_show is
 * its own status, never merged with cancelled, but shares the cancel_reason
 * field to record why the slot is free again. A care plan session the visit
 * booked is unlinked in the same transaction, as for cancelVisit.
 */
export async function markVisitNoShow(db: ClintraDatabase, visitId: string): Promise<string> {
  const before = await db.visits.get(visitId);
  if (!before) {
    throw new Error("visit_not_found");
  }
  if (!canTransitionVisitStatus(before.status, VisitStatus.NoShow)) {
    throw new Error(`invalid_transition:${before.status}->${VisitStatus.NoShow}`);
  }

  const actor = await resolveActingMembership(db);
  const after: Visit = { ...before, status: VisitStatus.NoShow, cancel_reason: CancelReason.NoShow };

  return writeFreedVisit(db, before, after, actor.id);
}

/** The visit's update and the unlinking of any session it booked, in one transaction; returns the visit write's audit_log id. */
function writeFreedVisit(db: ClintraDatabase, before: Visit, after: Visit, actorId: string): Promise<string> {
  return runAtomicMutations(db, [db.visits, ...sessionLinkTables(db)], async (write) => {
    const auditLogId = await write({
      table: db.visits,
      entity: "visits",
      entityId: before.id,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: actorId,
      orgId: before.org_id,
    });
    await clearSessionLinks(write, db, before, actorId);
    return auditLogId;
  });
}
