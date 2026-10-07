import { describe, expect, it } from "vitest";
import type { Piastres } from "../domain/money";
import { formatMoneyAmount } from "./money";

describe("formatMoneyAmount", () => {
  it("drops the fraction entirely when the piastres part is zero", () => {
    expect(formatMoneyAmount(1200 as Piastres)).toBe("12");
    expect(formatMoneyAmount(0 as Piastres)).toBe("0");
  });

  it("shows two fraction digits when the piastres part is non-zero", () => {
    expect(formatMoneyAmount(1250 as Piastres)).toBe("12.50");
    expect(formatMoneyAmount(1205 as Piastres)).toBe("12.05");
  });

  it("adds thousands separators to the pound part", () => {
    expect(formatMoneyAmount(123_456_00 as Piastres)).toBe("123,456");
    expect(formatMoneyAmount(123_456_78 as Piastres)).toBe("123,456.78");
    expect(formatMoneyAmount(1_000_00 as Piastres)).toBe("1,000");
  });

  it("keeps the sign on a negative amount", () => {
    expect(formatMoneyAmount(-1250 as Piastres)).toBe("-12.50");
  });
});
