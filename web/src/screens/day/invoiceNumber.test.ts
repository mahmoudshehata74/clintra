import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, formatReceiptNumber } from "./invoiceNumber";

describe("formatInvoiceNumber", () => {
  it("pads the sequence to 4 digits", () => {
    expect(formatInvoiceNumber({ number: 142, issued_year: 2026 })).toBe("INV-2026-0142");
  });

  it("does not truncate a sequence already 4 or more digits long", () => {
    expect(formatInvoiceNumber({ number: 10234, issued_year: 2026 })).toBe("INV-2026-10234");
  });

  it("pads a single-digit sequence", () => {
    expect(formatInvoiceNumber({ number: 1, issued_year: 2025 })).toBe("INV-2025-0001");
  });
});

describe("formatReceiptNumber", () => {
  it("prefixes the bare stored sequence", () => {
    expect(formatReceiptNumber("1189")).toBe("RCP-1189");
  });
});
