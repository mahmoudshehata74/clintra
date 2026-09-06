/** How a visit was originated. */
export const VisitSource = {
  Phone: "phone",
  Walkin: "walkin",
  Recovered: "recovered",
} as const;

export type VisitSource = (typeof VisitSource)[keyof typeof VisitSource];
