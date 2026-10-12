// One rule for a practitioner's title and syndicate number, read by every
// place that shows or edits them — the settings row and its edit form, and
// the printed prescription — so no screen decides "empty" differently
// (docs/schema.md's v18 additions).
//
// - title is NOT NULL and stored trimmed; "" means "no title".
// - syndicate_number is stored trimmed; null means "none on record" and an
//   empty entry is stored as null.

/** practitioners.syndicate_number is varchar(50). */
export const SYNDICATE_NUMBER_MAX_LENGTH = 50;

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The title to show, or null when the practitioner has none ("" or blank). */
export function practitionerTitleOf(title: string | null | undefined): string | null {
  return trimmedOrNull(title);
}

/** The syndicate number to show, or null when none is on record. */
export function syndicateNumberOf(syndicateNumber: string | null | undefined): string | null {
  return trimmedOrNull(syndicateNumber);
}

/** A title as stored: trimmed, "" for none. */
export function storedPractitionerTitle(title: string): string {
  return title.trim();
}

/** A syndicate number as stored: trimmed, null for none. */
export function storedSyndicateNumber(syndicateNumber: string): string | null {
  return trimmedOrNull(syndicateNumber);
}
