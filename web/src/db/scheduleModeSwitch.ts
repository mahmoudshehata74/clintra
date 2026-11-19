import { id } from "../domain/id";
import { orderedWrites } from "../domain/queueReorder";
import { addMinutesToClockTime } from "../domain/schedule";
import { effectiveScheduleMode, foldScheduleMode, ScheduleMode } from "../domain/scheduleMode";
import { addDaysToClinicDay, cairoInstant, todayInCairo, weekdayOf, type ClinicDay } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, type Schedule, type Visit } from "./types";

export type SwitchScheduleModeResult =
  | { ok: true }
  | { ok: false; reason: "schedule_not_found" | "slot_minutes_required" };

/** The slot length a queue doctor's days get when switched to slots with none set (as a new working day's). */
const DEFAULT_SLOT_MINUTES = 30;

/** A conversion, as planned by planConversion: the audited updates, in the order they must be written. */
interface ConversionPlan {
  updates: { before: Visit; after: Visit }[];
}

/**
 * Plans translating one schedule row's visits to newMode, one day at a
 * time. A plain function — the caller makes the writes inline in its own
 * transaction, since awaiting an async helper there can lose Dexie's
 * transaction zone:
 *
 * - slots -> queue: each visit's position becomes its scheduled_at ordering
 *   for that day (earliest first); scheduled_at is cleared, and
 *   unique_scheduled_at is removed entirely (not merely set to null) —
 *   queue visits have no scheduled time, and IndexedDB only excludes a
 *   record from a compound index when a key path is truly absent; storing
 *   literal null there for two visits would collide, since null is a real
 *   indexed value.
 * - queue -> slots: each visit's scheduled_at becomes
 *   start_time + (position - 1) * slot_minutes — position 1 is slot index 0,
 *   matching generateSlotTimes/computeGridRows' own indexing, so a
 *   translated visit lands exactly on a real slot rather than one slot
 *   late. The caller makes sure the schedule has a slot_minutes.
 *
 * No visit is ever dropped. The new positions (slots -> queue only) are
 * written in domain/queueReorder.ts's orderedWrites order over every
 * position the doctor's day holds (`dayPositions`): a visit whose place is
 * still taken is parked below zero first, so no two visits ever share a
 * position, on the device or op by op on the server. Each update's before
 * is the visit as the update before it left it.
 */
function planConversion(
  schedule: Schedule,
  visits: readonly Visit[],
  newMode: ScheduleMode,
  dayPositions: (date: string) => number[],
): ConversionPlan {
  const plan: ConversionPlan = { updates: [] };
  const visitsByDate = new Map<string, Visit[]>();
  for (const visit of visits) {
    const list = visitsByDate.get(visit.visit_date);
    if (list) {
      list.push(visit);
    } else {
      visitsByDate.set(visit.visit_date, [visit]);
    }
  }

  for (const [date, visitsForDay] of visitsByDate) {
    if (newMode === ScheduleMode.Queue) {
      const sortedByTime = [...visitsForDay].sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
      const target = new Map(sortedByTime.map((visit, index) => [visit.id, index + 1]));
      // A write to the visit's own new position is its conversion; any other is a parking step.
      const written = (before: Visit, position: number): Visit => {
        if (position !== target.get(before.id)) {
          return { ...before, position };
        }
        const after: Visit = { ...before, position, scheduled_at: null };
        delete after.unique_scheduled_at;
        return after;
      };
      const current = new Map(sortedByTime.map((visit) => [visit.id, visit]));
      for (const visit of sortedByTime.filter((candidate) => candidate.position === target.get(candidate.id))) {
        plan.updates.push({ before: visit, after: written(visit, visit.position) });
      }
      const moves = sortedByTime.map((visit) => ({ visitId: visit.id, from: visit.position, to: target.get(visit.id)! }));
      for (const step of orderedWrites(moves, dayPositions(date))) {
        const before = current.get(step.visitId)!;
        const after = written(before, step.position);
        plan.updates.push({ before, after });
        current.set(after.id, after);
      }
    } else {
      for (const visit of visitsForDay) {
        const time = addMinutesToClockTime(schedule.start_time, (visit.position - 1) * schedule.slot_minutes!);
        const scheduledAt = cairoInstant(visit.visit_date, time);
        const after: Visit = { ...visit, scheduled_at: scheduledAt, unique_scheduled_at: scheduledAt };
        if (visit.is_overbooked) {
          delete after.unique_scheduled_at;
        }
        plan.updates.push({ before: visit, after });
      }
    }
  }
  return plan;
}

