import { describe, expect, it } from "vitest";
import type { Piastres } from "../../domain/money";
import { expectedCash, parseOpeningAmount, validateCashCloseForm, type CashCloseFormState } from "./cashCloseForm";

const EXPECTED = 10000 as Piastres;

function state(overrides: Partial<CashCloseFormState> = {}): CashCloseFormState {
  return { openingInput: "0", totalCollectedInput: "100", note: "", pastDueCount: 0, acknowledgedPastDue: false, ...overrides };
}

describe("the opening float", () => {
  it("expected cash is the opening plus what the day collected", () => {
    expect(expectedCash(50000 as Piastres, EXPECTED)).toBe(60000);
    expect(expectedCash(0 as Piastres, EXPECTED)).toBe(EXPECTED);
  });

  it("reads blank as 0 and pounds as piastres; anything else does not parse", () => {
    expect(parseOpeningAmount("")).toBe(0);
    expect(parseOpeningAmount(" 500.50 ")).toBe(50050);
    expect(parseOpeningAmount("-5")).toBeNull();
    expect(parseOpeningAmount("خمسمية")).toBeNull();
  });

  it("with an opening, a matching count is opening plus collected, and anything else needs a note", () => {
    expect(validateCashCloseForm(state({ openingInput: "500", totalCollectedInput: "600" }), EXPECTED)).toEqual({
      ok: true,
      openingAmount: 50000,
      totalCollected: 60000,
      difference: 0,
      note: null,
    });
    expect(validateCashCloseForm(state({ openingInput: "500", totalCollectedInput: "100" }), EXPECTED)).toMatchObject({
      ok: false,
      noteError: expect.any(String),
    });
    expect(validateCashCloseForm(state({ openingInput: "500", totalCollectedInput: "100", note: "سحب من الدرج" }), EXPECTED)).toEqual({
      ok: true,
      openingAmount: 50000,
      totalCollected: 10000,
      difference: -50000,
      note: "سحب من الدرج",
    });
  });

  it("refuses an opening that does not parse, before the counted amount", () => {
    expect(validateCashCloseForm(state({ openingInput: "abc", totalCollectedInput: "abc" }), EXPECTED)).toMatchObject({
      ok: false,
      openingError: expect.any(String),
      collectedError: null,
    });
  });
});

describe("validateCashCloseForm", () => {
  it("accepts a matching amount with no note and reports zero difference", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "100" }), EXPECTED);
    expect(result).toEqual({ ok: true, openingAmount: 0, totalCollected: 10000, difference: 0, note: null });
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
    expect(result).toEqual({ ok: true, openingAmount: 0, totalCollected: 9000, difference: -1000, note: "ناقص شوية" });
  });

  it("does not require a note for a positive difference either", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "110", note: "زيادة" }), EXPECTED);
    expect(result).toEqual({ ok: true, openingAmount: 0, totalCollected: 11000, difference: 1000, note: "زيادة" });
  });

  it("refuses to close while past-due visits are unacknowledged, before checking the amount at all", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "abc", pastDueCount: 2 }), EXPECTED);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ pastDueError: expect.any(String), collectedError: null });
  });

  it("allows closing once the past-due list is acknowledged", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "100", pastDueCount: 2, acknowledgedPastDue: true }), EXPECTED);
    expect(result).toEqual({ ok: true, openingAmount: 0, totalCollected: 10000, difference: 0, note: null });
  });

  it("allows closing once the past-due count has dropped to zero, acknowledged or not", () => {
    const result = validateCashCloseForm(state({ totalCollectedInput: "100", pastDueCount: 0, acknowledgedPastDue: false }), EXPECTED);
    expect(result.ok).toBe(true);
  });
});
