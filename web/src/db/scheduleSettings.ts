import { ScheduleMode } from "../domain/scheduleMode";
import { weekdayOf } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Schedule } from "./types";

export interface WorkingHoursUpdate {
  startTime: string;
  endTime: string;
  /** Slots mode only. */
  slotMinutes: number | null;
  /** Queue mode only. */
  maxCapacity: number | null;
}

export type UpdateWorkingHoursResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "schedule_not_found"
        | "end_before_start"
        | "invalid_slot_minutes"
        | "invalid_capacity"
        | "visits_on_old_grid";
    };

/**
 * Edits one schedule row's working hours (and its slots length / queue
 * capacity), attributed to the acting owner through mutate().
 *
 * The one change this refuses is shortening or lengthening a slots day's
 * slot_minutes while visits already exist on that weekday: the existing
 * scheduled_at values were placed on the old grid and would no longer align to
 * the new one. Rather than silently rewrite already-recorded visits (which the
 * task forbids), it returns "visits_on_old_grid" so the UI can tell the owner
 * to clear or move those visits first. start_time/end_time and queue capacity
 * are always editable — they don't rewrite any visit.
 */
export async function updateWorkingHours(
  db: ClintraDatabase,
  scheduleId: string,
  update: WorkingHoursUpdate,
): Promise<UpdateWorkingHoursResult> {
  const actor = await resolveActingMembership(db);

  const schedule = await db.schedules.get(scheduleId);
  if (!schedule) {
    return { ok: false, reason: "schedule_not_found" };
  }
  const practitioner = await db.practitioners.get(schedule.practitioner_id);
  if (!practitioner) {
    return { ok: false, reason: "schedule_not_found" };
  }

  if (update.endTime <= update.startTime) {
    return { ok: false, reason: "end_before_start" };
  }

  const isSlots = schedule.mode === ScheduleMode.Slots;
  if (isSlots) {
    if (update.slotMinutes === null || update.slotMinutes <= 0) {
      return { ok: false, reason: "invalid_slot_minutes" };
    }
    if (update.slotMinutes !== schedule.slot_minutes) {
      const visits = await db.visits.toArray();
      const hasVisitsOnWeekday = visits.some(
        (visit) =>
          visit.practitioner_id === schedule.practitioner_id &&
          visit.location_id === schedule.location_id &&
          weekdayOf(visit.visit_date) === schedule.weekday,
      );
      if (hasVisitsOnWeekday) {
        return { ok: false, reason: "visits_on_old_grid" };
      }
    }
  } else if (update.maxCapacity !== null && update.maxCapacity <= 0) {
    return { ok: false, reason: "invalid_capacity" };
  }

  const after: Schedule = {
    ...schedule,
    start_time: update.startTime,
    end_time: update.endTime,
    slot_minutes: isSlots ? update.slotMinutes : schedule.slot_minutes,
    max_capacity: isSlots ? schedule.max_capacity : update.maxCapacity,
  };

  await mutate(db, {
    table: db.schedules,
    entity: "schedules",
    entityId: schedule.id,
    action: AuditAction.Update,
    before: schedule,
    after,
    actorMembershipId: actor.id,
    orgId: practitioner.org_id,
  });

  return { ok: true };
}
