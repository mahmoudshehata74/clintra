import { addDaysToClinicDay, weekdayOf, type ClinicDay } from "../../domain/time";
import type { Schedule, Visit } from "../../db/types";
import { computeEmptySlots, type EmptySlot } from "./emptySlots";

export interface MoveDayGroup {
  date: ClinicDay;
  weekday: number;
  slots: readonly EmptySlot[];
}

const MOVE_TARGET_DAY_COUNT = 8; // today plus the next 7 days

/**
 * Empty slots for one practitioner across today and the next 7 days,
 * grouped by day. A day with no schedule at all, or a schedule but zero
 * empty slots, is left out of the list entirely rather than shown empty —
 * there is nothing useful to tap there.
 */
export function computeMoveTargets(
  startDate: ClinicDay,
  scheduleForWeekday: (weekday: number) => Schedule | undefined,
  visitsForDate: (date: ClinicDay) => readonly Visit[],
): MoveDayGroup[] {
  const groups: MoveDayGroup[] = [];

  for (let offset = 0; offset < MOVE_TARGET_DAY_COUNT; offset++) {
    const date = addDaysToClinicDay(startDate, offset);
    const weekday = weekdayOf(date);
    const schedule = scheduleForWeekday(weekday);
    if (!schedule) {
      continue;
    }

    const slots = computeEmptySlots(schedule, visitsForDate(date));
    if (slots.length === 0) {
      continue;
    }

    groups.push({ date, weekday, slots });
  }

  return groups;
}
