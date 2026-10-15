/**
 * TimeField's pure parts: the hour and minute choices and the "HH:MM"
 * value they make up. The app is 24-hour everywhere, so the field never
 * follows the device locale the way a native `<input type="time">` does
 * ("09:00 AM").
 */

export const MINUTE_STEP = 5;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "00" … "23". */
export const HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, hour) => pad(hour));

/**
 * "00", "05" … "55", plus `current` in its place when it is not on a
 * 5-minute step — a stored "09:07" still shows as itself instead of
 * silently reading as another time.
 */
export function minuteOptions(current: string): string[] {
  const steps = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => pad(index * MINUTE_STEP));
  if (!/^[0-5][0-9]$/.test(current) || steps.includes(current)) {
    return steps;
  }
  return [...steps, current].sort();
}

export interface TimeParts {
  hour: string;
  minute: string;
}

/** "HH:MM" into its two parts; anything else reads as "00:00". */
export function splitTimeValue(value: string): TimeParts {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  return match ? { hour: match[1], minute: match[2] } : { hour: "00", minute: "00" };
}

export function joinTimeValue(parts: TimeParts): string {
  return `${parts.hour}:${parts.minute}`;
}
