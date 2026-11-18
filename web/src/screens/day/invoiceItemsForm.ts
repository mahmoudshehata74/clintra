import type { InvoiceItem } from "../../db/types";
import type { DraftInvoiceItem } from "../../domain/invoiceItemEdit";
import { parsePoundsToPiastres, type Piastres } from "../../domain/money";
import type { SaveInvoiceItemsResult } from "../../db/invoiceItems";
import { dayScreenStrings } from "./strings";

/** One line of the edit form as typed: the quantity and price are the fields' text. */
export interface EditLineInput {
  /** React's key: the item's id, or a fresh one for a line added in this edit. */
  key: string;
  id: string | null;
  service_id: string;
  description: string;
  qtyInput: string;
  priceInput: string;
}

/** Piastres as the price field's starting text: "400" or "400.50". */
export function piastresToPoundsInput(piastres: Piastres): string {
  const pounds = Math.trunc(piastres / 100);
  const fraction = piastres % 100;
  return fraction === 0 ? String(pounds) : `${pounds}.${String(fraction).padStart(2, "0")}`;
}

export function lineFromItem(item: InvoiceItem): EditLineInput {
  return {
    key: item.id,
    id: item.id,
    service_id: item.service_id,
    description: item.description,
    qtyInput: String(item.qty),
    priceInput: piastresToPoundsInput(item.unit_price),
  };
}

/** A whole quantity of 1 or more, or null. */
export function parseQty(input: string): number | null {
  const trimmed = input.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1 ? Number(trimmed) : null;
}

/** The line as it will be saved, or null while its quantity or price does not parse. */
export function editLineFromInput(line: EditLineInput): DraftInvoiceItem | null {
  const qty = parseQty(line.qtyInput);
  const price = parsePoundsToPiastres(line.priceInput);
  if (qty === null || !price.ok) {
    return null;
  }
  return { id: line.id, service_id: line.service_id, description: line.description, qty, unit_price: price.value };
}

export type EditLinesValidation = { ok: true; draft: DraftInvoiceItem[] } | { ok: false; error: string };

/** The form is saved with at least one line, every quantity a whole 1 or more, every price in pounds. */
export function validateEditLines(lines: readonly EditLineInput[]): EditLinesValidation {
  if (lines.length === 0) {
    return { ok: false, error: dayScreenStrings.editItemsNoItemsError };
  }
  if (lines.some((line) => parseQty(line.qtyInput) === null)) {
    return { ok: false, error: dayScreenStrings.editItemsQtyError };
  }
  const draft = lines.map(editLineFromInput);
  if (draft.some((line) => line === null)) {
    return { ok: false, error: dayScreenStrings.editItemsPriceError };
  }
  return { ok: true, draft: draft.filter((line): line is DraftInvoiceItem => line !== null) };
}

type SaveRefusal = Extract<SaveInvoiceItemsResult, { ok: false }>["reason"];

/** The one line the sheet shows when a save is refused. */
export function saveRefusalMessage(reason: SaveRefusal): string {
  switch (reason) {
    case "has_payments":
      return dayScreenStrings.editItemsPaidReason;
    case "void":
      return dayScreenStrings.editItemsVoidReason;
    case "day_closed":
      return dayScreenStrings.editItemsDayClosedReason;
    case "no_items":
      return dayScreenStrings.editItemsNoItemsError;
    case "qty_invalid":
      return dayScreenStrings.editItemsQtyError;
    case "price_invalid":
      return dayScreenStrings.editItemsPriceError;
    case "invoice_not_found":
      return dayScreenStrings.editItemsNotFoundError;
  }
}
