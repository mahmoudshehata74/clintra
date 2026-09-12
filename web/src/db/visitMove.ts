import Dexie from "dexie";
import { id } from "../domain/id";
import { generateSlotTimes } from "../domain/schedule";
import { cairoInstant, type ClinicDay, type ClockTime } from "../domain/time";
import { CancelReason, occupiesSlot, VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Schedule, type Visit } from "./types";

export interface MoveVisitInput {
  visitId: string;
  toDate: ClinicDay;
  toTime: ClockTime;
  /** The schedule for toDate's weekday, used to derive the new position. */
  toSchedule: Schedule;
}

export type MoveVisitResult =
  | { ok: true; oldVisitAuditLogId: string; newVisitAuditLogId: string }
  | { ok: false; reason: "slot_taken" };

/**
 * Moves a visit to a new date/time by creating a new visit row at the target
 * slot and marking the original row rescheduled (cancel_reason "postpone") —
 * not by updating the original row's own date/time in place. This is the
 * model docs/schema.md's visits table note records as the one `rescheduled_from`
 * describes: a rescheduled visit is a distinct historical row, which is why
 * VisitStatus.Rescheduled exists and why statusStyle.ts and emptySlots.ts
 * already treat "rescheduled" as freeing the slot rather than occupying it.
 * That means a move is two coordinated writes, not one — mirrored by a
 * two-step undo (see the "visit_move" UndoAction), the same shape already
 * used for a new-patient booking's patient+visit pair.
 *
 * The target slot's current state is re-read inside the same transaction as
 * both writes, exactly like bookExistingPatientVisit, so a stale slot in
 * whatever list the caller displayed cannot cause a lost update.
 */
export async function moveVisit(db: ClintraDatabase, input: MoveVisitInput): Promise<MoveVisitResult> {
  const position = generateSlotTimes(input.toSchedule).indexOf(input.toTime) + 1;
  if (position <= 0) {
    throw new Error("time_not_in_schedule_grid");
  }

  const scheduledAt = cairoInstant(input.toDate, input.toTime);
  const actor = await resolveActingMembership(db);
  const now = new Date().toISOString();

  try {
    return await db.transaction(
      "rw",
      db.visits,
      db.audit_log,
      db.sync_ops,
      async (): Promise<MoveVisitResult> => {
        const oldVisit = await db.visits.get(input.visitId);
        if (!oldVisit) {
          throw new Error("visit_not_found");
        }

        const currentAtTargetSlot = await db.visits
          .where("[practitioner_id+visit_date+position]")
          .equals([oldVisit.practitioner_id, input.toDate, position])
          .first();

        if (currentAtTargetSlot && occupiesSlot(currentAtTargetSlot.status)) {
          return { ok: false, reason: "slot_taken" };
        }

        const oldVisitAfter: Visit = {
          ...oldVisit,
          status: VisitStatus.Rescheduled,
          cancel_reason: CancelReason.Postpone,
        };
        const oldVisitAuditLogId = await mutate(db, {
          table: db.visits,
          entity: "visits",
          entityId: oldVisit.id,
          action: AuditAction.Update,
          before: oldVisit,
          after: oldVisitAfter,
          actorMembershipId: actor.id,
          orgId: oldVisit.org_id,
        });

        // Reuse a freed (cancelled/no_show/rescheduled) row at the target
        // slot in place, same rule as booking: position is unique per
        // practitioner per day regardless of status.
        const newVisit: Visit = currentAtTargetSlot
          ? {
              ...currentAtTargetSlot,
              patient_id: oldVisit.patient_id,
              service_id: oldVisit.service_id,
              status: VisitStatus.Booked,
              is_overbooked: false,
              source: oldVisit.source,
              scheduled_at: scheduledAt,
              unique_scheduled_at: scheduledAt,
              arrived_at: null,
              started_at: null,
              ended_at: null,
              cancel_reason: null,
              rescheduled_from: oldVisit.id,
              created_by: actor.id,
              created_at: now,
            }
          : {
              id: id(),
              org_id: oldVisit.org_id,
              location_id: oldVisit.location_id,
              practitioner_id: oldVisit.practitioner_id,
              patient_id: oldVisit.patient_id,
              service_id: oldVisit.service_id,
              care_plan_item_id: null,
              visit_date: input.toDate,
              position,
              scheduled_at: scheduledAt,
              unique_scheduled_at: scheduledAt,
              status: VisitStatus.Booked,
              is_overbooked: false,
              source: oldVisit.source,
              arrived_at: null,
              started_at: null,
              ended_at: null,
              cancel_reason: null,
              rescheduled_from: oldVisit.id,
              created_by: actor.id,
              created_at: now,
              rev: 1,
            };

        const newVisitAuditLogId = await mutate(db, {
          table: db.visits,
          entity: "visits",
          entityId: newVisit.id,
          action: currentAtTargetSlot ? AuditAction.Update : AuditAction.Create,
          before: currentAtTargetSlot ?? null,
          after: newVisit,
          actorMembershipId: actor.id,
          orgId: oldVisit.org_id,
        });

        return { ok: true, oldVisitAuditLogId, newVisitAuditLogId };
      },
    );
  } catch (error) {
    if (error instanceof Dexie.ConstraintError) {
      return { ok: false, reason: "slot_taken" };
    }
    throw error;
  }
}
