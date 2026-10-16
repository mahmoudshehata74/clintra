import { describe, expect, it } from "vitest";
import { DELAY_MAX_MINUTES, effectiveStartTime, normalizeDelayDigits, parseDelayMinutes } from "./dayDelay";

describe("effectiveStartTime", () => {
  it("returns the schedule's own start time when there is no delay", () => {
    expect(effectiveStartTime("09:00", 0)).toBe("09:00");
  });

  it("adds the delay in minutes", () => {
    expect(effectiveStartTime("09:00", 30)).toBe("09:30");
  });

  it("carries over into the next hour", () => {
    expect(effectiveStartTime("09:45", 30)).toBe("10:15");
  });

  it("carries over multiple hours", () => {
    expect(effectiveStartTime("09:00", 125)).toBe("11:05");
  });
});

describe("parseDelayMinutes", () => {
  it("takes a whole number of minutes from 1 to 240", () => {
    expect(parseDelayMinutes("25")).toEqual({ ok: true, minutes: 25 });
    expect(parseDelayMinutes("1")).toEqual({ ok: true, minutes: 1 });
    expect(parseDelayMinutes(String(DELAY_MAX_MINUTES))).toEqual({ ok: true, minutes: 240 });
  });

  it("ignores surrounding spaces and a leading zero", () => {
    expect(parseDelayMinutes(" 45 ")).toEqual({ ok: true, minutes: 45 });
    expect(parseDelayMinutes("05")).toEqual({ ok: true, minutes: 5 });
  });

  it("reads Arabic-Indic digits as Latin ones", () => {
    expect(parseDelayMinutes("٢٥")).toEqual({ ok: true, minutes: 25 });
  });

  it("refuses empty, zero and more than four hours", () => {
    for (const text of ["", "   ", "0", "000", "241", "1000"]) {
      expect(parseDelayMinutes(text)).toEqual({ ok: false });
    }
  });

  it("refuses fractions, signs, units and letters", () => {
    for (const text of ["2.5", "2,5", "-5", "+5", "25د", "١٥ دقيقة", "abc", "1e2"]) {
      expect(parseDelayMinutes(text)).toEqual({ ok: false });
    }
  });
});

describe("normalizeDelayDigits", () => {
  it("turns Arabic-Indic digits into Latin ones and leaves everything else", () => {
    expect(normalizeDelayDigits("٠١٢٣٤٥٦٧٨٩ x")).toBe("0123456789 x");
  });
});
