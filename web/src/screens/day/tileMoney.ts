import type { Piastres } from "../../domain/money";

/**
 * Formats piastres as a bare amount for the slab's money tiles (`.tile .v`):
 * thousands separators on the pound part, a fraction only when the piastres
 * remainder is non-zero, always two digits when it is. The currency unit
 * ("ج.م") is never part of this string — DayTiles.tsx renders it separately,
 * through the tile's own `unit` prop (`.tile .v i`). Deliberately not
 * domain/money.ts's formatPiastresForDisplay, which bakes the unit in and
 * has no thousands separator.
 */
export function formatTileMoney(piastres: Piastres): string {
  const sign = piastres < 0 ? "-" : "";
  const absolute = Math.abs(piastres);
  const pounds = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  const poundsWithSeparators = pounds.toLocaleString("en-US");
  return fraction === 0 ? `${sign}${poundsWithSeparators}` : `${sign}${poundsWithSeparators}.${fraction.toString().padStart(2, "0")}`;
}
