/** A local calendar date in Africa/Cairo, formatted "YYYY-MM-DD". */
export type ClinicDay = string;

/** A 24-hour clock time, formatted "HH:MM". */
export type ClockTime = string;

/** An instant in time, as an ISO 8601 UTC string. */
export type Instant = string;

const CAIRO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const CAIRO_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Cairo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// "-u-nu-latn" keeps Arabic weekday/month names from ar-EG while forcing
// Western digits for the day number, matching the Western digits used
// elsewhere on screen (clock times, money, phone numbers).
const CAIRO_DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  timeZone: "Africa/Cairo",
  weekday: "long",
  day: "numeric",
  month: "long",
});

// Africa/Cairo observes DST (Egypt reinstated it in 2023: UTC+2 in winter,
// UTC+3 in summer), so its offset cannot be hardcoded — it must be read from
// the timezone database for the specific instant in question.
const CAIRO_INSTANT_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? "00";
}

/** Africa/Cairo's UTC offset, in minutes, at the given instant. */
function cairoOffsetMinutes(instant: Date): number {
  const parts = CAIRO_INSTANT_FORMATTER.formatToParts(instant);
  const wallClockAsUtc = Date.UTC(
    Number(partValue(parts, "year")),
    Number(partValue(parts, "month")) - 1,
    Number(partValue(parts, "day")),
    Number(partValue(parts, "hour")),
    Number(partValue(parts, "minute")),
    Number(partValue(parts, "second")),
  );
  return (wallClockAsUtc - instant.getTime()) / 60_000;
}

/** Today's clinic day in Africa/Cairo, derived from the current instant (or a given one). */
export function todayInCairo(now: Date = new Date()): ClinicDay {
  const parts = CAIRO_DATE_FORMATTER.formatToParts(now);
  return `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`;
}

/**
 * The calendar year an instant falls on in Africa/Cairo — not UTC, so an
 * instant shortly after midnight UTC on January 1st that is still December
 * 31st in Cairo (or the reverse, near the other end of the day) lands in the
 * correct local year. Used to bucket invoice numbering per calendar year.
 */
export function cairoYear(instant: Instant): number {
  return Number(todayInCairo(new Date(instant)).slice(0, 4));
}

/** The weekday (0 = Sunday .. 6 = Saturday) of a clinic day. Calendar math only, no timezone conversion needed. */
export function weekdayOf(day: ClinicDay): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/**
 * The most recent clinic day on or before `day` that falls on `targetWeekday`
 * (0 = Sunday .. 6 = Saturday). Deterministic given its inputs — used to pin
 * seed data to a fixed weekday regardless of which day the seed happens to
 * run on. Calendar math only, no timezone conversion needed.
 */
export function mostRecentWeekdayOnOrBefore(day: ClinicDay, targetWeekday: number): ClinicDay {
  const [year, month, date] = day.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, date));
  const daysBack = (result.getUTCDay() - targetWeekday + 7) % 7;
  result.setUTCDate(result.getUTCDate() - daysBack);
  const resultYear = result.getUTCFullYear();
  const resultMonth = String(result.getUTCMonth() + 1).padStart(2, "0");
  const resultDate = String(result.getUTCDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDate}`;
}

/** The clinic day `days` calendar days after the given one (days may be negative). Calendar math only, no timezone conversion needed. */
export function addDaysToClinicDay(day: ClinicDay, days: number): ClinicDay {
  const [year, month, date] = day.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, date + days));
  const resultYear = result.getUTCFullYear();
  const resultMonth = String(result.getUTCMonth() + 1).padStart(2, "0");
  const resultDate = String(result.getUTCDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDate}`;
}

/** The Africa/Cairo clock time ("HH:MM") an instant falls on. */
export function clockTimeInCairo(instant: Instant): ClockTime {
  const parts = CAIRO_TIME_FORMATTER.formatToParts(new Date(instant));
  return `${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

/** The UTC instant corresponding to a clinic day and clock time in Africa/Cairo. */
export function cairoInstant(day: ClinicDay, time: ClockTime): Instant {
  const naiveUtc = new Date(`${day}T${time}:00Z`);
  const offsetMinutes = cairoOffsetMinutes(naiveUtc);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000).toISOString();
}

function cairoDisplayDateParts(day: ClinicDay): Intl.DateTimeFormatPart[] {
  const [year, month, date] = day.split("-").map(Number);
  return CAIRO_DISPLAY_DATE_FORMATTER.formatToParts(new Date(Date.UTC(year, month - 1, date, 12)));
}

/** A clinic day formatted the way an Egyptian clinic assistant reads a date: Arabic weekday, day number, Arabic month. */
export function formatCairoDisplayDate(day: ClinicDay): string {
  return cairoDisplayDateParts(day)
    .map((part) => part.value)
    .join("");
}

/**
 * The same display date, split into parts so the caller can isolate the
 * numeric day part (a Latin digit run) from the surrounding Arabic weekday
 * and month names, instead of forcing the whole string left-to-right.
 */
export function formatCairoDisplayDateParts(day: ClinicDay): readonly Intl.DateTimeFormatPart[] {
  return cairoDisplayDateParts(day);
}
