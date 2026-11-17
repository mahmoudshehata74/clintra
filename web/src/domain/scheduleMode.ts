import type { ClinicDay } from "./time";

/** How a clinic schedules visits: fixed time slots, or a walk-in queue. */
export const ScheduleMode = {
  Slots: "slots",
  Queue: "queue",
} as const;

export type ScheduleMode = (typeof ScheduleMode)[keyof typeof ScheduleMode];

/**
 * A schedule row's mode fields (docs/schema.md's v23 additions): its mode,
 * and the switch the working-hours editor dates to start tomorrow. Both
 * next_* are null, or absent on a row written before they existed, with no
 * switch pending; they are written and cleared together.
 */
export interface ScheduleModeFields {
  mode: ScheduleMode;
  next_mode?: ScheduleMode | null;
  next_mode_from?: ClinicDay | null;
}

/**
 * The mode a schedule row has on one Cairo day: next_mode on and after
 * next_mode_from, mode before it (or with no switch pending). Every screen
 * that reads a mode reads it through this, for the day it shows.
 */
export function effectiveScheduleMode(schedule: ScheduleModeFields, date: ClinicDay): ScheduleMode {
  return schedule.next_mode != null && schedule.next_mode_from != null && date >= schedule.next_mode_from
    ? schedule.next_mode
    : schedule.mode;
}

/**
 * A row whose switch has taken effect (next_mode_from on or before today),
 * folded: mode becomes next_mode and both next_* are cleared. Any other row
 * comes back as it is. Folding changes no day from today on — they all read
 * next_mode either way — so it runs whenever the owner next saves the row.
 */
export function foldScheduleMode<T extends ScheduleModeFields>(schedule: T, today: ClinicDay): T {
  if (schedule.next_mode == null || schedule.next_mode_from == null || schedule.next_mode_from > today) {
    return schedule;
  }
  return { ...schedule, mode: schedule.next_mode, next_mode: null, next_mode_from: null };
}
