import type { Schedule, Visit } from "../../db/types";
import { cairoInstant, clockTimeInCairo, todayInCairo, weekdayOf, type ClinicDay } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";

/**
 * The visits the day-close gate must see settled before the day closes: a
 * slot visit whose scheduled time has passed, or a queue visit (no
 * scheduled_at) whose practitioner has reached the end of their scheduled
 * day — in both cases only while still `booked` or `confirmed` (any other
 * status already left the slot, so it needs no attention here), and only on
 * the displayed day itself or an earlier one. A future day never reports any
 * past-due visit, however late "now" is.
 */
export function computePastDueVisits(
  visits: readonly Visit[],
  schedules: readonly Schedule[],
  displayedDay: ClinicDay,
  now: Date,
): Visit[] {
  const today = todayInCairo(now);
  if (displayedDay > today) {
    return [];
  }
  const isPastDay = displayedDay < today;
  const weekday = weekdayOf(displayedDay);

  return visits.filter((visit) => {
    if (visit.status !== VisitStatus.Booked && visit.status !== VisitStatus.Confirmed) {
      return false;
    }
    if (isPastDay) {
      return true;
    }
    if (visit.scheduled_at) {
      return new Date(visit.scheduled_at).getTime() < now.getTime();
    }
    const schedule = schedules.find(
      (candidate) =>
        candidate.practitioner_id === visit.practitioner_id &&
        candidate.location_id === visit.location_id &&
        candidate.weekday === weekday,
    );
    if (!schedule) {
      return false;
    }
    return new Date(cairoInstant(displayedDay, schedule.end_time)).getTime() < now.getTime();
  });
}

/**
 * A past-due row's leading label: a slot visit's own Cairo clock time, or —
 * for a queue visit, which has no scheduled_at — "{prefix} {position}"
 * (e.g. "نمرة 3"), the same way the queue itself names a waiting patient.
 */
export function pastDueVisitWhenLabel(visit: Visit, queueNumberPrefix: string): string {
  return visit.scheduled_at ? clockTimeInCairo(visit.scheduled_at) : `${queueNumberPrefix} ${visit.position}`;
}
