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
});
