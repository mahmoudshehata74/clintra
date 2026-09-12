import type { SyncReview } from "../db/types";

// Only entities mutate() ever writes today; see fakeTransport.ts's
// tableForEntity for the matching list.
const ENTITY_LABELS: Record<string, string> = {
  visits: "زيارة",
  patients: "مريض",
  day_state: "حالة اليوم",
};

// Every reason api/app/Support/Sync/SyncOpApplier.php's `rejected(...)`
// can actually produce, plus FakeTransport's own generic one — see
// api/docs/rls.md's "The sync push endpoint" for the four.
const REASON_LABELS: Record<string, string> = {
  conflict_slot_taken: "الميعاد ده اتحجز من جهاز تاني",
  conflict_already_exists: "السجل ده موجود بالفعل على السيرفر",
  conflict_day_closed: "اليوم ده مقفول، مينفعش يتعدّل",
  conflict_stale_rev: "حد غيّر البيانات دي قبلك",
  conflict: "فيه تعارض في البيانات",
};

/**
 * A short, stable, quotable reference the assistant can read out over the
 * phone to support — derived from the review row's own id, never stored
 * separately, so there is nothing extra to keep in sync. Deliberately not
 * the raw `reason` string: docs/sync-plan.md's Q11 already established
 * this same principle for a `failed` op's escalation
 * (sync/engine.ts's describeFailedOpEscalation), and this closes the
 * matching gap for a `rejected` one — no assistant ever sees a SQLSTATE,
 * an English error string, or any other raw machine code, recognised or
 * not.
 */
function referenceCodeFor(review: SyncReview): string {
  return review.id.slice(0, 8).toUpperCase();
}

/** A short human-readable summary of one sync_review row, for the needs-review list. */
export function describeSyncReview(review: SyncReview): string {
  const entityLabel = ENTITY_LABELS[review.entity] ?? review.entity;
  const reasonLabel = REASON_LABELS[review.reason] ?? `فيه مشكلة تقنية — كود المرجع: ${referenceCodeFor(review)}`;
  return `${entityLabel} — ${reasonLabel}`;
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export interface ReviewFieldDiff {
  field: string;
  mine: string;
  server: string;
}

/**
 * Every field that differs between two versions of the same row, for the
 * review sheet's side-by-side comparison (docs/sync-plan.md's Q6: "the
 * assistant must see what she is choosing between before choosing").
 * Generic across entity types (visits, patients, day_state, ...) rather
 * than a per-entity layout — docs/reference/clintra-screens.html has no
 * screen for this flow at all (checked: no "مراجعة تعارض" design exists;
 * "screen 17" is the staff/permissions settings table, unrelated). A
 * field present on only one side is shown against "—", not hidden.
 */
export function describeReviewFieldDiffs(mine: unknown, server: unknown): ReviewFieldDiff[] {
  const mineObj = (mine ?? {}) as Record<string, unknown>;
  const serverObj = (server ?? {}) as Record<string, unknown>;
  const fields = Array.from(new Set([...Object.keys(mineObj), ...Object.keys(serverObj)])).sort();

  const diffs: ReviewFieldDiff[] = [];
  for (const field of fields) {
    const mineValue = stringifyFieldValue(mineObj[field]);
    const serverValue = stringifyFieldValue(serverObj[field]);
    if (mineValue !== serverValue) {
      diffs.push({ field, mine: mineValue, server: serverValue });
    }
  }
  return diffs;
}
