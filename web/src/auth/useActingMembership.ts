import { useState, useSyncExternalStore } from "react";
import { db } from "../db/database";
import { useLiveQuery } from "../db/useLiveQuery";
import type { Membership, User } from "../db/types";
import { staffName } from "../domain/staffName";
import { getActiveMembershipId, subscribeSession } from "./session";

/**
 * The rule useActingMembership applies to every value it returns: a
 * membership row only counts as the acting one while it is the current
 * session's own. useLiveQuery keeps returning its previous result while a
 * re-subscribed query runs, so right after the session changes (a lock, or
 * another member unlocking) the row it hands back can still be the previous
 * member's — this drops it instead.
 */
export function membershipForSession(
  row: Membership | undefined,
  sessionMembershipId: string | null,
): Membership | undefined {
  return row !== undefined && sessionMembershipId !== null && row.id === sessionMembershipId ? row : undefined;
}

/**
 * The membership currently operating the tablet, or undefined when locked.
 * Reactive to both the session (who is logged in) and the membership row itself
 * (so a role change the owner makes in settings takes effect without a reload).
 * Never a membership other than the current session's, not even for the one
 * render between a session change and the live query catching up — see
 * membershipForSession.
 * This is the UI's read-only view of the actor; writes still resolve it through
 * db/actingMembership.ts.
 */
export function useActingMembership(): Membership | undefined {
  const membershipId = useSyncExternalStore(subscribeSession, getActiveMembershipId);
  const row = useLiveQuery<Membership | undefined>(
    async () => (membershipId ? await db.memberships.get(membershipId) : undefined),
    [membershipId],
  );
  return membershipForSession(row, membershipId);
}

/**
 * The membership a screen that stays mounted under the lock overlay acts
 * for. useActingMembership is undefined while locked (and, right after an
 * unlock, until its row loads), so the last unlocked membership is
 * remembered (React's adjust-state-while-rendering pattern) and stands in
 * while there is no session, or while the session is that same
 * membership's again and its row is still loading. Once anyone else's
 * session starts, only their own membership counts — never the previous
 * member's, not even for one render.
 */
export function useGuardedActingMembership(): Membership | undefined {
  const activeMembershipId = useSyncExternalStore(subscribeSession, getActiveMembershipId);
  const actingMembership = useActingMembership();
  const [lastUnlockedMembership, setLastUnlockedMembership] = useState(actingMembership);
  if (actingMembership && actingMembership !== lastUnlockedMembership) {
    setLastUnlockedMembership(actingMembership);
  }
  const canStandIn = activeMembershipId === null || activeMembershipId === lastUnlockedMembership?.id;
  return actingMembership ?? (canStandIn ? lastUnlockedMembership : undefined);
}

/** The same rule for the acting member's user row: only while it is that membership's own user. */
export function userForMembership(user: User | undefined, membership: Membership | undefined): User | undefined {
  return user !== undefined && membership !== undefined && user.id === membership.user_id ? user : undefined;
}

/**
 * The acting member's name (domain/staffName.ts: the membership's
 * display_name, else its user's full_name), for the name the chrome and the
 * cash close show. Held to the same rule as useActingMembership: never a
 * previous member's user while the live query for the new one is still
 * running. Undefined while nobody is acting or no name is known yet.
 */
export function useActingStaffName(): string | undefined {
  const membership = useActingMembership();
  const user = useLiveQuery<User | undefined>(
    async () => (membership ? db.users.get(membership.user_id) : undefined),
    [membership?.user_id],
  );
  return (membership ? staffName(membership, userForMembership(user, membership)) : null) ?? undefined;
}
