import type { ClinicDay } from "./time";

// Long Arabic dates written the way the prototype writes them — no comma
// after the weekday ("الاثنين 7 سبتمبر", "الثلاثاء 8 سبتمبر 2026"), Latin
// digits. Built from the formatter's parts: its own pattern puts "،" after
// the weekday.
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  timeZone: "Africa/Cairo",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

interface LongDateParts {
  weekday: string;
  day: string;
  month: string;
  year: string;
}

function longDateParts(day: ClinicDay): LongDateParts {
  const [year, month, date] = day.split("-").map(Number);
  // Noon UTC: never across a date boundary in Africa/Cairo.
  const parts = LONG_DATE_FORMATTER.formatToParts(new Date(Date.UTC(year, month - 1, date, 12)));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: value("weekday"), day: value("day"), month: value("month"), year: value("year") };
}

/** "7 سبتمبر" */
export function formatDayMonthName(day: ClinicDay): string {
  const parts = longDateParts(day);
  return `${parts.day} ${parts.month}`;
}

/** "الاثنين 7 سبتمبر" */
export function formatWeekdayDayMonth(day: ClinicDay): string {
  const parts = longDateParts(day);
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

/** "الثلاثاء 8 سبتمبر 2026" */
export function formatWeekdayFullDate(day: ClinicDay): string {
  const parts = longDateParts(day);
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}
