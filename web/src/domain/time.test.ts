import { describe, expect, it } from "vitest";
import {
  addDaysToClinicDay,
  cairoInstant,
  clockTimeInCairo,
  formatCairoDisplayDate,
  mostRecentWeekdayOnOrBefore,
  todayInCairo,
  weekdayOf,
} from "./time";

describe("todayInCairo", () => {
  it("formats an instant as YYYY-MM-DD in Africa/Cairo", () => {
    // 2026-01-01T22:30:00Z is 2026-01-02 00:30 in Africa/Cairo (winter, UTC+2).
    expect(todayInCairo(new Date("2026-01-01T22:30:00Z"))).toBe("2026-01-02");
  });

  it("does not roll over before Cairo midnight", () => {
    // 2026-01-01T20:00:00Z is still 2026-01-01 22:00 in Africa/Cairo.
    expect(todayInCairo(new Date("2026-01-01T20:00:00Z"))).toBe("2026-01-01");
  });
});

describe("weekdayOf", () => {
  it.each([
    ["2026-09-06", 0], // Sunday
    ["2026-09-07", 1], // Monday
    ["2026-09-12", 6], // Saturday
  ])("returns weekday %i for %s", (day, expected) => {
    expect(weekdayOf(day)).toBe(expected);
  });
});

describe("mostRecentWeekdayOnOrBefore", () => {
  it("returns the same day when it already falls on the target weekday", () => {
    // 2026-09-07 is a Monday.
    expect(mostRecentWeekdayOnOrBefore("2026-09-07", 1)).toBe("2026-09-07");
  });

  it("steps back within the same month", () => {
    // 2026-09-12 is a Saturday; the Monday before it is 2026-09-07.
    expect(mostRecentWeekdayOnOrBefore("2026-09-12", 1)).toBe("2026-09-07");
  });

  it("steps back across a month boundary", () => {
    // 2026-09-06 is a Sunday; the Monday before it is 2026-08-31.
    expect(mostRecentWeekdayOnOrBefore("2026-09-06", 1)).toBe("2026-08-31");
  });
});

describe("addDaysToClinicDay", () => {
  it("adds days within the same month", () => {
    expect(addDaysToClinicDay("2026-09-06", 3)).toBe("2026-09-09");
  });

  it("adds days across a month boundary", () => {
    expect(addDaysToClinicDay("2026-09-28", 5)).toBe("2026-10-03");
  });

  it("subtracts days with a negative offset", () => {
    expect(addDaysToClinicDay("2026-09-06", -1)).toBe("2026-09-05");
  });

  it("returns the same day for an offset of zero", () => {
    expect(addDaysToClinicDay("2026-09-06", 0)).toBe("2026-09-06");
  });
});

describe("clockTimeInCairo", () => {
  it("formats an instant as HH:MM in Africa/Cairo during summer (UTC+3)", () => {
    expect(clockTimeInCairo("2026-09-06T07:00:00.000Z")).toBe("10:00");
  });

  it("formats an instant as HH:MM in Africa/Cairo during winter (UTC+2)", () => {
    expect(clockTimeInCairo("2026-01-15T07:00:00.000Z")).toBe("09:00");
  });

  it("pads single-digit hours and minutes", () => {
    expect(clockTimeInCairo("2026-09-06T01:05:00.000Z")).toBe("04:05");
  });
});

describe("cairoInstant", () => {
  it("converts a summer (UTC+3) clinic day and time to its UTC instant", () => {
    expect(cairoInstant("2026-09-06", "09:00")).toBe("2026-09-06T06:00:00.000Z");
  });

  it("converts a winter (UTC+2) clinic day and time to its UTC instant", () => {
    expect(cairoInstant("2026-01-15", "09:00")).toBe("2026-01-15T07:00:00.000Z");
  });

  it("round-trips with clockTimeInCairo", () => {
    const instant = cairoInstant("2026-09-06", "11:30");
    expect(clockTimeInCairo(instant)).toBe("11:30");
  });
});

describe("formatCairoDisplayDate", () => {
  it("renders the Arabic weekday, Western day number and Arabic month", () => {
    // 2026-09-07 is a Monday.
    expect(formatCairoDisplayDate("2026-09-07")).toBe("الاثنين، 7 سبتمبر");
  });

  it("uses Western digits for the day number, not Arabic-Indic", () => {
    expect(formatCairoDisplayDate("2026-09-07")).not.toMatch(/[٠-٩]/);
  });
});
