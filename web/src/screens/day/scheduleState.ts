import type { Schedule } from "../../db/types";

export type DayScheduleState =
  // Case A: schedule rows exist for this practitioner, just none for today's
  // weekday. A normal day off.
  | { readonly kind: "day_off" }
  // Case B: no schedule rows exist at all, for any weekday. Missing
  // configuration, not a day off.
  | { readonly kind: "not_configured" }
  | { readonly kind: "scheduled"; readonly schedule: Schedule };

/**
 * Decides which of the two "nothing to show" cases applies, or that today's
 * schedule is available. hasAnySchedule must consider every weekday for this
 * practitioner, not just today's.
 */
export function resolveDayScheduleState(
  todaysSchedule: Schedule | undefined,
  hasAnySchedule: boolean,
): DayScheduleState {
  if (todaysSchedule) {
    return { kind: "scheduled", schedule: todaysSchedule };
  }
  return hasAnySchedule ? { kind: "day_off" } : { kind: "not_configured" };
}
