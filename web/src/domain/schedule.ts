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
 * Generates the slot start times for a slots-mode schedule, from start_time to
 * end_time stepping by slot_minutes. Slot length always comes from the
 * schedule, never a hardcoded value. A slot is only included if it fully fits
 * before end_time.
 */
export function generateSlotTimes(schedule: SlotScheduleInput): ClockTime[] {
  if (!schedule.slot_minutes || schedule.slot_minutes <= 0) {
    return [];
  }

  const start = toMinutes(schedule.start_time);
  const end = toMinutes(schedule.end_time);
  const times: ClockTime[] = [];

  for (let minutes = start; minutes + schedule.slot_minutes <= end; minutes += schedule.slot_minutes) {
    times.push(toClockTime(minutes));
  }

  return times;
}
