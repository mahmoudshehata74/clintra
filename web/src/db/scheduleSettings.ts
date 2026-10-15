import { id } from "../domain/id";
import { ScheduleMode } from "../domain/scheduleMode";
import { todayInCairo, weekdayOf } from "../domain/time";
import { occupiesSlot } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate, runAtomicMutations } from "./mutate";
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

/** The hours a new working day starts from when the practitioner has no working day to copy. */
export const DEFAULT_WORKING_DAY_HOURS = { startTime: "09:00", endTime: "17:00" } as const;

/** The slot length a new working day gets when the practitioner has no working day to copy. */
const DEFAULT_SLOT_MINUTES = 30;

/**
 * What a day off turned into a working day starts from: the most common
 * hours among the practitioner's existing working days at this location
 * (ties go to the earlier start, then the earlier end), else 09:00–17:00.
 * The new row copies its mode, slot length, capacity and resource count from
 * the earliest weekday that has those hours; with no working day at all it
 * is a slots day of 30 minutes.
 */
export function workingDayTemplate(schedules: readonly Schedule[]): {
  startTime: string;
  endTime: string;
  copyFrom: Schedule | undefined;
} {
  const counts = new Map<string, { startTime: string; endTime: string; count: number; copyFrom: Schedule }>();
  const byWeekday = [...schedules].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  for (const schedule of byWeekday) {
    const key = `${schedule.start_time}|${schedule.end_time}`;
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { startTime: schedule.start_time, endTime: schedule.end_time, count: 1, copyFrom: schedule });
    }
  }
  const best = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime),
  )[0];
  return best
    ? { startTime: best.startTime, endTime: best.endTime, copyFrom: best.copyFrom }
    : { ...DEFAULT_WORKING_DAY_HOURS, copyFrom: undefined };
}

export type AddWorkingDayResult =
  | { ok: true; scheduleId: string }
  | { ok: false; reason: "practitioner_not_found" | "end_before_start" | "already_working_day" };

/**
 * Turns a day off into a working day: one new schedule row for the
 * practitioner at the location on that weekday, with the given hours and the
 * mode copied as workingDayTemplate describes. Written through mutate() as
 * a create, so it is audited ("أضاف مواعيد العمل") and synced like an hour edit.
 */
export async function addWorkingDay(
  db: ClintraDatabase,
  input: { practitionerId: string; locationId: string; weekday: number; startTime: string; endTime: string },
): Promise<AddWorkingDayResult> {
  const actor = await resolveActingMembership(db);

  const practitioner = await db.practitioners.get(input.practitionerId);
  if (!practitioner) {
    return { ok: false, reason: "practitioner_not_found" };
  }
  if (input.endTime <= input.startTime) {
    return { ok: false, reason: "end_before_start" };
  }

  const existing = (await db.schedules.toArray()).filter(
    (schedule) => schedule.practitioner_id === input.practitionerId && schedule.location_id === input.locationId,
  );
  if (existing.some((schedule) => schedule.weekday === input.weekday)) {
    return { ok: false, reason: "already_working_day" };
  }

  const { copyFrom } = workingDayTemplate(existing);
  const schedule: Schedule = {
    id: id(),
    practitioner_id: input.practitionerId,
    location_id: input.locationId,
    weekday: input.weekday,
    start_time: input.startTime,
    end_time: input.endTime,
    mode: copyFrom?.mode ?? ScheduleMode.Slots,
    slot_minutes: copyFrom ? copyFrom.slot_minutes : DEFAULT_SLOT_MINUTES,
    max_capacity: copyFrom ? copyFrom.max_capacity : null,
    resource_count: copyFrom?.resource_count ?? 1,
    rev: 1,
  };

  await mutate(db, {
    table: db.schedules,
    entity: "schedules",
    entityId: schedule.id,
    action: AuditAction.Create,
    before: null,
    after: schedule,
    actorMembershipId: actor.id,
    orgId: practitioner.org_id,
  });

  return { ok: true, scheduleId: schedule.id };
}

export type RemoveWorkingDayResult =
  | { ok: true }
  | { ok: false; reason: "practitioner_not_found" | "not_working_day" | "upcoming_visits_on_day" };

/**
 * Turns a working day into a day off: deletes every schedule row the
 * practitioner has at the location on that weekday (a split day has more
 * than one), in one transaction, each audited ("شال مواعيد العمل") and
 * synced as a delete. Refused while a visit on that weekday, today or later,
 * still holds its slot — the owner moves or cancels those first; past days
 * keep their visits as they are.
 */
export async function removeWorkingDay(
  db: ClintraDatabase,
  input: { practitionerId: string; locationId: string; weekday: number },
): Promise<RemoveWorkingDayResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.schedules, db.practitioners, db.visits], async (write) => {
    const practitioner = await db.practitioners.get(input.practitionerId);
    if (!practitioner) {
      return { ok: false, reason: "practitioner_not_found" };
    }
    const forDay = (await db.schedules.toArray()).filter(
      (schedule) =>
        schedule.practitioner_id === input.practitionerId &&
        schedule.location_id === input.locationId &&
        schedule.weekday === input.weekday,
    );
    if (forDay.length === 0) {
      return { ok: false, reason: "not_working_day" };
    }

    const today = todayInCairo();
    const visits = await db.visits.toArray();
    const hasUpcoming = visits.some(
      (visit) =>
        visit.practitioner_id === input.practitionerId &&
        visit.location_id === input.locationId &&
        visit.visit_date >= today &&
        weekdayOf(visit.visit_date) === input.weekday &&
        occupiesSlot(visit.status),
    );
    if (hasUpcoming) {
      return { ok: false, reason: "upcoming_visits_on_day" };
    }

    for (const schedule of forDay) {
      await write({
        table: db.schedules,
        entity: "schedules",
        entityId: schedule.id,
        action: AuditAction.Delete,
        before: schedule,
        after: null,
        actorMembershipId: actor.id,
        orgId: practitioner.org_id,
      });
    }
    return { ok: true };
  });
}
