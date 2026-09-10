import { beforeEach, describe, expect, it } from "vitest";
import { verifyPin } from "../auth/pinHash";
import { Role } from "../domain/role";
import { LocationScope, PractitionerScope } from "../domain/scope";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import { createStaffMembership, updateMembership } from "./staffSettings";
import type { Membership } from "./types";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-staff-settings-test-${crypto.randomUUID()}`);
});

async function ownerMembership(): Promise<Membership> {
  const owner = (await db.memberships.toArray()).find((m) => m.role === Role.Owner);
  if (!owner) throw new Error("no seeded owner");
  return owner;
}

const baseInput = {
  fullName: "منى فؤاد",
  phone: "01098765432",
  role: Role.Assistant,
  locationScope: LocationScope.All,
  practitionerScope: PractitionerScope.All,
  listedLocationIds: [],
  listedPractitionerIds: [],
  pin: "4321",
};

describe("createStaffMembership", () => {
  it("creates a user + membership with a hashed PIN and normalised phone", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();

    const result = await createStaffMembership(db, { orgId: org.id, ...baseInput });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const membership = await db.memberships.get(result.membershipId);
    expect(membership?.role).toBe(Role.Assistant);
    expect(membership?.pin_salt).toBeTruthy();
    expect(verifyPin("4321", membership!.pin_salt!, membership!.pin_hash)).toBe(true);

    const user = await db.users.get(membership!.user_id);
    expect(user?.phone).toBe("+201098765432");
  });

  it("writes membership_locations links for a listed location scope", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const [location] = await db.locations.toArray();

    const result = await createStaffMembership(db, {
      orgId: org.id,
      ...baseInput,
      phone: "01098765433",
      locationScope: LocationScope.Listed,
      listedLocationIds: [location.id],
    });
    if (!result.ok) throw new Error("expected success");

    const links = (await db.membership_locations.toArray()).filter((l) => l.membership_id === result.membershipId);
    expect(links).toHaveLength(1);
    expect(links[0].location_id).toBe(location.id);
  });

  it("refuses a phone already taken by another user", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    // The seeded assistant's phone, entered in local form.
    const result = await createStaffMembership(db, { orgId: org.id, ...baseInput, phone: "01123456789" });
    expect(result).toEqual({ ok: false, reason: "phone_taken" });
  });
});

describe("updateMembership last-owner guard", () => {
  it("refuses demoting the only active owner", async () => {
    await seedDatabase(db);
    const owner = await ownerMembership();
    expect(await updateMembership(db, owner.id, { role: Role.Assistant })).toEqual({ ok: false, reason: "last_owner" });
    expect((await db.memberships.get(owner.id))?.role).toBe(Role.Owner);
  });

  it("refuses deactivating the only active owner", async () => {
    await seedDatabase(db);
    const owner = await ownerMembership();
    expect(await updateMembership(db, owner.id, { isActive: false })).toEqual({ ok: false, reason: "last_owner" });
  });

  it("allows demoting one owner once a second active owner exists", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const owner = await ownerMembership();
    const second = await createStaffMembership(db, {
      orgId: org.id,
      ...baseInput,
      phone: "01098765434",
      role: Role.Owner,
    });
    if (!second.ok) throw new Error("expected success");

    expect(await updateMembership(db, owner.id, { role: Role.Assistant })).toEqual({ ok: true });
    expect((await db.memberships.get(owner.id))?.role).toBe(Role.Assistant);
  });
});

describe("updateMembership PIN change", () => {
  it("re-hashes the PIN without touching anything else", async () => {
    await seedDatabase(db);
    const assistant = (await db.memberships.toArray()).find((m) => m.role === Role.Assistant)!;
    const oldHash = assistant.pin_hash;

    const result = await updateMembership(db, assistant.id, { newPin: "0000" });
    expect(result).toEqual({ ok: true });

    const updated = await db.memberships.get(assistant.id);
    expect(updated?.pin_hash).not.toBe(oldHash);
    expect(verifyPin("0000", updated!.pin_salt!, updated!.pin_hash)).toBe(true);
  });
});
