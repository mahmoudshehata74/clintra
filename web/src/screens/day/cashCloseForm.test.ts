import { describe, expect, it } from "vitest";
import type { Piastres } from "../../domain/money";
import { validateCashCloseForm, type CashCloseFormState } from "./cashCloseForm";

const EXPECTED = 10000 as Piastres;

function state(overrides: Partial<CashCloseFormState> = {}): CashCloseFormState {
  return { totalCollectedInput: "100", note: "", pastDueCount: 0, acknowledgedPastDue: false, ...overrides };
}

describe("validateCashCloseForm", () => {
  it("accepts a matching amount with no note and reports zero difference", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "100" }), EXPECTED);
    expect(result).toEqual({ ok: true, totalCollected: 10000, difference: 0, note: null });
  });

  it("rejects a malformed collected amount", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "abc" }), EXPECTED);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ collectedError: expect.any(String) });
  });

  it("requires a note when the difference is not zero", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "90" }), EXPECTED);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ noteError: expect.any(String) });
  });

  it("accepts a non-zero difference once a note is given", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "90", note: "  ناقص شوية  " }), EXPECTED);
    expect(result).toEqual({ ok: true, totalCollected: 9000, difference: -1000, note: "ناقص شوية" });
  });

  it("does not require a note for a positive difference either", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "110", note: "زيادة" }), EXPECTED);
    expect(result).toEqual({ ok: true, totalCollected: 11000, difference: 1000, note: "زيادة" });
  });

  it("refuses to close while past-due visits are unacknowledged, before checking the amount at all", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "abc", pastDueCount: 2 }), EXPECTED);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ pastDueError: expect.any(String), collectedError: null });
  });

  it("allows closing once the past-due list is acknowledged", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "100", pastDueCount: 2, acknowledgedPastDue: true }), EXPECTED);
    expect(result).toEqual({ ok: true, totalCollected: 10000, difference: 0, note: null });
  });

  it("allows closing once the past-due count has dropped to zero, acknowledged or not", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "100", pastDueCount: 0, acknowledgedPastDue: false }), EXPECTED);
    expect(result.ok).toBe(true);
  });
});
