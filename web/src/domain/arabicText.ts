// Tashkeel (harakat, shadda, sukun) and other Arabic combining marks that
// carry pronunciation, not identity, for search purposes: "مُحَمَّد" and
// "محمد" must compare equal. Written as \u escapes, not literal glyphs, so
// the exact boundaries are unambiguous and cannot be silently transposed:
// U+0610-061A (honorific/quranic marks), U+064B-065F (the harakat block:
// fatha, damma, kasra, shadda, sukun, tanween), U+0670 (superscript alef),
// U+06D6-06ED (quranic annotation marks).
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

// Comparison-only letter folding: distinct letters Egyptian users routinely
// type interchangeably for the same name (e.g. "هدى" vs "هدي"). This never
// touches stored data — only the key produced by this function changes. Kept
// in sync with docs/schema.md, which the Laravel side's patient search must
// mirror. Written as \u escapes for the same reason as ARABIC_DIACRITICS
// above. Exact code points folded:
//   U+0649 (ى ALEF MAKSURA)          -> U+064A (ي YEH)
//   U+0629 (ة TEH MARBUTA)           -> U+0647 (ه HEH)
//   U+0623 (أ ALEF WITH HAMZA ABOVE) -> U+0627 (ا ALEF)
//   U+0625 (إ ALEF WITH HAMZA BELOW) -> U+0627 (ا ALEF)
//   U+0622 (آ ALEF WITH MADDA ABOVE) -> U+0627 (ا ALEF)
//   U+0671 (ٱ ALEF WASLA)            -> U+0627 (ا ALEF)
//   U+0624 (ؤ WAW WITH HAMZA ABOVE)  -> U+0648 (و WAW)
//   U+0626 (ئ YEH WITH HAMZA ABOVE)  -> U+064A (ي YEH)
// Deliberately excludes any other hamza-carrier folding (e.g. plain U+0621
// ء ALEF HAMZA) beyond this exact list.
const ARABIC_LETTER_FOLD: Readonly<Record<string, string>> = {
  "ى": "ي",
  "ة": "ه",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ؤ": "و",
  "ئ": "ي",
};
const ARABIC_LETTER_FOLD_PATTERN = /[ىةأإآٱؤئ]/g;

// Arabic-Indic digits U+0660-0669 -> Western 0-9, in case a name field
// contains a mixed-script identifier.
const ARABIC_INDIC_DIGITS = /[٠-٩]/g;
const ARABIC_INDIC_DIGIT_BASE = 0x0660;

/**
 * Normalises Arabic (and any Latin) text for comparison: strips tashkeel,
 * folds interchangeable letter variants and Arabic-Indic digits, collapses
 * whitespace runs (including non-breaking space, which \s already matches)
 * to a single space, and lowercases. Search matching is insensitive to all
 * of the above; the stored text itself is never altered.
 */
export function normalizeArabicText(input: string): string {
  return input
    .replace(ARABIC_DIACRITICS, "")
    .replace(ARABIC_LETTER_FOLD_PATTERN, (char) => ARABIC_LETTER_FOLD[char])
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.codePointAt(0)! - ARABIC_INDIC_DIGIT_BASE))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