/** Every position a doctor's visits hold on each date, for planConversion. */
function positionsOfDay(allVisits: readonly Visit[], practitionerId: string): (date: string) => number[] {
  return (date) => allVisits.filter((visit) => visit.practitioner_id === practitionerId && visit.visit_date === date).map((visit) => visit.position);
}

/**
 * DEV-ONLY: changes a schedule row's mode at once, for every date — call it
 * from a script or a console, never wired to any UI (the working-hours
 * editor's switch is switchModeFromTomorrow below). Converts the schedule
 * row for (practitionerId, weekday) to newMode and translates every visit,
 * on every date that falls on that weekday, as planConversion describes.
 * Refused with "slot_minutes_required" for queue -> slots if the schedule
 * has no slot_minutes set — there is no other way to derive a time from a
 * bare position.
 *
 * A practitioner is assumed to have at most one schedule row per weekday at
 * the location that row specifies (matching how schedules are seeded
 * today); only that location's visits are translated. Runs in one
 * transaction: every visit is translated or the whole switch is refused.
 */
export async function switchScheduleMode(
  db: ClintraDatabase,
  practitionerId: string,
  weekday: number,
  newMode: ScheduleMode,
): Promise<SwitchScheduleModeResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.schedules, db.visits, db.practitioners], async (write) => {
    const practitioner = await db.practitioners.get(practitionerId);
    if (!practitioner) {
      return { ok: false, reason: "schedule_not_found" };
    }

    // schedules has no plain practitioner_id index (only "id" — a small,
    // rarely-queried table), so this scans and filters in memory rather
    // than using .where().
    const schedule = (await db.schedules.toArray()).find(
      (candidate) => candidate.practitioner_id === practitionerId && candidate.weekday === weekday,
    );
    if (!schedule) {
      return { ok: false, reason: "schedule_not_found" };
    }
    if (schedule.mode === newMode) {
      return { ok: true };
    }
    if (newMode === ScheduleMode.Slots && !schedule.slot_minutes) {
      return { ok: false, reason: "slot_minutes_required" };
    }

    const allVisits = await db.visits.toArray();
    const visits = allVisits.filter(
      (visit) =>
        visit.practitioner_id === practitionerId &&
        visit.location_id === schedule.location_id &&
        weekdayOf(visit.visit_date) === weekday,
    );
    const plan = planConversion(schedule, visits, newMode, positionsOfDay(allVisits, practitionerId));
    // Every visit it moves and the row it changes: one group, all or nothing on the server.
    const groupId = id();
    for (const { before, after } of plan.updates) {
      await write({
        table: db.visits,
        entity: "visits",
        entityId: before.id,
        action: AuditAction.Update,
        before,
        after,
        actorMembershipId: actor.id,
        orgId: practitioner.org_id,
        groupId,
      });
    }

    const updatedSchedule: Schedule = { ...schedule, mode: newMode };
    await write({
      table: db.schedules,
      entity: "schedules",
      entityId: schedule.id,
      action: AuditAction.Update,
      before: schedule,
      after: updatedSchedule,
      actorMembershipId: actor.id,
      orgId: practitioner.org_id,
      groupId,
    });

    return { ok: true };
  });
}

export type SwitchModeFromTomorrowResult = { ok: true } | { ok: false; reason: "schedule_not_found" };

/**
 * The mode a doctor's days have from tomorrow on, at one location — what
 * the working-hours editor's slots/queue switch shows. Read from the
 * earliest weekday's row; the switch keeps every row alike.
 */
