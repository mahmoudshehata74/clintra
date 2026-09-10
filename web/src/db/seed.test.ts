import { beforeEach, describe, expect, it } from "vitest";
import { ScheduleMode } from "../domain/scheduleMode";
import { weekdayOf } from "../domain/time";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { findSeededQueuePractitioner, findSeededSlotsPractitioner, seedDatabase, seededVisitsDate } from "./seed";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-seed-test-${crypto.randomUUID()}`);
});

describe("seedDatabase", () => {
  it("populates one organization, location, practitioner, assistant and owner memberships and three services", async () => {
    await seedDatabase(db);

    expect(await db.organizations.count()).toBe(1);
    expect(await db.locations.count()).toBe(1);
    expect(await db.practitioners.count()).toBe(1);
    expect(await db.services.count()).toBe(3);

    const memberships = await db.memberships.toArray();
    expect(memberships).toHaveLength(2);
    expect([...memberships].map((membership) => membership.role).sort()).toEqual(["assistant", "owner"]);
  });

  it("does not duplicate data when run more than once", async () => {
    await seedDatabase(db);
    await seedDatabase(db);
    await seedDatabase(db);

    expect(await db.organizations.count()).toBe(1);
    expect(await db.locations.count()).toBe(1);
    expect(await db.practitioners.count()).toBe(1);
    expect(await db.memberships.count()).toBe(2);
    expect(await db.services.count()).toBe(3);
  });

  it("links the practitioner to the general specialty template", async () => {
    await seedDatabase(db);

    const [practitioner] = await db.practitioners.toArray();
    const specialty = await db.specialty_templates.get(practitioner.specialty_id);

    expect(specialty?.key).toBe("general");
  });

  it("seeds a working schedule for every weekday, so today's grid always has one", async () => {
    await seedDatabase(db);

    const schedules = await db.schedules.toArray();
    expect(schedules).toHaveLength(7);
    expect(schedules.map((s) => s.weekday).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    for (const schedule of schedules) {
      expect(schedule.start_time).toBe("09:00");
      expect(schedule.end_time).toBe("14:00");
      expect(schedule.slot_minutes).toBe(30);
    }
  });

  it("places the demo visits on a deterministic date rather than on whichever day the seed runs", async () => {
    await seedDatabase(db);

    const visits = await db.visits.toArray();
    expect(visits).toHaveLength(5);

    const expectedDate = seededVisitsDate();
    // Monday, matching the deterministic weekday the seed always targets.
    expect(weekdayOf(expectedDate)).toBe(1);
    for (const visit of visits) {
      expect(visit.visit_date).toBe(expectedDate);
    }
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

  describe("{ includeQueueDemo: true }", () => {
    it("adds a second, queue-mode practitioner without touching the first one's data", async () => {
      await seedDatabase(db, { includeQueueDemo: true });

      expect(await db.practitioners.count()).toBe(2);
      expect(await db.organizations.count()).toBe(1);
      expect(await db.locations.count()).toBe(1);

      const slotsPractitioner = await findSeededSlotsPractitioner(db);
      const queuePractitioner = await findSeededQueuePractitioner(db);
      expect(slotsPractitioner.id).not.toBe(queuePractitioner.id);

      // The original slots-mode data is exactly as it is without the option.
      const slotsVisits = (await db.visits.toArray()).filter((v) => v.practitioner_id === slotsPractitioner.id);
      expect(slotsVisits).toHaveLength(5);
    });

    it("gives the queue practitioner a queue-mode schedule every weekday and six demo visits", async () => {
      await seedDatabase(db, { includeQueueDemo: true });
      const queuePractitioner = await findSeededQueuePractitioner(db);

      const schedules = (await db.schedules.toArray()).filter((s) => s.practitioner_id === queuePractitioner.id);
      expect(schedules).toHaveLength(7);
      for (const schedule of schedules) {
        expect(schedule.mode).toBe(ScheduleMode.Queue);
      }

      const visits = (await db.visits.toArray()).filter((v) => v.practitioner_id === queuePractitioner.id);
      expect(visits).toHaveLength(6);
      for (const visit of visits) {
        expect(visit.scheduled_at).toBeNull();
      }
      expect(visits.filter((v) => v.status === VisitStatus.Completed)).toHaveLength(2);
    });

    it("seeds a day_state row with the median of the two completed demo visits' durations", async () => {
      await seedDatabase(db, { includeQueueDemo: true });
      const queuePractitioner = await findSeededQueuePractitioner(db);
      const [location] = await db.locations.toArray();

      const dayState = await db.day_state
        .where("[practitioner_id+location_id+date]")
        .equals([queuePractitioner.id, location.id, seededVisitsDate()])
        .first();
      expect(dayState?.avg_consult_minutes).toBe(11);
    });
  });

  it("does not add a second practitioner without includeQueueDemo — every existing caller's assumption of one practitioner is unaffected", async () => {
    await seedDatabase(db);
    expect(await db.practitioners.count()).toBe(1);
  });
});
