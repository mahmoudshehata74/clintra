import { beforeEach, describe, expect, it } from "vitest";
import { verifyPin } from "../auth/pinHash";
import { Role } from "../domain/role";
import { LocationScope, PractitionerScope } from "../domain/scope";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import {
  StaffServerError,
  type AddStaffRequest,
  type AddStaffResponse,
  type StaffServer,
  type StaffServerFailure,
} from "../sync/staffServer";
import { addStaffMember, updateMembership } from "./staffSettings";
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

/** Answers like POST /api/staff (rev 1, the request's ids), or fails as told; records every request. */
class RecordingStaffServer implements StaffServer {
  readonly requests: AddStaffRequest[] = [];
  private readonly failure: StaffServerFailure | null;
  private readonly existingUserId: string | null;

  constructor(options: { failure?: StaffServerFailure; existingUserId?: string } = {}) {
    this.failure = options.failure ?? null;
    this.existingUserId = options.existingUserId ?? null;
  }

  async addStaffMember(request: AddStaffRequest): Promise<AddStaffResponse> {
    this.requests.push(request);
    if (this.failure !== null) {
      throw new StaffServerError(this.failure);
    }
    return {
      membership: {
        id: request.membership_id,
        user_id: this.existingUserId ?? request.user_id,
        org_id: (await db.organizations.toCollection().first())!.id,
        role: request.role,
        location_scope: request.location_scope,
        practitioner_scope: request.practitioner_scope,
        practitioner_id: request.practitioner_id,
        pin_hash: request.pin_hash,
        pin_salt: request.pin_salt,
        is_active: true,
        display_name: request.display_name,
        rev: 1,
      },
      membership_locations: request.locations.map((link) => ({ ...link, membership_id: request.membership_id, rev: 1 })),
      membership_practitioners: request.practitioners.map((link) => ({ ...link, membership_id: request.membership_id, rev: 1 })),
    };
  }
}

async function counts() {
  return {
    users: await db.users.count(),
    memberships: await db.memberships.count(),
    membershipLocations: await db.membership_locations.count(),
    syncOps: await db.sync_ops.count(),
    audit: await db.audit_log.count(),
  };
}

