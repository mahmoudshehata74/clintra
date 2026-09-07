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

// Only a patient still genuinely expected counts as remaining. Anyone who
// already arrived is no longer "remaining" (they are here), and a cancelled
// or no_show visit is not coming at all — counting either as remaining would
// tell the doctor people are still on their way when nobody is.
const STILL_EXPECTED = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed]);

/**
 * Counts visible today: total booked (every visit dated today, whatever its
 * current status), arrived (reached at least the arrived stage), completed,
 * and remaining (booked or confirmed only — not yet arrived, not cancelled,
 * not a no-show). Always derived from the visit records passed in, never
 * stored.
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
    if (STILL_EXPECTED.has(visit.status)) {
      remaining += 1;
    }
  }

  return { total: visits.length, arrived, completed, remaining };
}