export function modeFromTomorrow(schedules: readonly Schedule[], today: ClinicDay): ScheduleMode | null {
  const first = [...schedules].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))[0];
  return first ? effectiveScheduleMode(first, addDaysToClinicDay(today, 1)) : null;
}

/**
 * The working-hours editor's slots/queue switch (docs/bug-hunt.md's A-03,
 * hardening scenario 24): every schedule row the practitioner has at the
 * location takes newMode from tomorrow (Cairo), in one transaction.
 *
 * Each row is first folded (foldScheduleMode) if its last switch has taken
 * effect. Then, for a row whose mode from tomorrow is not already newMode:
 * - newMode is its mode: the switch is taken back before it starts, and
 *   next_mode/next_mode_from are cleared;
 * - otherwise next_mode := newMode and next_mode_from := tomorrow.
 * Today's rows read the same mode as before either way (effectiveScheduleMode),
 * so today's grid and today's visits are untouched.
 *
 * The weekday's visits dated tomorrow or later at the location are
 * converted to newMode by planConversion; visits before tomorrow never are,
 * and none is dropped or duplicated. A split day (two rows on one weekday)
 * converts its visits once, on its earliest row's grid. A queue row with
 * no slot length switched to slots gets DEFAULT_SLOT_MINUTES, as a new
 * working day does — positions need one to become times.
 */
export async function switchModeFromTomorrow(
  db: ClintraDatabase,
  input: { practitionerId: string; locationId: string; newMode: ScheduleMode },
): Promise<SwitchModeFromTomorrowResult> {
  const actor = await resolveActingMembership(db);
  const today = todayInCairo();
  const tomorrow = addDaysToClinicDay(today, 1);

  return runAtomicMutations(db, [db.schedules, db.visits, db.practitioners], async (write) => {
    const practitioner = await db.practitioners.get(input.practitionerId);
    if (!practitioner) {
      return { ok: false, reason: "schedule_not_found" };
    }
    const rows = (await db.schedules.toArray())
      .filter((schedule) => schedule.practitioner_id === input.practitionerId && schedule.location_id === input.locationId)
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
    if (rows.length === 0) {
      return { ok: false, reason: "schedule_not_found" };
    }

    const allVisits = await db.visits.toArray();
    const convertedWeekdays = new Set<number>();
    // The whole switch — every visit it moves and every row it changes — is one group: all or nothing on the server.
    const groupId = id();

    for (const row of rows) {
      const folded = foldScheduleMode(row, today);
      let after: Schedule = folded;
      if (effectiveScheduleMode(folded, tomorrow) !== input.newMode) {
        after =
          input.newMode === folded.mode
            ? { ...folded, next_mode: null, next_mode_from: null }
            : { ...folded, next_mode: input.newMode, next_mode_from: tomorrow };
        if (input.newMode === ScheduleMode.Slots && !after.slot_minutes) {
          after = { ...after, slot_minutes: DEFAULT_SLOT_MINUTES };
        }

        if (!convertedWeekdays.has(row.weekday)) {
          convertedWeekdays.add(row.weekday);
          const visits = allVisits.filter(
            (visit) =>
              visit.practitioner_id === input.practitionerId &&
              visit.location_id === input.locationId &&
              visit.visit_date >= tomorrow &&
              weekdayOf(visit.visit_date) === row.weekday,
          );
          const plan = planConversion(after, visits, input.newMode, positionsOfDay(allVisits, input.practitionerId));
          for (const { before, after: converted } of plan.updates) {
            await write({
              table: db.visits,
              entity: "visits",
              entityId: before.id,
              action: AuditAction.Update,
              before,
              after: converted,
              actorMembershipId: actor.id,
              orgId: practitioner.org_id,
              groupId,
            });
          }
        }
      }

      if (after !== row) {
        await write({
          table: db.schedules,
          entity: "schedules",
          entityId: row.id,
          action: AuditAction.Update,
          before: row,
          after,
          actorMembershipId: actor.id,
          orgId: practitioner.org_id,
          groupId,
        });
      }
    }

    return { ok: true };
  });
}
