import { Role } from "../domain/role";
import type { ClintraDatabase } from "./database";
import type { Membership } from "./types";

/**
 * TEMPORARY: there is no authentication yet, so the acting membership cannot
 * be a real logged-in user. This resolves to the seeded assistant membership
 * instead. This is the ONLY place that needs to change once PIN-based
 * sessions exist — every mutation call site resolves the actor through this
 * function rather than passing a hardcoded id of its own.
 */
export async function resolveActingMembership(db: ClintraDatabase): Promise<Membership> {
  const memberships = await db.memberships.toArray();
  const assistant = memberships.find((membership) => membership.role === Role.Assistant);

  if (!assistant) {
    throw new Error("no_assistant_membership_seeded");
  }

  return assistant;
}
