import { todayInCairo, type ClinicDay, type Instant } from "../../domain/time";
import { dayScreenStrings } from "./strings";

/** "{m}د" under 60 minutes; "{h}س {m}د" at 60 or more, omitting a zero-minute remainder ("1س", not "1س 0د"). */
export function formatElapsedMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) {
    return `${totalMinutes}${dayScreenStrings.minutesShortUnit}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hoursLabel = `${hours}${dayScreenStrings.hoursShortUnit}`;
  return minutes === 0 ? hoursLabel : `${hoursLabel} ${minutes}${dayScreenStrings.minutesShortUnit}`;
}

/**
 * The day grid's elapsed/duration labels (SlotRow.tsx's `.until`, and
 * QueueRow.tsx's in-room meta phrase): the time from `fromInstant` to
 * `toInstant`, formatted by formatElapsedMinutes — but only ever shown while
 * `today` (the day actually on screen) is the real current Cairo day.
 * Otherwise null: a dev-only ?seedDay=1 pin can leave `fromInstant` (a
 * seeded visit's real started_at/scheduled_at) far in the past relative to
 * `now`, which would otherwise render as a nonsense elapsed count.
 */
export function computeElapsedLabel(
  fromInstant: Instant,
  toInstant: Instant,
  today: ClinicDay,
  now: Date = new Date(),
): string | null {
  if (today !== todayInCairo(now)) {
    return null;
  }
  const minutes = Math.max(0, Math.round((new Date(toInstant).getTime() - new Date(fromInstant).getTime()) / 60_000));
  return formatElapsedMinutes(minutes);
}
