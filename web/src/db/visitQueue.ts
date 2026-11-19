import { id } from "../domain/id";
import { moveOnePlace, orderedWrites, type QueueMove } from "../domain/queueReorder";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import type { ClinicDay } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import { assertSessionBookable, linkSessionToVisit, sessionLinkTables } from "./carePlans";
import type { ClintraDatabase } from "./database";
import { mutate, runAtomicMutations, type AtomicWriter } from "./mutate";
import { AuditAction, type CarePlanItem, type Visit } from "./types";

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
  /**
   * The care plan session this queue visit books, if any — checked and
   * linked exactly as bookExistingPatientVisit's own carePlanItemId
   * (db/visitBooking.ts), in this same transaction.
   */
  carePlanItemId?: string;
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

  const write: AtomicWriter = (mutation) => mutate(db, mutation);

  return db.transaction("rw", [db.visits, ...sessionLinkTables(db), db.audit_log, db.sync_ops], async () => {
    const session: CarePlanItem | null = input.carePlanItemId
      ? await assertSessionBookable(db, input.carePlanItemId, input)
      : null;
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
      note: null,
      rev: 1,
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
    if (session) {
      await linkSessionToVisit(write, db, session, after, actor.id);
    }

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

const WAITING_STATUSES = new Set<VisitStatus>([VisitStatus.Booked, VisitStatus.Arrived]);

/**
 * Writes `moves` on one queue day as one group of ops (SyncOp.group_id), in
 * the order orderedWrites gives over every position the day holds, each op
 * carrying its visit's rev as this device saw it — so no two visits ever
 * share a position on the device or, op by op, on the server, which applies
 * the group whole or not at all (sync/syncGroups.ts). Resolves to each
 * moved visit's last write's audit row. Writes inline, inside the caller's
 * transaction: every await here is a real Dexie write.
 */
async function writeQueueMoves(
  write: AtomicWriter,
  db: ClintraDatabase,
  day: readonly Visit[],
  moves: readonly QueueMove[],
  actorId: string,
): Promise<Map<string, string>> {
  const groupId = id();
  const current = new Map(day.map((row) => [row.id, row]));
  const lastWrite = new Map<string, string>();
  for (const step of orderedWrites(
    moves,
    day.map((row) => row.position),
  )) {
    const before = current.get(step.visitId)!;
    const after: Visit = { ...before, position: step.position };
    const auditLogId = await write({
      table: db.visits,
      entity: "visits",
      entityId: before.id,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: actorId,
      orgId: before.org_id,
      groupId,
    });
    current.set(after.id, after);
    lastWrite.set(after.id, auditLogId);
  }
  return lastWrite;
}

/**
 * Sends a waiting (booked/arrived) visit to the back of its queue: every
 * visit after it shifts one position earlier, and it takes the vacated
 * highest position. Written as one group (writeQueueMoves): the server
 * applies the whole move or none of it, and a move made on positions
 * another device already changed is refused, put back here and left as one
 * review. The moves returned carry each visit's last write, for the undo.
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

    const planned: QueueMove[] = [
      ...affected.map((visit) => ({ visitId: visit.id, from: visit.position, to: visit.position - 1 })),
      { visitId: pushed.id, from: pushed.position, to: maxPosition },
    ];
    const lastWrite = await writeQueueMoves(write, db, visitsForDay, planned, actor.id);
    const moves = planned.map((move) => ({
      visitId: move.visitId,
      auditLogId: lastWrite.get(move.visitId)!,
      previousPosition: move.from,
      newPosition: move.to,
    }));
    return { ok: true, moves };
  });
}

export type UndoQueueReorderResult = { ok: true } | { ok: false; reason: "not_found" | "expired" | "stale" };

const UNDO_WINDOW_MS = 5 * 60 * 1000;

/**
 * Restores the exact position ordering sendVisitToEndOfQueue had just
 * changed — atomically, all moves reversed together or none, written as one
 * group the same way (writeQueueMoves). Refuses if any affected visit's
 * position no longer matches what that move set it to (something else has
 * repositioned it since — a later reorder or another write this function's
 * caller does not know about) or if the undo window has passed.
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

    const first = currentVisits[0]!;
    const day = await db.visits.where("[practitioner_id+visit_date]").equals([first.practitioner_id, first.visit_date]).toArray();
    await writeQueueMoves(
      write,
      db,
      day,
      moves.map((move) => ({ visitId: move.visitId, from: move.newPosition, to: move.previousPosition })),
      actor.id,
    );
    return { ok: true };
  });
}

export type MoveWaitingVisitResult =
  | { ok: true; moves: QueueMove[] }
  | { ok: false; reason: "visit_not_found" | "cannot_move" };

/**
 * Moves a waiting (arrived) visit one place up or down its queue
 * (domain/queueReorder.ts's moveOnePlace): it trades positions with the
 * neighbouring waiting visit; nobody else moves. Written as one group
 * (writeQueueMoves): a reorder made on positions another device already
 * moved is refused as conflict_stale_rev, put back here, and left as one
 * review (sync/syncGroups.ts).
 */
export async function moveWaitingVisit(db: ClintraDatabase, visitId: string, direction: "up" | "down"): Promise<MoveWaitingVisitResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.visits], async (write) => {
    const visit = await db.visits.get(visitId);
    if (!visit) {
      return { ok: false, reason: "visit_not_found" };
    }
    const day = await db.visits.where("[practitioner_id+visit_date]").equals([visit.practitioner_id, visit.visit_date]).toArray();
    const moves = moveOnePlace(day, visitId, direction);
    if (!moves || moves.length === 0) {
      return { ok: false, reason: "cannot_move" };
    }
    await writeQueueMoves(write, db, day, moves, actor.id);
    return { ok: true, moves };
  });
}
