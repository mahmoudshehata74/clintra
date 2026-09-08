import { describe, expect, it } from "vitest";
import { effectiveStartTime } from "./dayDelay";

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
