import type { Membership, User } from "../db/types";

/** memberships.display_name's own limit (docs/schema.md's v21 additions). */
export const STAFF_NAME_MAX_LENGTH = 120;

/**
 * The name a staff member is shown by, everywhere one is shown (staff list,
 * lock screen, app bar, audit actor, cash close, printed pages, profile):
 * the membership's display_name — the name this organization uses — and the
 * user's full_name only when the membership has none (a row from before
 * display_name existed). Null when neither is known.
 */
export function staffName(
  membership: Pick<Membership, "display_name"> | undefined,
  user: Pick<User, "full_name"> | undefined,
): string | null {
  const displayName = membership?.display_name?.trim();
  if (displayName) {
    return displayName;
  }
  return user?.full_name ?? null;
}

export type StaffNameInput = { ok: true; value: string } | { ok: false; reason: "name_required" | "name_too_long" };

/** A typed staff name as stored: trimmed, required, at most 120 characters. */
export function normalizeStaffName(raw: string): StaffNameInput {
  const value = raw.trim();
  if (value === "") {
    return { ok: false, reason: "name_required" };
  }
  if (value.length > STAFF_NAME_MAX_LENGTH) {
    return { ok: false, reason: "name_too_long" };
  }
  return { ok: true, value };
}
