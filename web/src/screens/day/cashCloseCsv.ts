import type { Invoice } from "../../db/types";
import type { Piastres } from "../../domain/money";
import type { ClinicDay } from "../../domain/time";
import { STATUS_LABEL } from "./InvoiceSheet";

export interface CsvInvoiceRow {
  invoice: Invoice;
  patientName: string;
  /** This invoice's item descriptions, in their existing order — joined with " + ". */
  itemDescriptions: readonly string[];
}

const HEADER = ["التاريخ", "المريض", "الخدمة", "المبلغ", "حالة الدفع"];

/** A cell beginning with one of these runs as a formula in Excel/Sheets if left unescaped. */
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t]/;

/**
 * Piastres as a plain pounds number for a CSV cell: no thousands separator,
 * a fraction only when the piastres remainder is non-zero — unlike
 * screens/money.ts's formatMoneyAmount, which always adds thousands
 * separators for on-screen display.
 */
function formatCsvAmount(piastres: Piastres): string {
  const sign = piastres < 0 ? "-" : "";
  const absolute = Math.abs(piastres);
  const pounds = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  return fraction === 0 ? `${sign}${pounds}` : `${sign}${pounds}.${fraction.toString().padStart(2, "0")}`;
}

/**
 * One CSV cell, RFC 4180 quoted (commas, quotes, newlines) and, separately,
 * neutralized against formula injection: a cell beginning with = + - @ or a
 * tab gets a leading single quote first, so a patient name typed as
 * "=cmd(...)" can never run as a formula when the file is opened in a
 * spreadsheet app. The neutralizing prefix is added before quoting is
 * decided, so it is itself covered by a quoted cell's own escaping.
 */
function escapeCsvCell(value: string): string {
  const neutralized = FORMULA_PREFIX_PATTERN.test(value) ? `'${value}` : value;
  const needsQuoting = /[",\r\n]/.test(neutralized);
  return needsQuoting ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(escapeCsvCell).join(",");
}

/**
 * Builds the day close sheet's CSV export: one row per invoice issued on
 * `date` at this location, already filtered and resolved by the caller (see
 * CashCloseSheet.tsx). CRLF line endings per RFC 4180; the caller is
 * responsible for the UTF-8 BOM the download itself needs (see csvFileNameForDay).
 */
export function buildDayInvoicesCsv(date: ClinicDay, rows: readonly CsvInvoiceRow[]): string {
  const lines = [
    csvRow(HEADER),
    ...rows.map((row) =>
      csvRow([
        date,
        row.patientName,
        row.itemDescriptions.join(" + "),
        formatCsvAmount(row.invoice.total),
        STATUS_LABEL[row.invoice.status] ?? row.invoice.status,
      ]),
    ),
  ];
  return lines.join("\r\n") + "\r\n";
}

/** `clintra-{YYYY-MM-DD}.csv` — the download's own file name. */
export function csvFileNameForDay(date: ClinicDay): string {
  return `clintra-${date}.csv`;
}