describe("addStaffMember", () => {
  it("adds on the server and stores the returned rows: display_name, hashed PIN, E.164 phone, no users row, no sync op", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const server = new RecordingStaffServer();
    const before = await counts();

    const result = await addStaffMember(db, server, { orgId: org.id, ...baseInput, fullName: "  منى فؤاد " }, true);
    if (!result.ok) throw new Error("expected success");

    const [request] = server.requests;
    expect(request.phone).toBe("+201098765432");
    expect(request.display_name).toBe("منى فؤاد");
    expect(request).not.toHaveProperty("pin");
    expect(verifyPin("4321", request.pin_salt, request.pin_hash)).toBe(true);

    const membership = await db.memberships.get(result.membershipId);
    expect(membership?.display_name).toBe("منى فؤاد");
    expect(membership?.role).toBe(Role.Assistant);
    expect(membership?.rev).toBe(1);
    expect(verifyPin("4321", membership!.pin_salt!, membership!.pin_hash)).toBe(true);

    const after = await counts();
    expect(after.users).toBe(before.users);
    expect(after.memberships).toBe(before.memberships + 1);
    expect(after.syncOps).toBe(before.syncOps);
    const audit = (await db.audit_log.toArray()).filter((row) => row.entity_id === result.membershipId);
    expect(audit.map((row) => [row.entity, row.action])).toEqual([["memberships", "create"]]);
  });

  it("stores the membership_locations links the server returns for a listed location scope", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const [location] = await db.locations.toArray();
    const server = new RecordingStaffServer();

    const result = await addStaffMember(
      db,
      server,
      { orgId: org.id, ...baseInput, locationScope: LocationScope.Listed, listedLocationIds: [location.id] },
      true,
    );
    if (!result.ok) throw new Error("expected success");

    expect(server.requests[0].locations.map((link) => link.location_id)).toEqual([location.id]);
    const links = (await db.membership_locations.toArray()).filter((l) => l.membership_id === result.membershipId);
    expect(links).toHaveLength(1);
    expect(links[0].location_id).toBe(location.id);
    expect(links[0].id).toBe(server.requests[0].locations[0].id);
  });

  it("keeps the user the server linked an existing phone to", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();

    const result = await addStaffMember(db, new RecordingStaffServer({ existingUserId: "user-elsewhere" }), { orgId: org.id, ...baseInput }, true);
    if (!result.ok) throw new Error("expected success");

    expect((await db.memberships.get(result.membershipId))?.user_id).toBe("user-elsewhere");
  });

  it("refuses offline with nothing sent and nothing written", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const server = new RecordingStaffServer();
    const before = await counts();

    expect(await addStaffMember(db, server, { orgId: org.id, ...baseInput }, false)).toEqual({ ok: false, reason: "offline" });

    expect(server.requests).toHaveLength(0);
    expect(await counts()).toEqual(before);
  });

  it.each([
    ["unreachable", "offline"],
    ["already_member", "phone_taken"],
    ["not_allowed", "not_allowed"],
    ["failed", "failed"],
  ] as const)("maps a server %s to %s and writes nothing", async (failure, reason) => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const before = await counts();

    expect(await addStaffMember(db, new RecordingStaffServer({ failure }), { orgId: org.id, ...baseInput }, true)).toEqual({
      ok: false,
      reason,
    });
    expect(await counts()).toEqual(before);
  });

  it("checks the form before asking the server", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const server = new RecordingStaffServer();

    expect(await addStaffMember(db, server, { orgId: org.id, ...baseInput, phone: "123" }, true)).toEqual({
      ok: false,
      reason: "invalid_phone",
    });
    expect(await addStaffMember(db, server, { orgId: org.id, ...baseInput, fullName: " " }, true)).toEqual({
      ok: false,
      reason: "name_required",
    });
    expect(
      await addStaffMember(db, server, { orgId: org.id, ...baseInput, practitionerScope: PractitionerScope.Self }, true),
    ).toEqual({ ok: false, reason: "practitioner_required" });
    expect(server.requests).toHaveLength(0);
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
    const second = await addStaffMember(
      db,
      new RecordingStaffServer(),
      { orgId: org.id, ...baseInput, phone: "01098765434", role: Role.Owner },
      true,
    );
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

describe("updateMembership rename", () => {
  it("stores the trimmed name as display_name, leaves users.full_name alone, and queues a memberships op", async () => {
    await seedDatabase(db);
    const owner = await ownerMembership();
    const userBefore = await db.users.get(owner.user_id);
    const opsBefore = await db.sync_ops.count();

    expect(await updateMembership(db, owner.id, { displayName: "  د. أحمد  " })).toEqual({ ok: true });

    expect((await db.memberships.get(owner.id))?.display_name).toBe("د. أحمد");
    expect(await db.users.get(owner.user_id)).toEqual(userBefore);
    const ops = (await db.sync_ops.toArray()).slice(opsBefore);
    expect(ops.map((op) => op.entity)).toEqual(["memberships"]);
    expect((ops[0].payload as Membership).display_name).toBe("د. أحمد");
  });

  it("refuses an empty or over-long name and writes nothing", async () => {
    await seedDatabase(db);
    const owner = await ownerMembership();
    const opsBefore = await db.sync_ops.count();

    expect(await updateMembership(db, owner.id, { displayName: "   " })).toEqual({ ok: false, reason: "name_required" });
    expect(await updateMembership(db, owner.id, { displayName: "م".repeat(121) })).toEqual({
      ok: false,
      reason: "name_too_long",
    });
    expect((await db.memberships.get(owner.id))?.display_name ?? null).toBeNull();
    expect(await db.sync_ops.count()).toBe(opsBefore);
  });
});
