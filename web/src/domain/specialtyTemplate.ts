/**
 * The only specialty template v1 ships: a single general-practice template
 * with no specialty-specific form (see docs/schema.md's specialty_templates
 * section). Shared between db/seed.ts, which writes the one row, and
 * db/visitForm.ts, which looks it up to find the current general form
 * definition — kept here, not duplicated in either, so the two can never
 * drift onto different key strings.
 */
export const GENERAL_SPECIALTY_KEY = "general";
