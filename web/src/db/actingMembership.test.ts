import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearActiveSession, setActiveMembershipId } from "../auth/session";
import { Role } from "../domain/role";
import { resolveActingMembership, setTestActorResolver } from "./actingMembership";
import { ClintraDatabase } from "./database";
import type { Membership } from "./types";
import { seedDatabase } from "./seed";

let db: ClintraDatabase;

// Mirrors the resolver the vitest setup installs: the seeded assistant stands
// in for the lock screen's actor. Restored after each test so a case that
// clears it does not leak into the next.
const assistantResolver = async (database: ClintraDatabase): Promise<Membership | null> =>
  (await database.memberships.toArray()).find((membership) => membership.role === Role.Assistant) ?? null;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-acting-test-${crypto.randomUUID()}`);
  clearActiveSession();
  setTestActorResolver(assistantResolver);
});

afterEach(() => {
  setTestActorResolver(assistantResolver);
  clearActiveSession();
});

describe("resolveActingMembership", () => {
  it("returns the session's membership when a session is active", async () => {
    await seedDatabase(db);
    const practitioner = (await db.memberships.toArray()).find((m) => m.role === Role.Practitioner);
    setActiveMembershipId(practitioner!.id);

    const actor = await resolveActingMembership(db);
    expect(actor.id).toBe(practitioner!.id);
    expect(actor.role).toBe(Role.Practitioner);
  });

  it("throws when there is no session and no fallback (the production contract)", async () => {
    await seedDatabase(db);
    setTestActorResolver(null);
    await expect(resolveActingMembership(db)).rejects.toThrow(/no_active_session/);
  });

  it("throws when the session points at a membership that no longer exists", async () => {
    await seedDatabase(db);
    setActiveMembershipId("does-not-exist");
    await expect(resolveActingMembership(db)).rejects.toThrow(/acting_session_membership_missing/);
  });
});
