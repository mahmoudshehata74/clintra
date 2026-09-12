/** Every state a visit can occupy. Transitions between them are governed by transitions.ts. */
export const VisitStatus = {
  Booked: "booked",
  Confirmed: "confirmed",
  Arrived: "arrived",
  InRoom: "in_room",
  Completed: "completed",
  Cancelled: "cancelled",
  NoShow: "no_show",
  Rescheduled: "rescheduled",
} as const;

export type VisitStatus = (typeof VisitStatus)[keyof typeof VisitStatus];

/** Reason recorded when a visit becomes cancelled, no_show or rescheduled. no_show is a distinct status, not a merged reason. */
export const CancelReason = {
  Patient: "patient",
  Clinic: "clinic",
  NoShow: "no_show",
  Postpone: "postpone",
  /**
   * "Keep mine" on a lost slot conflict (sync/reviewActions.ts,
   * docs/sync-plan.md's Q7): the create that would have booked this slot
   * was rejected because another device's already-accepted visit holds
   * it. The patient's record survives — this status change is what keeps
   * the slot from looking confirmed, per Q7's own wording — but nothing
   * automatically finds it a new time; that's a manual rebooking.
   */
  SyncConflict: "sync_conflict",
} as const;

export type CancelReason = (typeof CancelReason)[keyof typeof CancelReason];

// Any status other than these means the slot is free again: the original
// booking was cancelled, the patient didn't show, or the visit moved
// elsewhere. Shared by the day screen's slot rendering (statusStyle.ts,
// which treats rescheduled as visually empty for the same reason), the
// booking sheet's slot listing, and the booking write path's own check at
// write time.
const OCCUPYING_VISIT_STATUSES = new Set<VisitStatus>([
  VisitStatus.Booked,
  VisitStatus.Confirmed,
  VisitStatus.Arrived,
  VisitStatus.InRoom,
  VisitStatus.Completed,
]);

/** True when a visit in this status still holds its slot; false once it's cancelled, a no-show, or rescheduled away. */
export function occupiesSlot(status: VisitStatus): boolean {
  return OCCUPYING_VISIT_STATUSES.has(status);
}
