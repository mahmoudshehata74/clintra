import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import type { ClinicDay } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate, runAtomicMutations } from "./mutate";
import { AuditAction, type Visit } from "./types";

export interface AddToQueueInput {
  practitionerId: string;
  locationId: string;
  orgId: string;
  patientId: string;
  serviceId: string;
  visitDate: ClinicDay;
  /** Defaults to booked. Walk-in passes arrived, so the visit is created already-arrived in this same write. */
  status?: VisitStatus;
  /** Defaults to phone. Walk-in passes walkin. */
  source?: VisitSource;
}

export interface AddToQueueResult {
  auditLogId: string;
  position: number;
}

/**
 * Adds a patient to a queue-mode day: no time slot to pick, just the next
 * position — read and written inside one transaction, so two concurrent adds
 * for the same practitioner+date never collide: IndexedDB serializes
 * overlapping readwrite transactions on the visits store, so the second
 * call's read of the current max position always sees the first call's row
 * already committed. Deliberately has no unique_scheduled_at (queue visits
 * have no scheduled time at all, so — like an overbooked visit — this field
 * must be omitted, not set to null, to stay out of that unique index: two
 * visits both storing literal null would collide on it, since null is a
 * real indexed value, not a missing one).
 */
export async function addToQueue(db: ClintraDatabase, input: AddToQueueInput): Promise<AddToQueueResult> {
  const actor = await resolveActingMembership(db);
  const now = new Date().toISOString();
  const status = input.status ?? VisitStatus.Booked;
  const source = input.source ?? VisitSource.Phone;
  const arrivedAt = status === VisitStatus.Arrived ? now : null;

  return db.transaction("rw", db.visits, db.audit_log, db.sync_ops, async () => {
    const visitsForDay = await db.visits
      .where("[practitioner_id+visit_date]")
      .equals([input.practitionerId, input.visitDate])
      .toArray();
    const position = visitsForDay.reduce((max, visit) => Math.max(max, visit.position), 0) + 1;

    const after: Visit = {
      id: id(),
      org_id: input.orgId,
      location_id: input.locationId,
      practitioner_id: input.practitionerId,
      patient_id: input.patientId,
      service_id: input.serviceId,
      care_plan_item_id: null,
      visit_date: input.visitDate,
      position,
      scheduled_at: null,
      status,
      is_overbooked: false,
      source,
      arrived_at: arrivedAt,
      started_at: null,
      ended_at: null,
      cancel_reason: null,
      rescheduled_from: null,
      created_by: actor.id,
      created_at: now,
    };

    const auditLogId = await mutate(db, {
      table: db.visits,
      entity: "visits",
      entityId: after.id,
      action: AuditAction.Create,
      before: null,
      after,
      actorMembershipId: actor.id,
      orgId: input.orgId,
    });

    return { auditLogId, position };
  });
}

/** One visit's position change from a queue reorder, enough to undo it later without re-deriving anything from a generic audit_log payload. */
export interface QueueReorderMove {
  visitId: string;
  auditLogId: string;
  previousPosition: number;
  newPosition: number;
}

export type SendToEndOfQueueResult =
  | { ok: true; moves: QueueReorderMove[] }
  | { ok: false; reason: "visit_not_found" | "not_waiting" };

// Positions are parked here first, then written to their true values — see
// the doc comment on sendVisitToEndOfQueue for why.
const PARK_OFFSET = 1_000_000;

const WAITING_STATUSES = new Set<VisitStatus>([VisitStatus.Booked, VisitStatus.Arrived]);

/**
 * Sends a waiting (booked/arrived) visit to the back of its queue: every
 * visit after it shifts one position earlier, and it takes the vacated
 * highest position. Every visit whose position changes is parked at
 * position + PARK_OFFSET first (a raw, unaudited write — this intermediate
 * state never commits on its own and is never visible to any other reader,
 * since IndexedDB only exposes a transaction's fully-committed end state),
 * then written to its true final position. Without this, writing the
 * shifted positions directly, in any order, would transiently collide with
 * whatever visit currently holds that target position and one of them
 * would still be there — the unique index would reject it. The parked
 * write and the final write are separated by the same reasoning that makes
 * the final state, and only the final state, the thing the audit log
 * records: before/after here are each visit's real before and after, never
 * the throwaway parked value.
 */
