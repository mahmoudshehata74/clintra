import { describe, expect, it } from "vitest";
import { computeElapsedLabel, formatElapsedMinutes } from "./elapsedLabel";

describe("formatElapsedMinutes", () => {
  it("renders under an hour as plain minutes", () => {
    expect(formatElapsedMinutes(0)).toBe("0د");
    expect(formatElapsedMinutes(45)).toBe("45د");
    expect(formatElapsedMinutes(59)).toBe("59د");
  });

  it("renders exactly an hour with no minute remainder", () => {
    expect(formatElapsedMinutes(60)).toBe("1س");
    expect(formatElapsedMinutes(120)).toBe("2س");
  });

  it("renders hours plus a minute remainder", () => {
    expect(formatElapsedMinutes(75)).toBe("1س 15د");
    expect(formatElapsedMinutes(125)).toBe("2س 5د");
  });
});

describe("computeElapsedLabel", () => {
  const TODAY = "2026-09-07";
  // Noon Cairo on TODAY (UTC+3 in September).
  const NOW = new Date("2026-09-07T09:00:00.000Z");

  it("is null when the displayed day is not the real current Cairo day", () => {
    // A dev-only ?seedDay=1 pin, far behind the real now.
    expect(computeElapsedLabel("2026-08-01T09:00:00.000Z", NOW.toISOString(), "2026-08-03", NOW)).toBeNull();
  });

  it("formats the elapsed minutes when the displayed day is the real current day", () => {
    const from = new Date(NOW.getTime() - 27 * 60_000).toISOString();
    expect(computeElapsedLabel(from, NOW.toISOString(), TODAY, NOW)).toBe("27د");
  });

  it("formats a completed visit's fixed duration (from started_at to ended_at, not to now)", () => {
    const started = "2026-09-07T08:00:00.000Z";
    const ended = "2026-09-07T08:18:00.000Z";
    expect(computeElapsedLabel(started, ended, TODAY, NOW)).toBe("18د");
  });

  it("never goes negative", () => {
    const from = new Date(NOW.getTime() + 5 * 60_000).toISOString();
    expect(computeElapsedLabel(from, NOW.toISOString(), TODAY, NOW)).toBe("0د");
  });
});
