/** How a clinic schedules visits: fixed time slots, or a walk-in queue. */
export const ScheduleMode = {
  Slots: "slots",
  Queue: "queue",
} as const;

export type ScheduleMode = (typeof ScheduleMode)[keyof typeof ScheduleMode];
