// Tashkeel (harakat, shadda, sukun) and other Arabic combining marks that
// carry pronunciation, not identity, for search purposes: "مُحَمَّد" and
// "محمد" must compare equal. Ranges: U+0610-061A (honorific/quranic marks),
// U+064B-065F (the harakat block: fatha, damma, kasra, shadda, sukun,
// tanween), U+0670 (superscript alef), U+06D6-06ED (quranic annotation
// marks).
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

/**
 * Normalises Arabic (and any Latin) text for comparison: strips tashkeel and
 * lowercases, so search matching is insensitive to diacritics and case.
 */
export function normalizeArabicText(input: string): string {
  return input.replace(ARABIC_DIACRITICS, "").trim().toLowerCase();
}
