import { describe, expect, it } from "vitest";
import { formatSlashDate, formatSlashDayMonth, isSlashDate } from "./slashDate";

describe("slash dates", () => {
  it("reads d / m and d / m / yyyy without leading zeros", () => {
    expect(formatSlashDayMonth("2026-08-05")).toBe("5 / 8");
    expect(formatSlashDate("2026-11-15")).toBe("15 / 11 / 2026");
    expect(formatSlashDate("2026-09-30")).toBe("30 / 9 / 2026");
    expect(formatSlashDate("2027-01-05")).toBe("5 / 1 / 2027");
  });

  it.each([
    ["5 / 8", true],
    ["15 / 11 / 2026", true],
    ["9:30", false],
    ["2,500", false],
    ["15/8", false],
    ["14 / 10 · 9:30", false],
  ])("isSlashDate(%s) is %s", (text, expected) => {
    expect(isSlashDate(text)).toBe(expected);
  });
});
