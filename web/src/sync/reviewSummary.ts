import type { SyncReview } from "../db/types";

// Only entities mutate() ever writes today; see fakeTransport.ts's
// tableForEntity for the matching list.
const ENTITY_LABELS: Record<string, string> = {
  visits: "زيارة",
  patients: "مريض",
  day_state: "حالة اليوم",
};

// Only reasons FakeTransport currently produces; unrecognised reasons fall
// back to the raw machine code rather than hiding the information.
const REASON_LABELS: Record<string, string> = {
  conflict_slot_taken: "الميعاد ده اتحجز من جهاز تاني",
  conflict: "فيه تعارض في البيانات",
};

/** A short human-readable summary of one sync_review row, for the needs-review list. */
export function describeSyncReview(review: SyncReview): string {
  const entityLabel = ENTITY_LABELS[review.entity] ?? review.entity;
  const reasonLabel = REASON_LABELS[review.reason] ?? review.reason;
  return `${entityLabel} — ${reasonLabel}`;
}
