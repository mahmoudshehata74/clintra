import { generateSlotTimes } from "../../domain/schedule";
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

  return rows;
}
