import { describe, expect, it } from "vitest";
import { formatPiastresForDisplay, parsePoundsToPiastres, type Piastres } from "./money";

describe("parsePoundsToPiastres", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["0", 0],
    ["0.01", 1],
  ])("parses %s into %i piastres", (input, expected) => {
    const result = parsePoundsToPiastres(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(expected);
    }
  });

  it("rounds a third fraction digit of 5 or more up into the second digit", () => {
    const result = parsePoundsToPiastres("12.505");
    expect(result).toEqual({ ok: true, value: 1251 });
  });

  it("does not round up a third fraction digit below 5", () => {
    const result = parsePoundsToPiastres("12.504");
    expect(result).toEqual({ ok: true, value: 1250 });
  });

  it("carries a rounded-up fraction into the next whole pound", () => {
    const result = parsePoundsToPiastres("0.999");
    expect(result).toEqual({ ok: true, value: 100 });
  });

  it.each(["", "abc", "-5", "12.", "12.5.6", "1,200", "12 34"])(
    "rejects malformed amount %s",
    (input) => {
      expect(parsePoundsToPiastres(input)).toEqual({ ok: false, error: "invalid_amount" });
    },
  );
});

describe("formatPiastresForDisplay", () => {
  it.each([
    [0, "0.00 ج.م"],
    [1250, "12.50 ج.م"],
    [100000, "1000.00 ج.م"],
    [5, "0.05 ج.م"],
  ])("formats %i piastres as %s", (value, expected) => {
    expect(formatPiastresForDisplay(value as Piastres)).toBe(expected);
  });
});
