/** An integer count of piastres (1/100 EGP). Never a float; branded so a raw number cannot be passed by mistake. */
export type Piastres = number & { readonly __brand: "Piastres" };

export type ParsePoundsResult =
  | { readonly ok: true; readonly value: Piastres }
  | { readonly ok: false; readonly error: string };

/**
 * Parses a user-entered pound amount (plain non-negative decimal, e.g. "12", "12.5", "12.50")
 * into whole piastres using string/BigInt digit arithmetic, never float division. A third or
 * later fraction digit is rounded half-up into the second digit. Anything else is rejected.
 */
export function parsePoundsToPiastres(input: string): ParsePoundsResult {
  const trimmed = input.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    return { ok: false, error: "invalid_amount" };
  }

  const [, wholePart, fractionPart = ""] = match;
  const paddedFraction = `${fractionPart}000`.slice(0, 3);
  const firstTwoDigits = BigInt(paddedFraction.slice(0, 2));
  const thirdDigit = BigInt(paddedFraction.slice(2, 3));
  const roundedFraction = thirdDigit >= 5n ? firstTwoDigits + 1n : firstTwoDigits;
  const total = BigInt(wholePart) * 100n + roundedFraction;

  return { ok: true, value: Number(total) as Piastres };
}

/** Formats piastres for Arabic display as pounds with two decimal digits, e.g. 1250 -> "12.50 ج.م". */
export function formatPiastresForDisplay(piastres: Piastres): string {
  const sign = piastres < 0 ? "-" : "";
  const absolute = Math.abs(piastres);
  const whole = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  return `${sign}${whole}.${fraction.toString().padStart(2, "0")} ج.م`;
}
