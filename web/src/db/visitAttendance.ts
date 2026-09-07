import { canTransitionVisitStatus } from "../domain/transitions";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Visit } from "./types";

/** An undo is only honoured within this long after the original mutation. */
const UNDO_WINDOW_MS = 5 * 60 * 1000;

/**
 * Marks a visit arrived and stamps arrived_at, validating the transition
 * before writing anything. Returns the id of the audit_log row this call
 * wrote — an opaque token to pass to undoMostRecentVisitArrival if the user
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

export type UndoRefusalReason =
  /** auditLogId does not identify a recorded visits mutation. */
  | "not_found"
  /** More than five minutes have passed since that mutation. */
  | "expired"
  /** A later mutation has since touched the same visit; this is no longer the one to reverse. */
  | "stale";

export type UndoOutcome = { ok: true } | { ok: false; reason: UndoRefusalReason };

/**
 * Reverses the exact visit mutation recorded under auditLogId, and only that
 * mutation. This is not a general status setter: it takes no target status
 * and no caller-supplied snapshot, and it never calls canTransitionVisitStatus,
 * since an undo moves backward against the workflow direction that machine
 * governs. Every forward status change must go through a validated path such
 * as markVisitArrived instead.
 *
 * Everything this function needs to decide whether the undo is legitimate is
 * re-read from the audit_log row itself, not from anything the caller
 * remembers about the visit. It refuses, and writes nothing, when:
 * - auditLogId does not identify a visits mutation still on record;
 * - the undo window (five minutes) has elapsed since that mutation;
 * - that mutation is no longer the most recent one recorded for this visit,
 *   meaning something else changed the visit afterward and this undo is stale.
 */
export async function undoMostRecentVisitArrival(
  db: ClintraDatabase,
  auditLogId: string,
): Promise<UndoOutcome> {
  const auditRow = await db.audit_log.get(auditLogId);
  if (!auditRow || auditRow.entity !== "visits") {
    return { ok: false, reason: "not_found" };
  }

  const elapsedMs = Date.now() - new Date(auditRow.at).getTime();
  if (elapsedMs > UNDO_WINDOW_MS) {
    return { ok: false, reason: "expired" };
  }

  const rowsForVisit = (await db.audit_log.toArray()).filter(
    (row) => row.entity === "visits" && row.entity_id === auditRow.entity_id,
  );
  const mostRecent = rowsForVisit.reduce((latest, row) => (row.at > latest.at ? row : latest));
  if (mostRecent.id !== auditRow.id) {
    return { ok: false, reason: "stale" };
  }

  const currentVisit = await db.visits.get(auditRow.entity_id);
  if (!currentVisit) {
    return { ok: false, reason: "not_found" };
  }

  const actor = await resolveActingMembership(db);

  await mutate(db, {
    table: db.visits,
    entity: "visits",
    entityId: auditRow.entity_id,
    action: AuditAction.Update,
    before: currentVisit,
    // Written by mutate() itself under this same audit row; trusted as a Visit.
    after: auditRow.before as Visit,
    actorMembershipId: actor.id,
    orgId: currentVisit.org_id,
  });

  return { ok: true };
}