export async function sendVisitToEndOfQueue(db: ClintraDatabase, visitId: string): Promise<SendToEndOfQueueResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.visits], async (write) => {
    const pushed = await db.visits.get(visitId);
    if (!pushed) {
      return { ok: false, reason: "visit_not_found" };
    }
    if (!WAITING_STATUSES.has(pushed.status)) {
      return { ok: false, reason: "not_waiting" };
    }

    const visitsForDay = await db.visits
      .where("[practitioner_id+visit_date]")
      .equals([pushed.practitioner_id, pushed.visit_date])
      .toArray();
    const maxPosition = visitsForDay.reduce((max, visit) => Math.max(max, visit.position), 0);
    const affected = visitsForDay.filter((visit) => visit.position > pushed.position);

    if (affected.length === 0) {
      // Already last: nothing to shift, nothing to record.
      return { ok: true, moves: [] };
    }

    for (const visit of [pushed, ...affected]) {
      await db.visits.put({ ...visit, position: visit.position + PARK_OFFSET });
    }

    const moves: QueueReorderMove[] = [];
    for (const visit of affected) {
      const newPosition = visit.position - 1;
      const auditLogId = await write({
        table: db.visits,
        entity: "visits",
        entityId: visit.id,
        action: AuditAction.Update,
        before: visit,
        after: { ...visit, position: newPosition },
        actorMembershipId: actor.id,
        orgId: visit.org_id,
      });
      moves.push({ visitId: visit.id, auditLogId, previousPosition: visit.position, newPosition });
    }

    const pushedAuditLogId = await write({
      table: db.visits,
      entity: "visits",
      entityId: pushed.id,
      action: AuditAction.Update,
      before: pushed,
      after: { ...pushed, position: maxPosition },
      actorMembershipId: actor.id,
      orgId: pushed.org_id,
    });
    moves.push({ visitId: pushed.id, auditLogId: pushedAuditLogId, previousPosition: pushed.position, newPosition: maxPosition });

    return { ok: true, moves };
  });
}

export type UndoQueueReorderResult = { ok: true } | { ok: false; reason: "not_found" | "expired" | "stale" };

const UNDO_WINDOW_MS = 5 * 60 * 1000;

/**
 * Restores the exact position ordering sendVisitToEndOfQueue had just
 * changed — atomically, all moves reversed together or none. Refuses if any
 * affected visit's position no longer matches what that move set it to
 * (something else has repositioned it since — a later reorder or another
 * write this function's caller does not know about) or if the undo window
 * has passed. Uses the same park-then-final-position technique in reverse
 * for the same reason: writing several visits back to their original
 * positions in any single order can transiently collide with each other.
 */
export async function undoSendVisitToEndOfQueue(
  db: ClintraDatabase,
  moves: readonly QueueReorderMove[],
): Promise<UndoQueueReorderResult> {
  if (moves.length === 0) {
    return { ok: true };
  }
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.visits], async (write) => {
    const auditRows = await Promise.all(moves.map((move) => db.audit_log.get(move.auditLogId)));
    if (auditRows.some((row) => !row)) {
      return { ok: false, reason: "not_found" };
    }

    const now = Date.now();
    if (auditRows.some((row) => now - new Date(row!.at).getTime() > UNDO_WINDOW_MS)) {
      return { ok: false, reason: "expired" };
    }

    const currentVisits = await Promise.all(moves.map((move) => db.visits.get(move.visitId)));
    if (currentVisits.some((visit, index) => !visit || visit.position !== moves[index].newPosition)) {
      return { ok: false, reason: "stale" };
    }

    for (const visit of currentVisits) {
      await db.visits.put({ ...visit!, position: visit!.position + PARK_OFFSET });
    }

    for (let index = 0; index < moves.length; index++) {
      const current = currentVisits[index]!;
      await write({
        table: db.visits,
        entity: "visits",
        entityId: current.id,
        action: AuditAction.Update,
        before: current,
        after: { ...current, position: moves[index].previousPosition },
        actorMembershipId: actor.id,
        orgId: current.org_id,
      });
    }

    return { ok: true };
  });
}
