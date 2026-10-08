import type { Membership } from "../../db/types";
import { Role } from "../../domain/role";

/**
 * True for the org's one remaining active owner — the membership whose
 * active switch must stay on and whose role must stay owner, since the
 * clinic always needs at least one working owner (db/staffSettings.ts's
 * updateMembership refuses the same edit as "last_owner").
 */
export function isLastActiveOwner(membership: Membership, memberships: readonly Membership[]): boolean {
  if (membership.role !== Role.Owner || !membership.is_active) {
    return false;
  }
  return memberships.filter((m) => m.org_id === membership.org_id && m.role === Role.Owner && m.is_active).length === 1;
}

/**
 * Screen 14's PIN status (settled deviation: never any digit of the PIN):
 * whether this membership has a PIN set at all.
 */
export function hasPinSet(membership: Pick<Membership, "pin_hash">): boolean {
  return membership.pin_hash.trim() !== "";
}
