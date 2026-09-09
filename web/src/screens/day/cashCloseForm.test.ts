import { describe, expect, it } from "vitest";
import type { Piastres } from "../../domain/money";
import { validateCashCloseForm } from "./cashCloseForm";

const EXPECTED = 10000 as Piastres;

describe("validateCashCloseForm", () => {
  it("accepts a matching amount with no note and reports zero difference", () => {
    const result = validateCashCloseForm({ totalCollectedInput: "100", note: "" }, EXPECTED);
    expect(result).toEqual({ ok: true, totalCollected: 10000, difference: 0, note: null });
  });

  it("rejects a malformed collected amount", () => {
    const result = validateCashCloseForm({ totalCollectedInput: "abc", note: "" }, EXPECTED);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ collectedError: expect.any(String) });
  });

  it("requires a note when the difference is not zero", () => {
    const result = validateCashCloseForm({ totalCollectedInput: "90", note: "" }, EXPECTED);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ noteError: expect.any(String) });
  });

  it("accepts a non-zero difference once a note is given", () => {
    const result = validateCashCloseForm({ totalCollectedInput: "90", note: "  ناقص شوية  " }, EXPECTED);
    expect(result).toEqual({ ok: true, totalCollected: 9000, difference: -1000, note: "ناقص شوية" });
  });

  it("does not require a note for a positive difference either", () => {
    const result = validateCashCloseForm({ totalCollectedInput: "110", note: "زيادة" }, EXPECTED);
    expect(result).toEqual({ ok: true, totalCollected: 11000, difference: 1000, note: "زيادة" });
  });
});
