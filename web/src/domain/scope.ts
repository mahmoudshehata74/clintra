/** Which locations a role's access covers: every location, or an explicit list. */
export const LocationScope = {
  All: "all",
  Listed: "listed",
} as const;

export type LocationScope = (typeof LocationScope)[keyof typeof LocationScope];

/** Which practitioners a role's access covers: every practitioner, an explicit list, or self only. */
export const PractitionerScope = {
  All: "all",
  Listed: "listed",
  Self: "self",
} as const;

export type PractitionerScope = (typeof PractitionerScope)[keyof typeof PractitionerScope];
