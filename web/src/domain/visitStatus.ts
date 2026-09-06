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

/** Reason recorded when a visit becomes cancelled or no_show. no_show is a distinct status, not a merged reason. */
export const CancelReason = {
  Patient: "patient",
  Clinic: "clinic",
  NoShow: "no_show",
} as const;

export type CancelReason = (typeof CancelReason)[keyof typeof CancelReason];
