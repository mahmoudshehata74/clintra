import { useSyncExternalStore } from "react";
import { db } from "../db/database";
import { useLiveQuery } from "../db/useLiveQuery";
import type { Membership } from "../db/types";
import { getActiveMembershipId, subscribeSession } from "./session";

/**
 * The membership currently operating the tablet, or undefined when locked.
 * Reactive to both the session (who is logged in) and the membership row itself
 * (so a role change the owner makes in settings takes effect without a reload).
 * This is the UI's read-only view of the actor; writes still resolve it through
 * db/actingMembership.ts.
 */
export function useActingMembership(): Membership | undefined {
  const membershipId = useSyncExternalStore(subscribeSession, getActiveMembershipId);
  return useLiveQuery<Membership | undefined>(
    async () => (membershipId ? await db.memberships.get(membershipId) : undefined),
    [membershipId],
  );
}
