import { VisitStatus } from "../../domain/visitStatus";
import type { Visit } from "../../db/types";

export interface DayCounters {
  total: number;
  arrived: number;
  completed: number;
  remaining: number;
}

const ARRIVED_OR_LATER = new Set<string>([
  VisitStatus.Arrived,
  VisitStatus.InRoom,
  VisitStatus.Completed,
]);

// A visit no longer occupies today once it is done, cancelled, a no-show, or
// moved elsewhere by a reschedule.
const SETTLED = new Set<string>([
  VisitStatus.Completed,
  VisitStatus.Cancelled,
  VisitStatus.NoShow,
  VisitStatus.Rescheduled,
]);

/**
 * Counts visible today: total booked (every visit dated today, whatever its
 * current status), arrived (reached at least the arrived stage), completed,
 * and remaining (not yet settled). Always derived from the visit records
 * passed in, never stored.
 */
export function computeDayCounters(visits: readonly Visit[]): DayCounters {
  let arrived = 0;
  let completed = 0;
  let remaining = 0;

  for (const visit of visits) {
    if (ARRIVED_OR_LATER.has(visit.status)) {
      arrived += 1;
    }
    if (visit.status === VisitStatus.Completed) {
      completed += 1;
    }
    if (!SETTLED.has(visit.status)) {
      remaining += 1;
    }
  }

  return { total: visits.length, arrived, completed, remaining };
}
