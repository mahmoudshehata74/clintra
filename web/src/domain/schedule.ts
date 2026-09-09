import type { ClockTime } from "./time";

export interface SlotScheduleInput {
  start_time: ClockTime;
  end_time: ClockTime;
  slot_minutes: number | null;
}

function toMinutes(time: ClockTime): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function toClockTime(minutes: number): ClockTime {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Every time from start_time to end_time stepping by stepMinutes. A time is
 * only included if it fully fits before end_time. Shared by generateSlotTimes
 * (steps by the schedule's own slot_minutes) and the overbook time picker
 * (steps by a fixed 15 minutes, independent of the schedule's slot length).
 */
export function generateTimeChoices(
  window: { start_time: ClockTime; end_time: ClockTime },
  stepMinutes: number,
): ClockTime[] {
  if (stepMinutes <= 0) {
    return [];
  }

  const start = toMinutes(window.start_time);
  const end = toMinutes(window.end_time);
  const times: ClockTime[] = [];

  for (let minutes = start; minutes + stepMinutes <= end; minutes += stepMinutes) {
    times.push(toClockTime(minutes));
  }

  return times;
}

/**
 * Generates the slot start times for a slots-mode schedule, from start_time to
 * end_time stepping by slot_minutes. Slot length always comes from the
 * schedule, never a hardcoded value. A slot is only included if it fully fits
 * before end_time.
 */
export function generateSlotTimes(schedule: SlotScheduleInput): ClockTime[] {
  if (!schedule.slot_minutes || schedule.slot_minutes <= 0) {
    return [];
  }

  return generateTimeChoices(schedule, schedule.slot_minutes);
}

/**
 * A clock time some number of minutes after another — used to translate a
 * queue position into a slot time when switching a schedule from queue to
 * slots mode (see db/scheduleModeSwitch.ts). Not clamped to end_time: a
 * position past the schedule's normal capacity still gets a real, if
 * late, time rather than silently losing the visit.
 */
export function addMinutesToClockTime(time: ClockTime, minutes: number): ClockTime {
  return toClockTime(toMinutes(time) + minutes);
}
