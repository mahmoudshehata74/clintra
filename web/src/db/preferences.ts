import { parseAppearance, type Appearance } from "../domain/appearance";
import type { ClintraDatabase } from "./database";

const APPEARANCE_KEY = "appearance";

/**
 * This device's stored appearance, or null when it never chose one (read
 * as auto). Local-only (database version 22): the choice belongs to this
 * device, not to the clinic or the person signed in.
 */
export async function loadAppearance(db: ClintraDatabase): Promise<Appearance | null> {
  const row = await db.preferences.get(APPEARANCE_KEY);
  return row ? parseAppearance(row.value) : null;
}

/** Stores the device's appearance directly — no mutate(), so nothing is queued for sync or audited. */
export async function saveAppearance(db: ClintraDatabase, appearance: Appearance): Promise<void> {
  await db.preferences.put({ key: APPEARANCE_KEY, value: appearance });
}
