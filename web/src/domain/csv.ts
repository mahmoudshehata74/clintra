import type { Piastres } from "./money";

/**
 * One CSV cell, typed so the writer formats it (docs/backend-harvest.md
 * section 3's export rules):
 * - text: written as given, prefixed with an apostrophe when it starts with
 *   = + - @ or a control character, so a spreadsheet never reads it as a
 *   formula;
 * - number: written as is (a typed negative number stays a number);
 * - money: piastres written as pounds with 2 decimals (the column's label
 *   says ج.م), a number like any other;
 * - flag: 1 or 0;
 * - null: an empty cell.
 */
export type CsvCell =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "money"; value: Piastres }
  | { kind: "flag"; value: boolean }
  | null;

export const csvText = (value: string | null | undefined): CsvCell => (value == null ? null : { kind: "text", value });
export const csvNumber = (value: number): CsvCell => ({ kind: "number", value });
export const csvMoney = (value: Piastres): CsvCell => ({ kind: "money", value });
export const csvFlag = (value: boolean): CsvCell => ({ kind: "flag", value });

const BOM = "﻿";
const ROW_END = "\r\n";

/** A cell a spreadsheet could run: one starting with a formula's first character, or with any control character. */
function startsLikeFormula(value: string): boolean {
  if (value === "") {
    return false;
  }
  const first = value.charCodeAt(0);
  return "=+-@".includes(value[0]) || first < 0x20 || first === 0x7f;
}

/** Pounds with 2 decimals from integer piastres, exactly ("-12.05", never "-12.049999"). */
export function piastresToPounds(value: Piastres): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function cellText(cell: CsvCell): string {
  if (cell === null) {
    return "";
  }
  switch (cell.kind) {
    case "number":
      return String(cell.value);
    case "money":
      return piastresToPounds(cell.value);
    case "flag":
      return cell.value ? "1" : "0";
    case "text":
      return startsLikeFormula(cell.value) ? `'${cell.value}` : cell.value;
  }
}

/** Quotes a field holding a comma, a quote or a line break, doubling its quotes. */
function quoted(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * A CSV document: a UTF-8 byte order mark, the header row, then one line per
 * row, every line ending in CRLF.
 */
export function writeCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map((label) => quoted(cellText(csvText(label)))), ...rows.map((row) => row.map((cell) => quoted(cellText(cell))))];
  return BOM + lines.map((line) => line.join(",") + ROW_END).join("");
}
