import { InvoiceStatus, type Invoice, type InvoiceItem } from "../db/types";
import type { Piastres } from "./money";

/**
 * Why an invoice's items cannot be edited: a payment exists against it, it
 * is void, or its day's cash is already closed. Checked in that order, so
 * the reason shown is the one an assistant can least undo.
 */
export type InvoiceItemEditRefusal = "has_payments" | "void" | "day_closed";

export interface InvoiceItemEditContext {
  invoice: Pick<Invoice, "status">;
  paymentCount: number;
  /** A cash_close row exists for the invoice's location and Cairo day. */
  dayClosed: boolean;
}

/** Items may change only while the invoice has no payment, is not void, and its day is not closed. */
export function invoiceItemEditRefusal(context: InvoiceItemEditContext): InvoiceItemEditRefusal | null {
  if (context.paymentCount > 0) {
    return "has_payments";
  }
  if (context.invoice.status === InvoiceStatus.Void) {
    return "void";
  }
  if (context.dayClosed) {
    return "day_closed";
  }
  return null;
}

/** One line of an invoice being edited; `id` is null for a line added in this edit. */
export interface DraftInvoiceItem {
  id: string | null;
  service_id: string;
  description: string;
  qty: number;
  unit_price: Piastres;
}

/** A line's total, in integer piastres. */
export function lineTotal(qty: number, unitPrice: Piastres): Piastres {
  return (qty * unitPrice) as Piastres;
}

/** The invoice's total: the sum of its lines' totals. */
export function invoiceTotalOf(items: readonly Pick<DraftInvoiceItem, "qty" | "unit_price">[]): Piastres {
  return items.reduce((sum, item) => (sum + lineTotal(item.qty, item.unit_price)) as Piastres, 0 as Piastres);
}

/**
 * An unpaid invoice's status for a total: paid when nothing is owed (as a
 * completed visit's zero-total invoice is created), otherwise unpaid.
 */
export function unpaidInvoiceStatus(total: Piastres): InvoiceStatus {
  return total === 0 ? InvoiceStatus.Paid : InvoiceStatus.Unpaid;
}

export type DraftItemsProblem = "no_items" | "qty_invalid" | "price_invalid";

/** A draft can be saved with at least one line, each a whole quantity of 1 or more at a whole, non-negative piastre price. */
export function draftItemsProblem(items: readonly DraftInvoiceItem[]): DraftItemsProblem | null {
  if (items.length === 0) {
    return "no_items";
  }
  if (items.some((item) => !Number.isInteger(item.qty) || item.qty < 1)) {
    return "qty_invalid";
  }
  if (items.some((item) => !Number.isInteger(item.unit_price) || item.unit_price < 0)) {
    return "price_invalid";
  }
  return null;
}

export interface InvoiceItemChanges {
  created: DraftInvoiceItem[];
  /** Existing lines whose quantity or price changed, with their stored row. */
  updated: { before: InvoiceItem; after: DraftInvoiceItem }[];
  deleted: InvoiceItem[];
}

/** What saving `draft` over `current` writes: lines added, lines changed, and lines removed. */
export function diffInvoiceItems(current: readonly InvoiceItem[], draft: readonly DraftInvoiceItem[]): InvoiceItemChanges {
  const kept = new Set(draft.flatMap((item) => (item.id === null ? [] : [item.id])));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const updated: InvoiceItemChanges["updated"] = [];
  for (const item of draft) {
    const before = item.id === null ? undefined : currentById.get(item.id);
    if (before && (before.qty !== item.qty || before.unit_price !== item.unit_price)) {
      updated.push({ before, after: item });
    }
  }
  return {
    created: draft.filter((item) => item.id === null),
    updated,
    deleted: current.filter((item) => !kept.has(item.id)),
  };
}
