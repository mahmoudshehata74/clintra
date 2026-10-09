import type { Visit } from "../db/types";
import { VisitStatus } from "./visitStatus";

function completedDurationsInMinutes(visits: readonly Visit[]): number[] {
  return visits
    .filter(
      (visit): visit is Visit & { started_at: string; ended_at: string } =>
        visit.status === VisitStatus.Completed && visit.started_at !== null && visit.ended_at !== null,
    )
    .map((visit) => (new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60_000);
}

/** How many completed visits in the list have a recorded consultation length — used to gate extrapolation (see screens/day/queueSummary.ts). */
export function countCompletedConsultations(visits: readonly Visit[]): number {
  return completedDurationsInMinutes(visits).length;
}

/**
 * The median consultation length, in whole minutes, across every completed
 * visit in the given list. Median rather than mean: one unusually long visit
 * (an emergency, a difficult case) should not drag the figure staff and
 * patients rely on for setting expectations — see docs/schema.md's day_state
 * notes for why this statistic was chosen over the mean. Null when no
 * completed visit in the list has both started_at and ended_at recorded.
 */
export function computeMedianConsultMinutes(visits: readonly Visit[]): number | null {
  return computeRoundedMedian(completedDurationsInMinutes(visits));
}

/** The median of a list of minute counts, rounded to a whole minute; null for an empty list. */
export function computeRoundedMedian(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }

  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.round(median);
}
