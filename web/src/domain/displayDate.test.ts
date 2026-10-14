import { describe, expect, it } from "vitest";
import { formatDayMonthName, formatWeekdayDayMonth, formatWeekdayFullDate } from "./displayDate";

describe("long dates", () => {
  it("reads the prototype's long dates without a comma, in Latin digits", () => {
    expect(formatDayMonthName("2026-09-07")).toBe("7 سبتمبر");
    expect(formatWeekdayDayMonth("2026-09-07")).toBe("الاثنين 7 سبتمبر");
    expect(formatWeekdayFullDate("2026-09-08")).toBe("الثلاثاء 8 سبتمبر 2026");
  });

  it("never crosses a date boundary in Cairo", () => {
    expect(formatWeekdayFullDate("2026-12-31")).toBe("الخميس 31 ديسمبر 2026");
    expect(formatWeekdayFullDate("2027-01-01")).toBe("الجمعة 1 يناير 2027");
  });
});
