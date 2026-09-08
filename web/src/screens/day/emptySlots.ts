import { generateSlotTimes } from "../../domain/schedule";
import { clockTimeInCairo, type ClockTime } from "../../domain/time";
import { occupiesSlot } from "../../domain/visitStatus";
import type { Schedule, Visit } from "../../db/types";

export interface EmptySlot {
  time: ClockTime;
  /**
   * A cancelled/no_show/rescheduled visit already at this time, if any, as
   * of when this list was computed — a hint only, for the booking sheet to
   * reuse that row's write. The write path re-checks the slot's current
   * state itself rather than trusting this snapshot, since it may go stale
   * between listing and confirming. When more than one freed visit shares
   * this time (possible once overbooking exists), this is simply one of
   * them; which one doesn't matter, since the write re-verifies by position.
   */
  existingVisit: Visit | null;
}

/**
 * Every slot in today's grid that is not currently occupied, in time order.
 * A time is occupied if ANY visit scheduled at it occupies its slot — not
 * merely the last one encountered. Before overbooking, at most one visit
 * ever shared a clock time, so this distinction was invisible; overbooking
 * can now put more than one visit at the same time, and a stale freed visit
 * must never hide a still-active one sharing that time.
 */
export function computeEmptySlots(
  schedule: Schedule,
  visitsForPractitioner: readonly Visit[],
): EmptySlot[] {
  const visitsByTime = new Map<ClockTime, Visit[]>();
  for (const visit of visitsForPractitioner) {
    if (!visit.scheduled_at) {
      continue;
    }
    const time = clockTimeInCairo(visit.scheduled_at);
    const group = visitsByTime.get(time);
    if (group) {
      group.push(visit);
    } else {
      visitsByTime.set(time, [visit]);
    }
  }

  const slots: EmptySlot[] = [];
  for (const time of generateSlotTimes(schedule)) {
    const visitsAtTime = visitsByTime.get(time) ?? [];
    if (visitsAtTime.some((visit) => occupiesSlot(visit.status))) {
      continue;
    }
    const existingVisit = visitsAtTime.find((visit) => !occupiesSlot(visit.status)) ?? null;
    slots.push({ time, existingVisit });
  }

  return slots;
}
