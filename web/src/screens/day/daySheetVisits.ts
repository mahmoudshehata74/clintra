import type { Visit } from "../../db/types";
import { occupiesSlot } from "../../domain/visitStatus";

/**
 * The visits a day sheet prints for one practitioner+location's day: only
 * those still occupying a slot (see domain/visitStatus.ts's occupiesSlot —
 * excludes cancelled, no-show and rescheduled), ordered the way staff read
 * the printed page: by scheduled_at in slots mode, by position in queue
 * mode, since scheduled_at is always null in queue mode.
 */
export function selectDaySheetVisits(visits: readonly Visit[], isQueueMode: boolean): Visit[] {
  const active = visits.filter((visit) => occupiesSlot(visit.status));
  return [...active].sort((a, b) =>
    isQueueMode ? a.position - b.position : (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""),
  );
}
