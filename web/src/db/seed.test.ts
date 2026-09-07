import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-seed-test-${crypto.randomUUID()}`);
});

describe("seedDatabase", () => {
  it("populates one organization, location, practitioner, assistant membership and three services", async () => {
    await seedDatabase(db);

    expect(await db.organizations.count()).toBe(1);
    expect(await db.locations.count()).toBe(1);
    expect(await db.practitioners.count()).toBe(1);
    expect(await db.services.count()).toBe(3);

    const memberships = await db.memberships.toArray();
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("assistant");
  });

  it("does not duplicate data when run more than once", async () => {
    await seedDatabase(db);
    await seedDatabase(db);
    await seedDatabase(db);

    expect(await db.organizations.count()).toBe(1);
    expect(await db.locations.count()).toBe(1);
    expect(await db.practitioners.count()).toBe(1);
    expect(await db.memberships.count()).toBe(1);
    expect(await db.services.count()).toBe(3);
  });

  it("links the practitioner to the general specialty template", async () => {
    await seedDatabase(db);

    const [practitioner] = await db.practitioners.toArray();
    const specialty = await db.specialty_templates.get(practitioner.specialty_id);

    expect(specialty?.key).toBe("general");
  });

  it("does not create duplicate data when two connections seed the same empty database concurrently", async () => {
    // Regression test: this reproduces two tabs (or a double effect
    // invocation) both loading the app for the first time against an empty
    // database. Before the fix, the emptiness check ran outside the write
    // transaction, so both calls could read "empty" before either committed,
    // producing two organizations and ten visits instead of one and five.
    const name = `clintra-seed-race-test-${crypto.randomUUID()}`;
    const dbA = new ClintraDatabase(name);
    const dbB = new ClintraDatabase(name);

    await Promise.all([seedDatabase(dbA), seedDatabase(dbB)]);

    expect(await dbA.organizations.count()).toBe(1);
    expect(await dbA.practitioners.count()).toBe(1);
    expect(await dbA.visits.count()).toBe(5);
  });
});
