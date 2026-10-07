import { describe, expect, it } from "vitest";
import { buildBookingSheetTitle } from "./bookingSheetTitle";
import type { ClockTime } from "../../domain/time";

describe("buildBookingSheetTitle", () => {
  it("is just the booking label with no time and no practitioner", () => {
    expect(buildBookingSheetTitle(null, null)).toBe("حجز");
  });

  it("appends the time once one is chosen", () => {
    expect(buildBookingSheetTitle("11:30" as ClockTime, null)).toBe("حجز · 11:30");
  });

  it("appends the practitioner only when one is given", () => {
    expect(buildBookingSheetTitle("11:30" as ClockTime, "د. أحمد المصري")).toBe("حجز · 11:30 · د. أحمد المصري");
  });

  it("can show the practitioner with no time chosen yet", () => {
    expect(buildBookingSheetTitle(null, "د. أحمد المصري")).toBe("حجز · د. أحمد المصري");
  });
});
