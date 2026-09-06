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

const EGYPT_MOBILE_NATIONAL_NUMBER = /^1[0125]\d{8}$/;

export type NormalizePhoneResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

/**
 * Normalises a user-entered Egyptian mobile number into E.164 (+20XXXXXXXXXX). Accepts local
 * (01001234567), bare national (1001234567), +20 and 0020 international forms, Arabic-Indic
 * digits, and common spacing/punctuation. Returns a clear failure instead of throwing or guessing
 * when the input cannot be normalised.
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

  if (!EGYPT_MOBILE_NATIONAL_NUMBER.test(national)) {
    return { ok: false, error: "invalid_phone" };
  }

  return { ok: true, value: `+20${national}` };
}

/** Formats an E.164 Egyptian mobile number for local display, e.g. +201001234567 -> "010 0123 4567". */
export function formatEgyptianPhoneForDisplay(e164: string): string {
  const match = /^\+20(1[0125]\d{8})$/.exec(e164);
  if (!match) {
    return e164;
  }

  const local = `0${match[1]}`;
  return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7, 11)}`;
}
