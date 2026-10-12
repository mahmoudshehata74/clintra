/**
 * Every place that shows or prints an invoice or receipt number goes through
 * the four formatters below — display only: the stored `series`,
 * `issued_year`, `number` and `receipt_number` are never touched, and
 * neither is how they are minted (db/visitCompletion.ts, db/payments.ts).
 *
 * A number is only unique within the device series it was minted in
 * (docs/schema.md's v16 additions), so the series is part of what is shown:
 * series 1 adds nothing, so every number minted in it reads exactly as it
 * always did ("INV-2026-0043", "RCP-1189"), and series n ≥ 2 adds a letter
 * ("INV-2026-B-0043", "RCP-B-1189"). The full forms are the screens' own
 * labels; the bare forms are the printed page's and the audit log's, which
 * have always shown the number without its INV-/RCP- prefix. Both apply the
 * same seriesPrefix(), so they can never disagree about a series.
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
function seriesPrefix(series: number): string {
  return series === 1 ? "" : `${seriesLetter(series)}-`;
}

interface InvoiceNumberParts {
  readonly number: number;
  readonly issued_year: number;
  readonly series: number;
}

interface ReceiptNumberParts {
  readonly receipt_number: string;
  readonly series: number;
}

/** The invoice sheet's own label (`.inv-num`), e.g. "INV-2026-0142", "INV-2026-B-0142". */
export function formatInvoiceNumber(invoice: InvoiceNumberParts): string {
  return `INV-${invoice.issued_year}-${seriesPrefix(invoice.series)}${String(invoice.number).padStart(4, "0")}`;
}

/** The printed invoice's and receipt's "رقم الفاتورة", e.g. "142", "B-142". */
export function formatBareInvoiceNumber(invoice: Omit<InvoiceNumberParts, "issued_year">): string {
  return `${seriesPrefix(invoice.series)}${invoice.number}`;
}

/** A payment row's own receipt label (`.pay .rcp`), e.g. "RCP-1189", "RCP-B-1189". */
export function formatReceiptNumber(payment: ReceiptNumberParts): string {
  return `RCP-${formatBareReceiptNumber(payment)}`;
}

/** The printed receipt's number and the audit log's "إيصال رقم …", e.g. "1189", "B-1189". */
export function formatBareReceiptNumber(payment: ReceiptNumberParts): string {
  return `${seriesPrefix(payment.series)}${payment.receipt_number}`;
}
