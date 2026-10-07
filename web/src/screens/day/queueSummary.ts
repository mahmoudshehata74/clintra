import type { Visit } from "../../db/types";
import { clockTimeInCairo, type ClockTime, type Instant } from "../../domain/time";
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

export interface QueueCellCounts {
  completedCount: number;
  inRoomCount: number;
  totalCount: number;
  /** How many of today's visits reached a final state (completed, cancelled or no-show). */
  finalStateCount: number;
  /** finalStateCount / totalCount, as a whole percentage (0 on an empty queue). */
  splitSharePercent: number;
}

// Terminal: nothing further happens to the visit today — the same meaning
// daySlab.ts's own split bar uses for slots mode.
const TERMINAL_STATUSES = new Set<VisitStatus>([VisitStatus.Completed, VisitStatus.Cancelled, VisitStatus.NoShow]);

/** The queue summary slab's cell counts and split-bar share, beyond what computeQueueSummary already gives. */
export function computeQueueCellCounts(visits: readonly Visit[]): QueueCellCounts {
  let completedCount = 0;
  let inRoomCount = 0;
  let finalStateCount = 0;

  for (const visit of visits) {
    if (visit.status === VisitStatus.Completed) {
      completedCount += 1;
    }
    if (visit.status === VisitStatus.InRoom) {
      inRoomCount += 1;
    }
    if (TERMINAL_STATUSES.has(visit.status)) {
      finalStateCount += 1;
    }
  }

  const totalCount = visits.length;
  const splitSharePercent = totalCount > 0 ? Math.round((finalStateCount / totalCount) * 100) : 0;
  return { completedCount, inRoomCount, totalCount, finalStateCount, splitSharePercent };
}

/**
 * The queue slab's "يتوقع خلاص {time}" caption: `now` plus one average
 * consult per remaining turn (every waiting visit, plus the one currently in
 * the room, each counted as a full average — this never tracks how far into
 * a running consult the in-room visit already is). Null whenever there is no
 * average yet, or nobody left to see.
 */
export function computeQueueExpectedFinishTime(
  waitingCount: number,
  inRoomCount: number,
  avgConsultMinutes: number | null,
  now: Instant,
): ClockTime | null {
  const remainingTurns = waitingCount + inRoomCount;
  if (avgConsultMinutes === null || remainingTurns === 0) {
    return null;
  }
  const finishInstant = new Date(new Date(now).getTime() + remainingTurns * avgConsultMinutes * 60_000).toISOString();
  return clockTimeInCairo(finishInstant);
}
