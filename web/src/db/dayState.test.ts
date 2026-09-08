import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "./database";
import { setDayDelay } from "./dayState";
import { undoMostRecentDayStateMutation } from "./mutate";
import { seedDatabase } from "./seed";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-day-state-test-${crypto.randomUUID()}`);
});

async function seededContext() {
  await seedDatabase(db);
  const [practitioner] = await db.practitioners.toArray();
  const [location] = await db.locations.toArray();
  const [visit] = await db.visits.toArray();
  return { practitioner, location, date: visit.visit_date };
}

describe("setDayDelay", () => {
  it("creates a day_state row scoped to practitioner + location + date", async () => {
    const { practitioner, location, date } = await seededContext();

    await setDayDelay(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      date,
      delayMinutes: 30,
    });

    const rows = await db.day_state.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      practitioner_id: practitioner.id,
      location_id: location.id,
      date,
      delay_minutes: 30,
      is_closed: false,
      avg_consult_minutes: null,
    });
  });

  it("updates the same row rather than creating a second one for the same day", async () => {
    const { practitioner, location, date } = await seededContext();

    await setDayDelay(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      date,
      delayMinutes: 15,
    });
    await setDayDelay(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      date,
      delayMinutes: 60,
    });

    const rows = await db.day_state.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].delay_minutes).toBe(60);
  });

  it("clearing the delay sets it back to zero rather than deleting the row", async () => {
    const { practitioner, location, date } = await seededContext();

    await setDayDelay(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      date,
      delayMinutes: 30,
    });
    await setDayDelay(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      date,
      delayMinutes: 0,
    });

    const rows = await db.day_state.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].delay_minutes).toBe(0);
  });

  it("is undoable through the constrained undo mechanism", async () => {
    const { practitioner, location, date } = await seededContext();

    const auditLogId = await setDayDelay(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      date,
      delayMinutes: 30,
    });

    const outcome = await undoMostRecentDayStateMutation(db, auditLogId);
    expect(outcome).toEqual({ ok: true });
    expect(await db.day_state.count()).toBe(0);
  });

  it("does not create a second row when two calls for the same day run concurrently", async () => {
    const { practitioner, location, date } = await seededContext();

    await Promise.all([
      setDayDelay(db, {
        practitionerId: practitioner.id,
        locationId: location.id,
        orgId: practitioner.org_id,
        date,
        delayMinutes: 15,
      }),
      setDayDelay(db, {
        practitionerId: practitioner.id,
        locationId: location.id,
        orgId: practitioner.org_id,
        date,
        delayMinutes: 30,
      }),
    ]);

    expect(await db.day_state.count()).toBe(1);
  });
});
