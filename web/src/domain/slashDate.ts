import type { ClinicDay } from "./time";

// Slash dates read as the prototype writes them ("30 / 9 / 2026", "15 / 8"):
// in the page's own right-to-left order, the day on the right. They render
// through components/SlashDate.tsx, never inside a left-to-right run.

/** "2026-10-27" → "27 / 10" */
export function formatSlashDayMonth(day: ClinicDay): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} / ${month}`;
}

/** "2026-10-27" → "27 / 10 / 2026" */
export function formatSlashDate(day: ClinicDay): string {
  const [year] = day.split("-");
  return `${formatSlashDayMonth(day)} / ${year}`;
}

const SLASH_DATE = /^\d{1,2} \/ \d{1,2}(?: \/ \d{4})?$/;

/** True for a whole "d / m" or "d / m / yyyy" string. */
export function isSlashDate(text: string): boolean {
  return SLASH_DATE.test(text);
}
