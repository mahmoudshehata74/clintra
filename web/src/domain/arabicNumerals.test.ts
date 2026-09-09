import { describe, expect, it } from "vitest";
import { toArabicIndicDigits } from "./arabicNumerals";

describe("toArabicIndicDigits", () => {
  it.each([
    [0, "٠"],
    [1, "١"],
    [4, "٤"],
    [6, "٦"],
    [11, "١١"],
    [123, "١٢٣"],
  ])("renders %i as %s", (value, expected) => {
    expect(toArabicIndicDigits(value)).toBe(expected);
  });

  it("drops a negative sign rather than misrendering it", () => {
    expect(toArabicIndicDigits(-5)).toBe("٥");
  });
});
