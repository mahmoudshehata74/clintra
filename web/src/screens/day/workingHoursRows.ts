import type { Schedule } from "../../db/types";
import { ScheduleMode } from "../../domain/scheduleMode";
import type { UpdateWorkingHoursResult } from "../../db/scheduleSettings";

export type WorkingHoursMode =
  | { kind: "slots"; slotMinutes: number | null }
  | { kind: "queue"; maxCapacity: number | null }
  | { kind: "day_off" };

export interface WorkingHoursRow {
  /** Stable React key: the schedule's id, or `off-{weekday}` for a day with none. */
  key: string;
  weekday: number;
  /** Undefined on a day off — nothing to edit. */
  schedule: Schedule | undefined;
  /** "HH:MM — HH:MM", or "—" on a day off (`.set-row .hours`). */
  hours: string;
  mode: WorkingHoursMode;
}

const DAY_OFF_HOURS = "—";

/**
 * Screen 12's `.set-list`: one row per weekday, Sunday (0) to Saturday (6),
 * in the order the week reads — every weekday is listed, and one with no
 * schedule at this practitioner+location reads as a day off ("—"). A
 * weekday with more than one schedule (a split day) gets one row per
 * schedule, earliest first.
 */
export function buildWorkingHoursRows(schedules: readonly Schedule[]): WorkingHoursRow[] {
  const rows: WorkingHoursRow[] = [];
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const forDay = schedules
      .filter((schedule) => schedule.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (forDay.length === 0) {
      rows.push({ key: `off-${weekday}`, weekday, schedule: undefined, hours: DAY_OFF_HOURS, mode: { kind: "day_off" } });
      continue;
    }
    for (const schedule of forDay) {
      rows.push({
        key: schedule.id,
        weekday,
        schedule,
        hours: `${schedule.start_time} — ${schedule.end_time}`,
        mode:
          schedule.mode === ScheduleMode.Slots
            ? { kind: "slots", slotMinutes: schedule.slot_minutes }
            : { kind: "queue", maxCapacity: schedule.max_capacity },
      });
    }
  }
  return rows;
}

export interface WorkingHoursModeStrings {
  slots: string;
  queue: string;
  dayOff: string;
  minutesUnit: string;
  patientsUnit: string;
}

/** `.set-row .mode`: "مواعيد 30د", "طابور · 20 مريض" (just "طابور" with no capacity set), or "إجازة". */
export function formatWorkingHoursMode(mode: WorkingHoursMode, strings: WorkingHoursModeStrings): string {
  switch (mode.kind) {
    case "slots":
      return mode.slotMinutes != null ? `${strings.slots} ${mode.slotMinutes}${strings.minutesUnit}` : strings.slots;
    case "queue":
      return mode.maxCapacity != null ? `${strings.queue} · ${mode.maxCapacity} ${strings.patientsUnit}` : strings.queue;
    case "day_off":
      return strings.dayOff;
  }
}

export type WorkingHoursField = "start" | "end" | "slotMinutes" | "capacity";
type RefusalReason = Exclude<UpdateWorkingHoursResult, { ok: true }>["reason"];

/**
 * Which field of the edit form a refusal belongs under, so its existing
 * message shows as that field's error. "visits_on_old_grid" (and the
 * schedule vanishing, which already shared its message) is about the slot
 * length the owner just changed.
 */
export function workingHoursErrorField(reason: RefusalReason): WorkingHoursField {
  switch (reason) {
    case "end_before_start":
      return "end";
    case "invalid_capacity":
      return "capacity";
    case "invalid_slot_minutes":
    case "visits_on_old_grid":
    case "schedule_not_found":
      return "slotMinutes";
  }
}
