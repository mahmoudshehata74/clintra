import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import type { Visit } from "./types";
import { addToQueue, sendVisitToEndOfQueue, undoSendVisitToEndOfQueue } from "./visitQueue";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-visit-queue-test-${crypto.randomUUID()}`);
});

const QUEUE_DATE = "2026-09-08";

async function seededContext() {
  await seedDatabase(db);
  const [practitioner] = await db.practitioners.toArray();
  const [location] = await db.locations.toArray();
  const [service] = await db.services.toArray();
  const patients = await db.patients.toArray();
  return { practitioner, location, service, patients };
}

/** A queue-mode visit written directly (bypassing mutate()), at a given position. */
async function makeQueueVisit(
  overrides: Partial<Visit> & { position: number; practitioner_id: string; location_id: string; org_id: string; patient_id: string; service_id: string },
): Promise<Visit> {
  const visit = {
    id: id(),
    care_plan_item_id: null,
    visit_date: QUEUE_DATE,
    scheduled_at: null,
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: "2026-09-08T06:00:00.000Z",
    ...overrides,
  } satisfies Visit;
  await db.visits.add(visit);
  return visit;
}

describe("addToQueue", () => {
  it("writes the first visit at position 1", async () => {
    const { practitioner, location, service, patients } = await seededContext();

    const result = await addToQueue(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      patientId: patients[0].id,
      serviceId: service.id,
      visitDate: QUEUE_DATE,
    });

    expect(result.position).toBe(1);
    const visit = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).first();
    expect(visit?.status).toBe(VisitStatus.Booked);
    expect(visit?.scheduled_at).toBeNull();
  });

  it("writes each subsequent visit at the next position", async () => {
    const { practitioner, location, service, patients } = await seededContext();
    const input = {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      serviceId: service.id,
      visitDate: QUEUE_DATE,
    };

    const first = await addToQueue(db, { ...input, patientId: patients[0].id });
    const second = await addToQueue(db, { ...input, patientId: patients[1].id });

    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
  });

  it("walk-in: appends at the end and marks arrived in the same write", async () => {
    const { practitioner, location, service, patients } = await seededContext();
    const result = await addToQueue(db, {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      patientId: patients[0].id,
      serviceId: service.id,
      visitDate: QUEUE_DATE,
      status: VisitStatus.Arrived,
      source: VisitSource.Walkin,
    });

    const visit = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).first();
    expect(visit?.status).toBe(VisitStatus.Arrived);
    expect(visit?.source).toBe(VisitSource.Walkin);
    expect(visit?.arrived_at).not.toBeNull();
    expect(result.position).toBe(1);
  });

  it("two concurrent adds don't collide: both succeed with distinct sequential positions", async () => {
    const { practitioner, location, service, patients } = await seededContext();
    const input = {
      practitionerId: practitioner.id,
      locationId: location.id,
      orgId: practitioner.org_id,
      serviceId: service.id,
      visitDate: QUEUE_DATE,
    };

    const [first, second] = await Promise.all([
      addToQueue(db, { ...input, patientId: patients[0].id }),
      addToQueue(db, { ...input, patientId: patients[1].id }),
    ]);

    const positions = [first.position, second.position].sort();
    expect(positions).toEqual([1, 2]);
    const visits = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).toArray();
    expect(visits).toHaveLength(2);
  });
});

describe("sendVisitToEndOfQueue", () => {
  async function seedFiveWaitingVisits() {
    const { practitioner, location, service, patients } = await seededContext();
    const base = {
      practitioner_id: practitioner.id,
      location_id: location.id,
      org_id: practitioner.org_id,
      service_id: service.id,
    };
    const visits = await Promise.all(
      patients.map((patient, index) => makeQueueVisit({ ...base, position: index + 1, patient_id: patient.id })),
    );
    return { practitioner, location, visits };
  }

  it("shifts every later visit down by one and puts the pushed visit last", async () => {
    const { practitioner, visits } = await seedFiveWaitingVisits();
    const pushed = visits[1]; // position 2

    const result = await sendVisitToEndOfQueue(db, pushed.id);
    expect(result.ok).toBe(true);

    const after = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).toArray();
    const byId = new Map(after.map((v) => [v.id, v]));
    expect(byId.get(visits[0].id)?.position).toBe(1); // unaffected (before the pushed one)
    expect(byId.get(visits[2].id)?.position).toBe(2); // was 3
    expect(byId.get(visits[3].id)?.position).toBe(3); // was 4
    expect(byId.get(visits[4].id)?.position).toBe(4); // was 5
    expect(byId.get(pushed.id)?.position).toBe(5); // pushed to the end
  });

  it("preserves the exact set of visits and their statuses — only positions change", async () => {
    const { practitioner, visits } = await seedFiveWaitingVisits();
    await db.visits.update(visits[3].id, { status: VisitStatus.Arrived, arrived_at: "2026-09-08T07:00:00.000Z" });
    const before = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).toArray();
    const statusBeforeById = new Map(before.map((v) => [v.id, v.status]));

    await sendVisitToEndOfQueue(db, visits[0].id);

    const after = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).toArray();
    expect(after.map((v) => v.id).sort()).toEqual(before.map((v) => v.id).sort());
    for (const visit of after) {
      expect(visit.status).toBe(statusBeforeById.get(visit.id));
    }
  });

  it("is a no-op when the visit is already last", async () => {
    const { visits } = await seedFiveWaitingVisits();
    const last = visits[4];

    const result = await sendVisitToEndOfQueue(db, last.id);
    expect(result).toEqual({ ok: true, moves: [] });
    const unchanged = await db.visits.get(last.id);
    expect(unchanged?.position).toBe(5);
  });

  it("refuses a visit that is not waiting (e.g. in_room)", async () => {
    const { practitioner, location, service, patients } = await seededContext();
    const inRoom = await makeQueueVisit({
      practitioner_id: practitioner.id,
      location_id: location.id,
      org_id: practitioner.org_id,
      service_id: service.id,
      patient_id: patients[0].id,
      position: 1,
      status: VisitStatus.InRoom,
      started_at: "2026-09-08T09:00:00.000Z",
    });

    const result = await sendVisitToEndOfQueue(db, inRoom.id);
    expect(result).toEqual({ ok: false, reason: "not_waiting" });
  });

  it("refuses an unknown visit id", async () => {
    await seededContext();
    const result = await sendVisitToEndOfQueue(db, "does-not-exist");
    expect(result).toEqual({ ok: false, reason: "visit_not_found" });
  });
});

describe("undoSendVisitToEndOfQueue", () => {
  async function seedFiveWaitingVisits() {
    const { practitioner, location, service, patients } = await seededContext();
    const base = {
      practitioner_id: practitioner.id,
      location_id: location.id,
      org_id: practitioner.org_id,
      service_id: service.id,
    };
    const visits = await Promise.all(
      patients.map((patient, index) => makeQueueVisit({ ...base, position: index + 1, patient_id: patient.id })),
    );
    return { practitioner, location, visits };
  }

  it("restores the exact original position ordering", async () => {
    const { practitioner, visits } = await seedFiveWaitingVisits();
    const before = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).toArray();
    const positionBeforeById = new Map(before.map((v) => [v.id, v.position]));

    const result = await sendVisitToEndOfQueue(db, visits[1].id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const undoOutcome = await undoSendVisitToEndOfQueue(db, result.moves);
    expect(undoOutcome).toEqual({ ok: true });

    const after = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, QUEUE_DATE]).toArray();
    for (const visit of after) {
      expect(visit.position).toBe(positionBeforeById.get(visit.id));
    }
  });

  it("refuses when a moved visit's position has changed again since", async () => {
    const { visits } = await seedFiveWaitingVisits();
    const result = await sendVisitToEndOfQueue(db, visits[1].id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    // Something else repositions one of the affected visits before undo runs.
    const affectedVisitId = result.moves[0].visitId;
    await db.visits.update(affectedVisitId, { position: 999 });

    const undoOutcome = await undoSendVisitToEndOfQueue(db, result.moves);
    expect(undoOutcome).toEqual({ ok: false, reason: "stale" });
  });

  it("is a no-op for an empty move list (the already-last case)", async () => {
    const outcome = await undoSendVisitToEndOfQueue(db, []);
    expect(outcome).toEqual({ ok: true });
  });
});
