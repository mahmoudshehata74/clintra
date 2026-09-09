const ARABIC_INDIC_DIGIT_BASE = 0x0660;

/**
 * Renders a non-negative integer in Eastern Arabic-Indic digits (٠-٩) — for
 * a number meant to read as part of natural Arabic text, like a queue
 * position or a count in a summary line, not foreign Latin-script data like
 * a clock time or a money amount. Those stay Western digits, isolated via
 * components/Ltr.tsx; this is the opposite case, so it is never wrapped in
 * Ltr. See domain/arabicText.ts's normalizeArabicText for the reverse fold
 * (Arabic-Indic back to Western) used for search.
 */
export function toArabicIndicDigits(value: number): string {
  return String(Math.trunc(Math.abs(value))).replace(/[0-9]/g, (digit) =>
    String.fromCodePoint(ARABIC_INDIC_DIGIT_BASE + Number(digit)),
  );
}
