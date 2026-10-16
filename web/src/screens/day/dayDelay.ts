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

/** The longest delay the picker's minutes field takes: four hours. */
export const DELAY_MAX_MINUTES = 240;

export type DelayMinutesInput = { ok: true; minutes: number } | { ok: false };

/**
 * The picker's minutes field as typed: a whole number of minutes from 1 to
 * DELAY_MAX_MINUTES, surrounding spaces ignored and Arabic-Indic digits read
 * as Latin ones (normalizeDelayDigits). Anything else — empty, a fraction, a
 * sign, a unit, zero or more than four hours — is refused.
 */
export function parseDelayMinutes(text: string): DelayMinutesInput {
  const latin = normalizeDelayDigits(text).trim();
  if (!/^\d{1,3}$/.test(latin)) {
    return { ok: false };
  }
  const minutes = Number(latin);
  return minutes >= 1 && minutes <= DELAY_MAX_MINUTES ? { ok: true, minutes } : { ok: false };
}

const ARABIC_INDIC_ZERO = 0x0660;

/** Arabic-Indic digits typed into the minutes field, shown back as Latin ones. */
export function normalizeDelayDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO));
}
