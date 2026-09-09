import { addMinutesToClockTime } from "../domain/schedule";
import { ScheduleMode } from "../domain/scheduleMode";
import { cairoInstant, weekdayOf } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, type Schedule, type Visit } from "./types";

export type SwitchScheduleModeResult =
  | { ok: true }
  | { ok: false; reason: "schedule_not_found" | "slot_minutes_required" };

// Positions are parked here first, then written to their true values — see
// visitQueue.ts's sendVisitToEndOfQueue for the full reasoning; the same
// transient-collision risk applies whenever several visits' positions are
// reassigned together.
const PARK_OFFSET = 1_000_000;

/**
 * DEV-ONLY: there is no settings screen yet for changing a schedule's mode,
 * so this is the only way to do it today — call it from a script or a
 * console, never wired to any UI. Converts the schedule row for
 * (practitionerId, weekday) to newMode and translates every visit, on every
 * date that falls on that weekday, sensibly:
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
 *   late. Refused with "slot_minutes_required" if the schedule has no
 *   slot_minutes set — there is no other way to derive a time from a bare
 *   position.
 *
 * A practitioner is assumed to have at most one schedule row per weekday at
 * the location that row specifies (matching how schedules are seeded
 * today); only that location's visits are translated.
 *
 * Both directions run in one transaction: every visit is translated or the
 * whole switch is refused, and no visit is ever dropped. Reassigning
 * positions (slots -> queue only — the new ordering can genuinely differ
 * from the existing slot-index positions) parks every affected visit at
 * position + PARK_OFFSET first, an unaudited raw write that never commits
 * on its own and is invisible to any other reader, then writes each one's
 * real final position — writing the shifted positions directly, in any
 * order, could otherwise transiently collide with whichever visit currently
 * holds a target position.
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
    const visitsOnThisWeekday = allVisits.filter(
      (visit) =>
        visit.practitioner_id === practitionerId &&
        visit.location_id === schedule.location_id &&
        weekdayOf(visit.visit_date) === weekday,
    );

    const visitsByDate = new Map<string, Visit[]>();
    for (const visit of visitsOnThisWeekday) {
      const list = visitsByDate.get(visit.visit_date);
      if (list) {
        list.push(visit);
      } else {
        visitsByDate.set(visit.visit_date, [visit]);
      }
    }

    for (const visitsForDay of visitsByDate.values()) {
      if (newMode === ScheduleMode.Queue) {
        const sortedByTime = [...visitsForDay].sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

        for (const visit of sortedByTime) {
          await db.visits.put({ ...visit, position: visit.position + PARK_OFFSET });
        }

        for (let index = 0; index < sortedByTime.length; index++) {
          const visit = sortedByTime[index];
          const after: Visit = { ...visit, position: index + 1, scheduled_at: null };
          delete after.unique_scheduled_at;
          await write({
            table: db.visits,
            entity: "visits",
            entityId: visit.id,
            action: AuditAction.Update,
            before: visit,
            after,
            actorMembershipId: actor.id,
            orgId: practitioner.org_id,
          });
        }
      } else {
        for (const visit of visitsForDay) {
          const time = addMinutesToClockTime(schedule.start_time, (visit.position - 1) * schedule.slot_minutes!);
          const scheduledAt = cairoInstant(visit.visit_date, time);
          const after: Visit = { ...visit, scheduled_at: scheduledAt, unique_scheduled_at: scheduledAt };
          if (visit.is_overbooked) {
            delete after.unique_scheduled_at;
          }
          await write({
            table: db.visits,
            entity: "visits",
            entityId: visit.id,
            action: AuditAction.Update,
            before: visit,
            after,
            actorMembershipId: actor.id,
            orgId: practitioner.org_id,
          });
        }
      }
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
    });

    return { ok: true };
  });
}
