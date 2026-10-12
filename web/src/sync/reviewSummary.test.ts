import { describe, expect, it } from "vitest";
import { AuditAction, type SyncReview } from "../db/types";
import { describeReviewFieldDiffs, describeSyncReview } from "./reviewSummary";
import { SYNCABLE_TABLES } from "./syncableTables";

function makeReview(overrides: Partial<SyncReview> = {}): SyncReview {
  return {
    id: "review-1",
    op_id: "op-1",
    entity: "visits",
    entity_id: "visit-1",
    reason: "conflict_slot_taken",
    payload: {},
    needs_review: true,
    created_at: "2026-09-07T06:00:00.000Z",
    action: AuditAction.Create,
    base_rev: null,
    ...overrides,
  };
}

describe("describeSyncReview", () => {
  it("labels a known entity and reason in Arabic", () => {
    expect(describeSyncReview(makeReview())).toBe("زيارة — الميعاد ده اتحجز من جهاز تاني");
  });

  it("falls back to the raw entity name when unrecognised", () => {
    expect(describeSyncReview(makeReview({ entity: "some_future_table" }))).toContain("some_future_table");
  });

  it.each(SYNCABLE_TABLES)("labels the syncable table %s in Arabic, never by its raw name", (entity) => {
    const description = describeSyncReview(makeReview({ entity }));
    expect(description).not.toContain(entity);
    expect(description.split(" — ")[0]).toMatch(/^[\u0600-\u06FF ]+$/);
  });

  it.each([
    ["series_mismatch", "الرقم ده مش من سلسلة أرقام الجهاز ده"],
    ["number_immutable", "الرقم ده اتطبع، مينفعش يتغيّر"],
    ["conflict_number_taken", "الرقم ده متسجّل قبل كده على السيرفر"],
    ["conflict_visit_has_prescription", "الزيارة دي ليها وصفة بالفعل من جهاز تاني"],
    ["prescription_printed", "الوصفة دي اتطبعت، مينفعش تتعدّل"],
  ])("labels %s in Arabic", (reason, label) => {
    expect(describeSyncReview(makeReview({ entity: "prescriptions", reason }))).toBe(`وصفة — ${label}`);
  });

  it("never shows the raw reason code when unrecognised — a stable reference code instead", () => {
    const description = describeSyncReview(makeReview({ reason: "some_new_reason" }));
    expect(description).not.toContain("some_new_reason");
    expect(description).toContain("كود المرجع");
    // The reference code is derived from the review's own id, stable and reproducible.
    expect(description).toContain("REVIEW-1");
  });
});

describe("describeReviewFieldDiffs", () => {
  it("returns only the fields that actually differ, formatted as strings", () => {
    const mine = { id: "1", full_name: "منى", phone: "+201000000000", note: null };
    const server = { id: "1", full_name: "منى فؤاد", phone: "+201000000000", note: "ملاحظة" };

    const diffs = describeReviewFieldDiffs(mine, server);

    expect(diffs).toEqual([
      { field: "full_name", mine: "منى", server: "منى فؤاد" },
      { field: "note", mine: "—", server: "ملاحظة" },
    ]);
  });

  it("shows a field present on only one side against an em dash, not hidden", () => {
    const diffs = describeReviewFieldDiffs({ a: 1 }, { a: 1, b: 2 });
    expect(diffs).toEqual([{ field: "b", mine: "—", server: "2" }]);
  });
});
