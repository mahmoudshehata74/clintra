import { generateSlotTimes } from "../../domain/schedule";
import { isOutsideWorkingHours } from "../../domain/scheduleExceptions";
import { clockTimeInCairo, type ClockTime } from "../../domain/time";
import type { Schedule, Visit } from "../../db/types";

export interface GridRow {
  time: ClockTime;
  /** Absent for a genuinely empty slot. */
  visit: Visit | null;
  /**
   * True for every visit after the first sharing this clock time — the
   * group's "primary" occupant is whichever visit sorts first by position,
   * normally the plain slot-grid visit; every additional one sharing the
   * time (only possible through the explicit overbook flow) is marked.
   */
  isExtraAtTime: boolean;
  /**
   * Set (true) on a still-active visit outside the day's hours — the day's
   * own interval changed by a schedule exception, or the date closed
   * (domain/scheduleExceptions.ts). Such a visit has no slot to sit in, so
   * it gets its own row at its time, never dropped and never cancelled.
   */
  isOutsideHours?: true;
}

/**
 * One row per visit, not one row per scheduled slot time: before
 * overbooking, at most one visit ever shared a clock time, so those were the
 * same thing. Overbooking can now put more than one visit at the same time,
 * and the grid's contract is a single time-ordered narrative an assistant
 * scans top to bottom — a write that succeeds without a visible row would
 * violate that, so every visit at a shared time gets its own row, grouped
 * together and sorted by position, with the extras marked.
 */
export function computeGridRows(schedule: Schedule, visits: readonly Visit[]): GridRow[] {
  const visitsByTime = new Map<ClockTime, Visit[]>();
  for (const visit of visits) {
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

  const rows: GridRow[] = [];
  for (const time of generateSlotTimes(schedule)) {
    const visitsAtTime = visitsByTime.get(time);
    if (!visitsAtTime || visitsAtTime.length === 0) {
      rows.push({ time, visit: null, isExtraAtTime: false });
      continue;
    }

    const sorted = [...visitsAtTime].sort((a, b) => a.position - b.position);
    sorted.forEach((visit, index) => {
      rows.push({ time, visit, isExtraAtTime: index > 0 });
    });
  }

  const outside = visits
    .filter((visit) => visit.scheduled_at && isOutsideWorkingHours(visit, schedule))
    .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!) || a.position - b.position);
  return outside.length === 0 ? rows : mergeByTime(rows, outside.map(outsideRow));
}

function outsideRow(visit: Visit): GridRow {
  return { time: clockTimeInCairo(visit.scheduled_at!), visit, isExtraAtTime: false, isOutsideHours: true };
}

/** `rows` and `extra`, each already in time order, as one time-ordered list (a row of `rows` first at an equal time). */
function mergeByTime(rows: readonly GridRow[], extra: readonly GridRow[]): GridRow[] {
  const merged: GridRow[] = [];
  let next = 0;
  for (const row of rows) {
    while (next < extra.length && extra[next].time < row.time) {
      merged.push(extra[next++]);
    }
    merged.push(row);
  }
  return [...merged, ...extra.slice(next)];
}

/**
 * The rows of a closed date (a schedule exception): no slot at all, just
 * each still-active timed visit at its time, every one outside working hours.
 */
export function closedDayRows(visits: readonly Visit[]): GridRow[] {
  return visits
    .filter((visit) => visit.scheduled_at && isOutsideWorkingHours(visit, undefined))
    .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!) || a.position - b.position)
    .map(outsideRow);
}
