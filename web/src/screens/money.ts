import type { Piastres } from "../domain/money";

/**
 * Formats piastres as a bare amount for display across the day screen's
 * money surfaces (the slab's tiles, `.tile .v`; the invoice sheet's items,
 * totals and payments): thousands separators on the pound part, a fraction
 * only when the piastres remainder is non-zero, always two digits when it
 * is. The currency unit ("ج.م") is never part of this string — each caller
 * renders it separately through its own markup (e.g. DayTiles.tsx's `unit`
 * prop, `.tile .v i`). Deliberately not domain/money.ts's
 * formatPiastresForDisplay, which bakes the unit in and has no thousands
 * separator.
 *
 * Moved here (from screens/day/tileMoney.ts) once the invoice sheet needed
 * the same formatting: a day-screen-only location stopped fitting a helper
 * shared across unrelated screens.
 */
export function formatMoneyAmount(piastres: Piastres): string {
  const sign = piastres < 0 ? "-" : "";
  const absolute = Math.abs(piastres);
  const pounds = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  const poundsWithSeparators = pounds.toLocaleString("en-US");
  return fraction === 0 ? `${sign}${poundsWithSeparators}` : `${sign}${poundsWithSeparators}.${fraction.toString().padStart(2, "0")}`;
}
