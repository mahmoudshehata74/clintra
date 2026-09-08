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
  /** Defaults to booked. Walk-in passes arrived, so the visit is created already-arrived in this same write. */
  status?: VisitStatus;
  /** Defaults to phone. Walk-in passes walkin. */
  source?: VisitSource;
  /**
   * Defaults to false. An overbooked visit is written outside the normal
   * slot grid: it does not check or collide with whatever already occupies
   * that time, and its position is freshly derived (current max for the day
   * + 1) rather than the time-derived slot index, since position stays
   * unique per practitioner per day even for overbooked visits — only
   * unique_scheduled_at has the is_overbooked exception.
   */
  isOverbooked?: boolean;
}

export type BookVisitResult = { ok: true; auditLogId: string } | { ok: false; reason: "slot_taken" };

/**
 * Books a patient into a slot, writing a full visit through mutate(). The
 * slot's current state is re-read inside the same transaction as the write,
 * rather than trusting any list the caller computed earlier (e.g.
 * computeEmptySlots): that list can go stale the moment another booking
 * lands between when it was shown and when this call runs, and trusting a
 * stale snapshot for an update-in-place would silently overwrite whatever
 * that other booking just wrote. If the slot is genuinely occupied by the
 * time this runs — whether that race, or the plain unique-index collision on
 * a fresh insert — this returns "slot_taken" and writes nothing; it never
 * partially applies and never retries on its own. Overbooking skips this
 * check by design (see isOverbooked above) and instead derives a fresh
 * position inside the same transaction, so two concurrent overbook calls
 * still can't collide on position: IndexedDB serializes overlapping
 * readwrite transactions on the same store, so the second call's read of the
 * current max position always sees the first call's row already committed.
 */
export async function bookExistingPatientVisit(
  db: ClintraDatabase,
  input: BookExistingPatientVisitInput,
): Promise<BookVisitResult> {
  const scheduledAt = cairoInstant(input.visitDate, input.time);
  const actor = await resolveActingMembership(db);
  const now = new Date().toISOString();
  const status = input.status ?? VisitStatus.Booked;
  const source = input.source ?? VisitSource.Phone;
  const arrivedAt = status === VisitStatus.Arrived ? now : null;
  const isOverbooked = input.isOverbooked ?? false;

  try {
    return await db.transaction("rw", db.visits, db.audit_log, db.sync_ops, async (): Promise<BookVisitResult> => {
      if (isOverbooked) {
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
          scheduled_at: scheduledAt,
          // No unique_scheduled_at: overbooked visits are excluded from that
          // index entirely, which is how they're allowed to share a time.
          status,
          is_overbooked: true,
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

        return { ok: true, auditLogId };
      }

      const position = generateSlotTimes(input.schedule).indexOf(input.time) + 1;
      if (position <= 0) {
        throw new Error("time_not_in_schedule_grid");
      }

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
            status,
            is_overbooked: false,
            source,
            scheduled_at: scheduledAt,
            unique_scheduled_at: scheduledAt,
            arrived_at: arrivedAt,
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
