/**
 * How a number minted inside a device's number series is shown
 * (docs/schema.md's v16 additions): a number is only unique within the
 * series it was minted in, so the series is part of what is shown. Series 1
 * adds nothing, so every number minted in it reads exactly as it always did;
 * series n ≥ 2 adds its letter. Shared by every numbered document — invoices
 * and receipts (screens/day/invoiceNumber.ts) and prescriptions (below) — so
 * no two of them can ever disagree about a series. Display only: the stored
 * series and number are never touched.
 */

/**
 * The series letter: bijective base 26 with 1 = A, so 2 → B … 26 → Z,
 * 27 → AA, 28 → AB … 52 → AZ, 53 → BA … 702 → ZZ, 703 → AAA. Never "" for a
 * positive series; seriesPrefix() is what omits series 1.
 */
export function seriesLetter(series: number): string {
  let letters = "";
  let remaining = series;
  while (remaining > 0) {
    remaining -= 1;
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26);
  }
  return letters;
}

/** "" for series 1, otherwise the series letter and a hyphen ("B-", "AA-"). */
export function seriesPrefix(series: number): string {
  return series === 1 ? "" : `${seriesLetter(series)}-`;
}

interface PrescriptionNumberParts {
  readonly number: number;
  readonly issued_year: number;
  readonly series: number;
}

/** A prescription's number, e.g. "RX-2026-0287", "RX-2026-B-0287". */
export function formatPrescriptionNumber(prescription: PrescriptionNumberParts): string {
  return `RX-${prescription.issued_year}-${seriesPrefix(prescription.series)}${String(prescription.number).padStart(4, "0")}`;
}
