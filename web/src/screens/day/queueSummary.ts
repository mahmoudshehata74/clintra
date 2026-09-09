import type { Visit } from "../../db/types";
import { VisitStatus } from "../../domain/visitStatus";

export interface QueueSummary {
  /** Position of the in_room visit, or the earliest waiting (booked/arrived) visit if none is in_room; null if there is neither. */
  currentTurnPosition: number | null;
  /** Count of booked/arrived visits — waiting, not yet in_room. */
  waitingCount: number;
  /** The waiting visit with the lowest position — "التالي" — or null if none are waiting. */
  nextVisitId: string | null;
}

const WAITING_STATUSES = new Set<VisitStatus>([VisitStatus.Booked, VisitStatus.Arrived]);

/**
 * The queue header's summary line, per the specification's counter
 * definitions: "الدور دلوقتي" is whoever is being seen right now, or
 * whoever is first in line if no one is; "مستنيين" counts everyone still
 * waiting. At most one visit is expected to be in_room at a time in queue
 * mode; if more than one somehow is, the first found is used.
 */
export function computeQueueSummary(visits: readonly Visit[]): QueueSummary {
  const inRoomVisit = visits.find((visit) => visit.status === VisitStatus.InRoom) ?? null;
  const waitingVisits = [...visits]
    .filter((visit) => WAITING_STATUSES.has(visit.status))
    .sort((a, b) => a.position - b.position);
  const nextVisit = waitingVisits[0] ?? null;

  return {
    currentTurnPosition: inRoomVisit ? inRoomVisit.position : (nextVisit?.position ?? null),
    waitingCount: waitingVisits.length,
    nextVisitId: nextVisit?.id ?? null,
  };
}

/**
 * How many minutes until a waiting visit at `position` is expected to be
 * called: how many turns away it is from the current one, times the median
 * consult length. Never negative — a position at or before the current turn
 * (should not happen for a genuinely waiting visit, but is not this
 * function's job to validate) reads as "about to be called" rather than a
 * negative number.
 */
export function computeExpectedWaitMinutes(
  position: number,
  currentTurnPosition: number,
  avgConsultMinutes: number,
): number {
  return Math.max(0, position - currentTurnPosition) * avgConsultMinutes;
}
