import type { ClockTime } from "../../domain/time";

/** The three quick presets the delay picker offers, plus a "clear" (0) option shown separately. */
export const DELAY_PRESET_MINUTES: readonly number[] = [15, 30, 60];

/** The schedule's start time, shifted forward by the doctor's delay. The slot grid's own times never change — this is only for the "effective start" line above it. */
export function effectiveStartTime(scheduleStartTime: ClockTime, delayMinutes: number): ClockTime {
  const [hour, minute] = scheduleStartTime.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + delayMinutes;
  const effectiveHour = Math.floor(totalMinutes / 60) % 24;
  const effectiveMinute = totalMinutes % 60;
  return `${String(effectiveHour).padStart(2, "0")}:${String(effectiveMinute).padStart(2, "0")}`;
}
