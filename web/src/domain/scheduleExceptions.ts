import { ScheduleExceptionType, type Schedule, type ScheduleException, type Visit } from "../db/types";
import { clockTimeInCairo, weekdayOf, type ClinicDay } from "./time";
import { VisitStatus } from "./visitStatus";

/**
 * A doctor's exceptions to their weekly hours (settings → working hours,
 * "إجازات ومواعيد استثنائية"; docs/schema.md's v26 additions), one per date:
 * - closed: the doctor does not work that date;
 * - shifted with start_time and end_time: that date's hours are this one
 *   interval instead of the weekday's (the replacement interval). On a
 *   weekday the doctor is normally off, the day takes its mode and slot
 *   length from the doctor's first row at that location.
 * The schema's `extra` type and `shift_minutes` are not written.
 */

/** The exception a doctor has on `date`, if any. */
export function exceptionOn(exceptions: readonly ScheduleException[], practitionerId: string, date: ClinicDay): ScheduleException | undefined {
  return exceptions.find((exception) => exception.practitioner_id === practitionerId && exception.date === date);
}

/**
 * The schedule row a doctor works by on `date` at one location — the weekly
 * row for its weekday with that date's exception applied: none when the
 * date is closed, the row with that date's own hours when it has them.
 * `rows` are the doctor's rows at the location.
 */
export function scheduleOnDate(
  rows: readonly Schedule[],
  exceptions: readonly ScheduleException[],
  practitionerId: string,
  date: ClinicDay,
): Schedule | undefined {
  const weekday = weekdayOf(date);
  const weekly = rows.find((row) => row.practitioner_id === practitionerId && row.weekday === weekday);
  const exception = exceptionOn(exceptions, practitionerId, date);
  if (!exception) {
    return weekly;
  }
  if (exception.type === ScheduleExceptionType.Closed) {
    return undefined;
  }
  if (exception.type === ScheduleExceptionType.Shifted && exception.start_time && exception.end_time) {
    const base = weekly ?? rows.find((row) => row.practitioner_id === practitionerId);
    return base ? { ...base, weekday, start_time: exception.start_time, end_time: exception.end_time } : undefined;
  }
  return weekly;
}

/** Statuses of a visit still to be seen — the ones a closure or new hours leave without a place. */
export const ACTIVE_VISIT_STATUSES: ReadonlySet<string> = new Set([
  VisitStatus.Booked,
  VisitStatus.Confirmed,
  VisitStatus.Arrived,
  VisitStatus.InRoom,
]);

/**
 * Whether a still-active visit falls outside the doctor's hours that day:
 * the day is closed, or (slots) its time is not inside the day's interval.
 * A queue visit has no time, so only a closure puts it outside.
 */
export function isOutsideWorkingHours(visit: Visit, schedule: Schedule | undefined): boolean {
  if (!ACTIVE_VISIT_STATUSES.has(visit.status)) {
    return false;
  }
  if (!schedule) {
    return true;
  }
  if (!visit.scheduled_at) {
    return false;
  }
  const time = clockTimeInCairo(visit.scheduled_at);
  return time < schedule.start_time || time >= schedule.end_time;
}
