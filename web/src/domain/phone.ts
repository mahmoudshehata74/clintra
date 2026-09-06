const ARABIC_INDIC_DIGIT_RANGES: readonly [number, number, number][] = [
  [0x0660, 0x0669, 0x0660],
  [0x06f0, 0x06f9, 0x06f0],
];

function toWesternDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const codePoint = digit.codePointAt(0) as number;
    const range = ARABIC_INDIC_DIGIT_RANGES.find(([start, end]) => codePoint >= start && codePoint <= end);
    return range ? String(codePoint - range[2]) : digit;
  });
}

/** Kind of Egyptian line a normalised number belongs to. */
export const PhoneKind = {
  Mobile: "mobile",
  Landline: "landline",
} as const;

export type PhoneKind = (typeof PhoneKind)[keyof typeof PhoneKind];

const EGYPT_MOBILE_NATIONAL_NUMBER = /^1[0125]\d{8}$/;

// Verified against the Egyptian numbering plan (Cairo/Giza/Qalyubia = 2, Alexandria = 3, and the
// two-digit governorate codes below). The 10th of Ramadan codes (15, 554) are deliberately
// excluded: "15" overlaps the WE mobile prefix's digit space and could not be confirmed with
// confidence from consistent sources.
const EGYPT_LANDLINE_TWO_DIGIT_CODES = [
  "13", "40", "45", "46", "47", "48", "50", "55", "57", "62", "64", "65",
  "66", "68", "69", "82", "84", "86", "88", "92", "93", "95", "96", "97",
];

const EGYPT_LANDLINE_TWO_DIGIT_NUMBER = new RegExp(
  `^(?:${EGYPT_LANDLINE_TWO_DIGIT_CODES.join("|")})\\d{7}$`,
);

interface PhoneClassification {
  readonly kind: PhoneKind;
  readonly areaCodeLength: number;
}

function classifyNationalNumber(national: string): PhoneClassification | null {
  if (EGYPT_MOBILE_NATIONAL_NUMBER.test(national)) {
    return { kind: PhoneKind.Mobile, areaCodeLength: 2 };
  }
  if (/^2\d{8}$/.test(national) || /^3\d{7}$/.test(national)) {
    return { kind: PhoneKind.Landline, areaCodeLength: 1 };
  }
  if (EGYPT_LANDLINE_TWO_DIGIT_NUMBER.test(national)) {
    return { kind: PhoneKind.Landline, areaCodeLength: 2 };
  }
  return null;
}

function groupDigitsFromRight(digits: string, groupSize: number): string[] {
  const groups: string[] = [];
  let end = digits.length;
  while (end > 0) {
    const start = Math.max(0, end - groupSize);
    groups.unshift(digits.slice(start, end));
    end = start;
  }
  return groups;
}

export type NormalizePhoneResult =
  | { readonly ok: true; readonly value: string; readonly kind: PhoneKind }
  | { readonly ok: false; readonly error: string };

/**
 * Normalises a user-entered Egyptian mobile or landline number into E.164 (+20 followed by the
 * national number, no leading zero). Accepts local, bare national, +20 and 0020 international
 * forms, Arabic-Indic digits, and common spacing/punctuation. Returns a clear failure instead of
 * throwing or guessing when the input cannot be normalised.
 */
export function normalizeEgyptianPhone(input: string): NormalizePhoneResult {
  const digitsAndPlus = toWesternDigits(input).replace(/[^\d+]/g, "");
  const hasLeadingPlus = digitsAndPlus.startsWith("+");
  let national = hasLeadingPlus ? digitsAndPlus.slice(1) : digitsAndPlus;

  if (national.startsWith("0020")) {
    national = national.slice(4);
  } else if (national.startsWith("20")) {
    national = national.slice(2);
  } else if (national.startsWith("0")) {
    national = national.slice(1);
  }

  const classification = classifyNationalNumber(national);
  if (!classification) {
    return { ok: false, error: "invalid_phone" };
  }

  return { ok: true, value: `+20${national}`, kind: classification.kind };
}

/**
 * Formats an E.164 Egyptian number for local display, grouping the trunk-prefixed area/operator
 * code separately from the subscriber number, e.g. +201001234567 -> "010 0123 4567" (mobile) or
 * +20221234567 -> "02 1234 5678" (landline).
 */
export function formatEgyptianPhoneForDisplay(e164: string): string {
  const match = /^\+20(\d+)$/.exec(e164);
  if (!match) {
    return e164;
  }

  const national = match[1];
  const classification = classifyNationalNumber(national);
  if (!classification) {
    return e164;
  }

  const prefix = `0${national.slice(0, classification.areaCodeLength)}`;
  const subscriber = national.slice(classification.areaCodeLength);
  return [prefix, ...groupDigitsFromRight(subscriber, 4)].join(" ");
}
