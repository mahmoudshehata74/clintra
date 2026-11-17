import { describe, expect, it } from "vitest";
import { effectiveScheduleMode, foldScheduleMode, ScheduleMode } from "./scheduleMode";

const SWITCHED = { mode: ScheduleMode.Slots, next_mode: ScheduleMode.Queue, next_mode_from: "2026-10-20" } as const;

describe("effectiveScheduleMode", () => {
  it("reads mode before next_mode_from and next_mode on and after it", () => {
    expect(effectiveScheduleMode(SWITCHED, "2026-10-19")).toBe(ScheduleMode.Slots);
    expect(effectiveScheduleMode(SWITCHED, "2026-10-20")).toBe(ScheduleMode.Queue);
    expect(effectiveScheduleMode(SWITCHED, "2026-10-21")).toBe(ScheduleMode.Queue);
    // Across a month and a year boundary, as the dates compare as text.
    const fromNewYear = { ...SWITCHED, next_mode_from: "2027-01-01" };
    expect(effectiveScheduleMode(fromNewYear, "2026-12-31")).toBe(ScheduleMode.Slots);
    expect(effectiveScheduleMode(fromNewYear, "2027-01-01")).toBe(ScheduleMode.Queue);
  });

  it("reads mode on every day with no switch pending, the fields null or absent", () => {
    for (const date of ["2020-01-01", "2026-10-20", "2030-06-15"]) {
      expect(effectiveScheduleMode({ mode: ScheduleMode.Queue }, date)).toBe(ScheduleMode.Queue);
      expect(effectiveScheduleMode({ mode: ScheduleMode.Queue, next_mode: null, next_mode_from: null }, date)).toBe(
        ScheduleMode.Queue,
      );
    }
  });
});

describe("foldScheduleMode", () => {
  it("folds a switch that started before today or today: mode becomes next_mode, both next_* cleared", () => {
    expect(foldScheduleMode({ ...SWITCHED, weekday: 2 }, "2026-10-21")).toEqual({
      mode: ScheduleMode.Queue,
      next_mode: null,
      next_mode_from: null,
      weekday: 2,
    });
    expect(foldScheduleMode(SWITCHED, "2026-10-20")).toEqual({ mode: ScheduleMode.Queue, next_mode: null, next_mode_from: null });
  });

  it("leaves a switch still to come, and a row with none, exactly as it is", () => {
    expect(foldScheduleMode(SWITCHED, "2026-10-19")).toBe(SWITCHED);
    const plain = { mode: ScheduleMode.Slots };
    expect(foldScheduleMode(plain, "2026-10-19")).toBe(plain);
  });

  it("changes no day's mode from today on", () => {
    const today = "2026-10-22";
    const folded = foldScheduleMode(SWITCHED, today);
    for (const date of ["2026-10-22", "2026-10-23", "2026-11-30"]) {
      expect(effectiveScheduleMode(folded, date)).toBe(effectiveScheduleMode(SWITCHED, date));
    }
  });
});
