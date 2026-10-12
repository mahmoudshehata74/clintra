import { describe, expect, it } from "vitest";
import { formatPrescriptionNumber, seriesPrefix } from "./numberSeries";

describe("formatPrescriptionNumber", () => {
  it.each([
    [1, 287, "RX-2026-0287"],
    [2, 287, "RX-2026-B-0287"],
    [27, 287, "RX-2026-AA-0287"],
    [1, 1, "RX-2026-0001"],
    [2, 12345, "RX-2026-B-12345"],
  ])("series %i, number %i reads %s", (series, number, expected) => {
    expect(formatPrescriptionNumber({ number, issued_year: 2026, series })).toBe(expected);
  });

  it("carries its own year", () => {
    expect(formatPrescriptionNumber({ number: 3, issued_year: 2027, series: 1 })).toBe("RX-2027-0003");
  });
});

describe("seriesPrefix", () => {
  it.each([
    [1, ""],
    [2, "B-"],
    [27, "AA-"],
  ])("series %i is %j", (series, expected) => {
    expect(seriesPrefix(series)).toBe(expected);
  });
});
