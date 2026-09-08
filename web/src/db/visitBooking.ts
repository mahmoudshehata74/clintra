import Dexie from "dexie";
import { id } from "../domain/id";
import { generateSlotTimes } from "../domain/schedule";
import { cairoInstant, type ClinicDay, type ClockTime } from "../domain/time";
import { VisitSource } from "../domain/visitSource";
import { occupiesSlot, VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Schedule, type Visit } from "./types";

export interface BookExistingPatientVisitInput {
  practitionerId: string;
  locationId: string;
  orgId: string;
  patientId: string;
  serviceId: string;
  visitDate: ClinicDay;
  time: ClockTime;
  schedule: Schedule;
}

export type BookVisitResult = { ok: true; auditLogId: string } | { ok: false; reason: "slot_taken" };

/**
 * Books an existing patient into a slot, writing a full booked visit through
 * mutate(). The slot's current state is re-read from the unique
 * [practitioner_id+visit_date+position] index inside the same transaction as
 * the write, rather than trusting any list the caller computed earlier
 * (e.g. computeEmptySlots): that list can go stale the moment another
 * booking lands between when it was shown and when this call runs, and
 * trusting a stale snapshot for an update-in-place would silently overwrite
 * whatever that other booking just wrote. If the slot is genuinely occupied
 * by the time this runs — whether that race, or the plain unique-index
 * collision on a fresh insert — this returns "slot_taken" and writes
 * nothing; it never partially applies and never retries on its own.
 */
export async function bookExistingPatientVisit(
  db: ClintraDatabase,
  input: BookExistingPatientVisitInput,
): Promise<BookVisitResult> {
  const position = generateSlotTimes(input.schedule).indexOf(input.time) + 1;
  if (position <= 0) {
    throw new Error("time_not_in_schedule_grid");
  }

  const scheduledAt = cairoInstant(input.visitDate, input.time);
  const actor = await resolveActingMembership(db);
  const now = new Date().toISOString();

  try {
    return await db.transaction("rw", db.visits, db.audit_log, db.sync_ops, async (): Promise<BookVisitResult> => {
      const currentAtSlot = await db.visits
        .where("[practitioner_id+visit_date+position]")
        .equals([input.practitionerId, input.visitDate, position])
        .first();

      if (currentAtSlot && occupiesSlot(currentAtSlot.status)) {
        return { ok: false, reason: "slot_taken" };
      }

      const after: Visit = currentAtSlot
        ? {
            ...currentAtSlot,
            patient_id: input.patientId,
            service_id: input.serviceId,
            status: VisitStatus.Booked,
            is_overbooked: false,
            source: VisitSource.Phone,
            scheduled_at: scheduledAt,
            unique_scheduled_at: scheduledAt,
            arrived_at: null,
            started_at: null,
            ended_at: null,
            cancel_reason: null,
            rescheduled_from: null,
            created_by: actor.id,
            created_at: now,
          }
        : {
            id: id(),
            org_id: input.orgId,
            location_id: input.locationId,
            practitioner_id: input.practitionerId,
            patient_id: input.patientId,
            service_id: input.serviceId,
            care_plan_item_id: null,
            visit_date: input.visitDate,
            position,
            scheduled_at: scheduledAt,
            unique_scheduled_at: scheduledAt,
            status: VisitStatus.Booked,
            is_overbooked: false,
            source: VisitSource.Phone,
            arrived_at: null,
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
        action: currentAtSlot ? AuditAction.Update : AuditAction.Create,
        before: currentAtSlot ?? null,
        after,
        actorMembershipId: actor.id,
        orgId: input.orgId,
      });

      return { ok: true, auditLogId };
    });
  } catch (error) {
    if (error instanceof Dexie.ConstraintError) {
      return { ok: false, reason: "slot_taken" };
    }
    throw error;
  }
}
