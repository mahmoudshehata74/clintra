import { generateSlotTimes } from "../../domain/schedule";
import { clockTimeInCairo, type ClockTime } from "../../domain/time";
import { occupiesSlot } from "../../domain/visitStatus";
import type { Schedule, Visit } from "../../db/types";

export interface EmptySlot {
  time: ClockTime;
  /**
   * The cancelled/no_show/rescheduled visit already occupying this slot, if
   * any, as of when this list was computed. Only a hint for the booking
   * sheet — the write path re-checks the slot's current state itself rather
   * than trusting this snapshot, since it may go stale between listing and
   * confirming.
   */
  existingVisit: Visit | null;
}

/** Every slot in today's grid that is not currently occupied, in time order. */
export function computeEmptySlots(
  schedule: Schedule,
  visitsForPractitioner: readonly Visit[],
): EmptySlot[] {
  const visitsByTime = new Map<ClockTime, Visit>();
  for (const visit of visitsForPractitioner) {
    if (visit.scheduled_at) {
      visitsByTime.set(clockTimeInCairo(visit.scheduled_at), visit);
    }
  }

  return generateSlotTimes(schedule)
    .map((time) => ({ time, existingVisit: visitsByTime.get(time) ?? null }))
    .filter(({ existingVisit }) => !existingVisit || !occupiesSlot(existingVisit.status));
}
