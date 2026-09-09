import { describe, expect, it } from "vitest";
import type { SyncReview } from "../db/types";
import { describeSyncReview } from "./reviewSummary";

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
    ...overrides,
  };
}

describe("describeSyncReview", () => {
  it("labels a known entity and reason in Arabic", () => {
    expect(describeSyncReview(makeReview())).toBe("زيارة — الميعاد ده اتحجز من جهاز تاني");
  });

  it("falls back to the raw entity name when unrecognised", () => {
    expect(describeSyncReview(makeReview({ entity: "invoices" }))).toContain("invoices");
  });

  it("falls back to the raw reason code when unrecognised", () => {
    expect(describeSyncReview(makeReview({ reason: "some_new_reason" }))).toContain("some_new_reason");
  });
});
