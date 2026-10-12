/**
 * Every table the sync endpoints carry: exactly
 * api/app/Support/Sync/SyncableTables.php's NAMES, and every entity string a
 * mutate()/runAtomicMutations() caller writes. There is no way to derive one
 * list from the other across the language boundary, so this one is kept in
 * step by hand — reviewSummary.test.ts holds every name here to an Arabic
 * label, and database.test.ts to a real local store.
 */
export const SYNCABLE_TABLES = [
  "cash_close",
  "day_state",
  "invoice_items",
  "invoices",
  "membership_locations",
  "membership_practitioners",
  "memberships",
  "patients",
  "payments",
  "prescription_items",
  "prescriptions",
  "schedules",
  "service_price_overrides",
  "services",
  "visit_form_data",
  "visits",
] as const;

export type SyncableTable = (typeof SYNCABLE_TABLES)[number];
