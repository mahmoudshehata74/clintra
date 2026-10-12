import { describe, expect, it } from "vitest";
import { seriesLetter } from "../../domain/numberSeries";
import { formatBareInvoiceNumber, formatBareReceiptNumber, formatInvoiceNumber, formatReceiptNumber } from "./invoiceNumber";

describe("formatInvoiceNumber", () => {
  it("pads the sequence to 4 digits", () => {
    expect(formatInvoiceNumber({ number: 142, issued_year: 2026, series: 1 })).toBe("INV-2026-0142");
  });

  it("does not truncate a sequence already 4 or more digits long", () => {
    expect(formatInvoiceNumber({ number: 10234, issued_year: 2026, series: 1 })).toBe("INV-2026-10234");
  });

  it("pads a single-digit sequence", () => {
    expect(formatInvoiceNumber({ number: 1, issued_year: 2025, series: 1 })).toBe("INV-2025-0001");
  });

  it.each([
    [1, "INV-2026-0043"],
    [2, "INV-2026-B-0043"],
    [3, "INV-2026-C-0043"],
    [26, "INV-2026-Z-0043"],
    [27, "INV-2026-AA-0043"],
    [28, "INV-2026-AB-0043"],
    [52, "INV-2026-AZ-0043"],
    [53, "INV-2026-BA-0043"],
    [702, "INV-2026-ZZ-0043"],
    [703, "INV-2026-AAA-0043"],
  ])("series %i renders as %s", (series, expected) => {
    expect(formatInvoiceNumber({ number: 43, issued_year: 2026, series })).toBe(expected);
  });
});

describe("formatBareInvoiceNumber", () => {
  it.each([
    [1, "43"],
    [2, "B-43"],
    [26, "Z-43"],
    [27, "AA-43"],
    [52, "AZ-43"],
    [53, "BA-43"],
    [702, "ZZ-43"],
    [703, "AAA-43"],
  ])("series %i renders as %s", (series, expected) => {
    expect(formatBareInvoiceNumber({ number: 43, series })).toBe(expected);
  });
});

describe("formatReceiptNumber", () => {
  it("prefixes the bare stored sequence", () => {
    expect(formatReceiptNumber({ receipt_number: "1189", series: 1 })).toBe("RCP-1189");
  });

  it.each([
    [1, "RCP-1"],
    [2, "RCP-B-1"],
    [26, "RCP-Z-1"],
    [27, "RCP-AA-1"],
    [52, "RCP-AZ-1"],
    [53, "RCP-BA-1"],
    [702, "RCP-ZZ-1"],
    [703, "RCP-AAA-1"],
  ])("series %i renders as %s", (series, expected) => {
    expect(formatReceiptNumber({ receipt_number: "1", series })).toBe(expected);
  });
});

describe("formatBareReceiptNumber", () => {
  it.each([
    [1, "1189"],
    [2, "B-1189"],
    [27, "AA-1189"],
    [703, "AAA-1189"],
  ])("series %i renders as %s", (series, expected) => {
    expect(formatBareReceiptNumber({ receipt_number: "1189", series })).toBe(expected);
  });

  it("is the full receipt label without its RCP- prefix, for every series", () => {
    for (let series = 1; series <= 800; series += 1) {
      const payment = { receipt_number: "7", series };
      expect(formatReceiptNumber(payment)).toBe(`RCP-${formatBareReceiptNumber(payment)}`);
    }
  });
});

describe("seriesLetter", () => {
  it.each([
    [1, "A"],
    [2, "B"],
    [26, "Z"],
    [27, "AA"],
    [28, "AB"],
    [52, "AZ"],
    [53, "BA"],
    [702, "ZZ"],
    [703, "AAA"],
  ])("%i is %s in bijective base 26", (series, expected) => {
    expect(seriesLetter(series)).toBe(expected);
  });
});
