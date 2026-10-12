import type { SyncReview } from "../db/types";

// Every syncable table (sync/syncableTables.ts — reviewSummary.test.ts holds
// each one to a label here), so no assistant ever reads a raw English table
// name. "device" is the one non-syncable entry: the sync engine's own
// device_series_conflict row (sync/engine.ts's recordDeviceSeries), never an
// op.
const ENTITY_LABELS: Record<string, string> = {
  cash_close: "إغلاق اليوم",
  day_state: "حالة اليوم",
  invoice_items: "بند في فاتورة",
  invoices: "فاتورة",
  membership_locations: "فرع موظف",
  membership_practitioners: "دكتور تابع لموظف",
  memberships: "موظف",
  patients: "مريض",
  payments: "دفعة",
  practitioners: "بيانات طبيب",
  prescription_items: "دواء في وصفة",
  prescriptions: "وصفة",
  schedules: "مواعيد العمل",
  service_price_overrides: "سعر خاص لخدمة",
  services: "خدمة",
  visit_form_data: "نموذج الزيارة",
  visits: "زيارة",
  device: "الجهاز",
};

// Every reason api/app/Support/Sync/SyncOpApplier.php's `rejected(...)`
// can actually produce, plus FakeTransport's own generic one — see
// api/docs/rls.md's "The sync push endpoint".
const REASON_LABELS: Record<string, string> = {
  conflict_slot_taken: "الميعاد ده اتحجز من جهاز تاني",
  conflict_already_exists: "السجل ده موجود بالفعل على السيرفر",
  conflict_day_closed: "اليوم ده مقفول، مينفعش يتعدّل",
  conflict_stale_rev: "حد غيّر البيانات دي قبلك",
  series_mismatch: "الرقم ده مش من سلسلة أرقام الجهاز ده",
  number_immutable: "الرقم ده اتطبع، مينفعش يتغيّر",
  conflict_number_taken: "الرقم ده متسجّل قبل كده على السيرفر",
  conflict_visit_has_prescription: "الزيارة دي ليها وصفة بالفعل من جهاز تاني",
  prescription_printed: "الوصفة دي اتطبعت، مينفعش تتعدّل",
  practitioner_not_editable: "بيانات الطبيب دي مينفعش تتغيّر من الجهاز، غير الاسم واللقب ورقم النقابة",
  practitioner_profile_invalid: "بيانات الطبيب دي ناقصة أو غلط: الاسم مطلوب ورقم النقابة 50 حرف بالكتير",
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
