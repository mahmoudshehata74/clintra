import { describe, expect, it } from "vitest";
import { addMinutesToClockTime, generateSlotTimes, generateTimeChoices } from "./schedule";

describe("addMinutesToClockTime", () => {
  it("adds minutes within the same hour", () => {
    expect(addMinutesToClockTime("09:00", 15)).toBe("09:15");
  });

  it("rolls over into the next hour", () => {
    expect(addMinutesToClockTime("09:45", 30)).toBe("10:15");
  });

  it("does not clamp to any particular end time — a late position still gets a real time", () => {
    expect(addMinutesToClockTime("09:00", 600)).toBe("19:00");
  });
});

describe("generateSlotTimes", () => {
  it("generates slots from start_time to end_time stepping by slot_minutes", () => {
    expect(
      generateSlotTimes({ start_time: "09:00", end_time: "12:00", slot_minutes: 30 }),
    ).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
  });

  it("only includes a slot that fully fits before end_time", () => {
    // 09:00-10:15 with 30-minute slots: 09:00 and 09:30 fit, 10:00-10:30 would run past 10:15.
    expect(generateSlotTimes({ start_time: "09:00", end_time: "10:15", slot_minutes: 30 })).toEqual([
      "09:00",
      "09:30",
    ]);
  });

  it("uses the slot length from the schedule, not a fixed value", () => {
    expect(generateSlotTimes({ start_time: "09:00", end_time: "10:00", slot_minutes: 15 })).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
    ]);
  });

  it("returns no slots when slot_minutes is null", () => {
    expect(generateSlotTimes({ start_time: "09:00", end_time: "12:00", slot_minutes: null })).toEqual([]);
  });

  it("returns no slots when slot_minutes is zero or negative", () => {
    expect(generateSlotTimes({ start_time: "09:00", end_time: "12:00", slot_minutes: 0 })).toEqual([]);
  });

  it("returns no slots when start_time equals end_time", () => {
    expect(generateSlotTimes({ start_time: "09:00", end_time: "09:00", slot_minutes: 30 })).toEqual([]);
  });
});

describe("generateTimeChoices", () => {
  it("steps independently of any schedule's own slot length, for the overbook picker", () => {
    expect(generateTimeChoices({ start_time: "09:00", end_time: "10:00" }, 15)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
    ]);
  });

  it("returns nothing for a non-positive step", () => {
    expect(generateTimeChoices({ start_time: "09:00", end_time: "10:00" }, 0)).toEqual([]);
  });
});
