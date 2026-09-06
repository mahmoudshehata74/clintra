import { describe, expect, it } from "vitest";
import { cairoInstant, clockTimeInCairo, todayInCairo, weekdayOf } from "./time";

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
