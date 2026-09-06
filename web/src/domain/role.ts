/** The four roles a staff member can hold in a clinic. */
export const Role = {
  Owner: "owner",
  Practitioner: "practitioner",
  Assistant: "assistant",
  Manager: "manager",
} as const;

export type Role = (typeof Role)[keyof typeof Role];
