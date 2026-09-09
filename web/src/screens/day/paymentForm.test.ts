import { describe, expect, it } from "vitest";
import type { Piastres } from "../../domain/money";
import { validatePaymentForm } from "./paymentForm";

const REMAINING = 10000 as Piastres;

describe("validatePaymentForm", () => {
  it("accepts a valid amount within the remaining balance", () => {
    const result = validatePaymentForm({ amountInput: "50" }, REMAINING);
    expect(result).toEqual({ ok: true, amount: 5000 });
  });

  it("accepts an amount that exactly equals the remaining balance", () => {
    const result = validatePaymentForm({ amountInput: "100" }, REMAINING);
    expect(result).toEqual({ ok: true, amount: 10000 });
  });

  it("rejects a malformed amount", () => {
    const result = validatePaymentForm({ amountInput: "abc" }, REMAINING);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ amountError: expect.any(String) });
  });

  it("rejects a zero amount", () => {
    const result = validatePaymentForm({ amountInput: "0" }, REMAINING);
    expect(result.ok).toBe(false);
  });

  it("rejects an amount greater than the remaining balance", () => {
    const result = validatePaymentForm({ amountInput: "100.01" }, REMAINING);
    expect(result.ok).toBe(false);
  });
});
