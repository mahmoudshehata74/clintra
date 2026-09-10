import { getActiveMembershipId } from "../auth/session";
import type { ClintraDatabase } from "./database";
import type { Membership } from "./types";

/**
 * A test-only stand-in for the lock screen. In the app, a real actor is
 * established by entering a PIN (auth/session.ts); the DB-layer unit tests
 * exercise write logic without that UI, so the vitest setup registers a
 * resolver here that returns the seeded assistant — exactly the role the lock
 * screen plays at runtime. It is NEVER set in a browser build (nothing in the
 * app calls the setter), so production behaviour is strictly the session path
 * below: no session means no actor, and the write is refused.
 */
type TestActorResolver = (db: ClintraDatabase) => Promise<Membership | null>;
let testActorResolver: TestActorResolver | null = null;

/** Test-only: register (or clear, with null) the stand-in actor resolver. */
export function setTestActorResolver(resolver: TestActorResolver | null): void {
  testActorResolver = resolver;
}

/**
 * The membership every write is attributed to — the single site that flips the
 * whole app from a seeded default to the truly acting person once PIN sessions
 * exist. When a session is active it returns that membership. When none is, it
 * MUST NOT fall back to a default: it throws, so a write can never reach the
 * audit log attributed to nobody (or to the wrong person). Every write path
 * that calls this is therefore only reachable once the lock screen has
 * established a session.
 */
export async function resolveActingMembership(db: ClintraDatabase): Promise<Membership> {
  const membershipId = getActiveMembershipId();
  if (membershipId !== null) {
    const membership = await db.memberships.get(membershipId);
    if (!membership) {
      throw new Error("acting_session_membership_missing");
    }
    return membership;
  }

  if (testActorResolver) {
    const resolved = await testActorResolver(db);
    if (resolved) {
      return resolved;
    }
  }

  throw new Error("no_active_session");
}
