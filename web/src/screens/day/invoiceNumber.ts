/**
 * The invoice sheet's own display-only numbering (`.inv-num`, e.g.
 * "INV-2026-0142"): the stored `issued_year` and the per-location-per-year
 * `number` are unchanged — this only formats them for display, it never
 * touches what's stored or how `number` is reserved (see db/types.ts's
 * Invoice.number doc comment).
 */
export function formatInvoiceNumber(invoice: { readonly number: number; readonly issued_year: number }): string {
  return `INV-${invoice.issued_year}-${String(invoice.number).padStart(4, "0")}`;
}

/** A payment's own receipt, display-only (`.pay .rcp`, e.g. "RCP-1189"). Stored as a bare sequential string (db/payments.ts). */
export function formatReceiptNumber(receiptNumber: string): string {
  return `RCP-${receiptNumber}`;
}
