import { describe, expect, it } from "vitest";
import { formatAppBarDate } from "./appBarDate";

describe("formatAppBarDate", () => {
  it("formats the date line with Latin digits for day and year, Arabic month name", () => {
    // 2026-09-07 is a Monday.
    expect(formatAppBarDate("2026-09-07").dateLine).toBe("7 سبتمبر 2026");
  });

  it("formats the weekday line as the Arabic weekday name", () => {
    expect(formatAppBarDate("2026-09-07").weekdayLine).toBe("الاثنين");
  });

  it("does not shift the date across a UTC day boundary", () => {
    // The first of the month, which a naive UTC-midnight construction could
    // roll back a day under Cairo's UTC+2/+3 offset.
    expect(formatAppBarDate("2026-01-01").dateLine).toBe("1 يناير 2026");
  });
});
