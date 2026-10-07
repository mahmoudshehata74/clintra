import type { ClinicDay } from "../domain/time";

// A small formatter of its own, deliberately not added to domain/time.ts —
// this task leaves every domain/ module untouched. Mirrors that module's own
// noon-UTC construction trick (avoids any DST/date-boundary edge case) and
// its "-u-nu-latn" locale override (Arabic names, Latin digits).
const DATE_LINE_FORMATTER = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  timeZone: "Africa/Cairo",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const WEEKDAY_LINE_FORMATTER = new Intl.DateTimeFormat("ar-EG", {
  timeZone: "Africa/Cairo",
  weekday: "long",
});

export interface AppBarDate {
  /** e.g. "7 سبتمبر 2026" — Latin digits for the day and year. */
  dateLine: string;
  /** e.g. "الاثنين". */
  weekdayLine: string;
}

/** The app bar's two-line date block (`.appbar .date .a` / `.b`): day+month+year, then the weekday name. */
export function formatAppBarDate(day: ClinicDay): AppBarDate {
  const [year, month, date] = day.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, date, 12));
  return {
    dateLine: DATE_LINE_FORMATTER.format(instant),
    weekdayLine: WEEKDAY_LINE_FORMATTER.format(instant),
  };
}
