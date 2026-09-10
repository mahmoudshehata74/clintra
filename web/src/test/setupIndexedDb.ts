import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { clearActiveSession } from "../auth/session";
import { setTestActorResolver } from "../db/actingMembership";
import { Role } from "../domain/role";

// The DB-layer unit tests exercise write logic, not the lock screen, so the
// test harness stands in for "who is logged in" the same way the lock screen
// does in the app: it supplies the seeded assistant as the acting membership.
// Production never registers a resolver, so there its behaviour stays strict —
// no session, no write (see db/actingMembership.ts). A test that needs the
// strict throw can clear this with setTestActorResolver(null); a test that
// needs a specific actor can set a real session with setActiveMembershipId.
setTestActorResolver(async (db) => {
  const memberships = await db.memberships.toArray();
  return memberships.find((membership) => membership.role === Role.Assistant) ?? memberships[0] ?? null;
});

// A real session set by an auth test must not leak into the next test.
afterEach(() => {
  clearActiveSession();
});
