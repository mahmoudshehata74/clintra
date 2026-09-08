import type { Visit } from "../../db/types";
import { computeEmptySlots, type EmptySlot } from "./emptySlots";
import type { DayScheduleState } from "./scheduleState";
import { dayScreenStrings } from "./strings";

/**
 * The muted note the booking sheet shows when today has no schedule to book
 * into. Case A (day off) and Case B (never configured) each get the exact
 * wording the day grid already shows for that case, so the sheet never
 * invents a third phrasing. Null once a schedule exists — nothing to explain.
 */
export function resolveBookingScheduleNote(scheduleState: DayScheduleState): string | null {
  if (scheduleState.kind === "day_off") {
    return dayScreenStrings.noScheduleToday;
  }
  if (scheduleState.kind === "not_configured") {
    return dayScreenStrings.scheduleNotConfigured;
  }
  return null;
}

/**
 * The slots the booking sheet may offer for the given schedule state: none
 * at all unless today actually has a schedule (Case A and Case B both mean
 * there is no grid to place a visit into, even though the sheet itself still
 * opens and search still works).
 */
export function computeBookableSlots(
  scheduleState: DayScheduleState,
  visitsForPractitioner: readonly Visit[],
): EmptySlot[] {
  return scheduleState.kind === "scheduled"
    ? computeEmptySlots(scheduleState.schedule, visitsForPractitioner)
    : [];
}
