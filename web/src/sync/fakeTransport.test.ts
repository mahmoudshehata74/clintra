import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "../db/database";
import { AuditAction, type Visit } from "../db/types";
import { FakeTransport } from "./fakeTransport";

let serverDbName: string;

beforeEach(() => {
  serverDbName = `clintra-fake-server-test-${crypto.randomUUID()}`;
});

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: id(),
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-07",
    position: 1,
    scheduled_at: "2026-09-07T07:00:00.000Z",
    unique_scheduled_at: "2026-09-07T07:00:00.000Z",
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: "2026-09-07T06:00:00.000Z",
    ...overrides,
  };
}

function makeOp(visit: Visit, overrides: Partial<ReturnType<typeof baseOp>> = {}) {
  return { ...baseOp(visit), ...overrides };
}

function baseOp(visit: Visit) {
  return {
    op_id: id(),
    entity: "visits",
    entity_id: visit.id,
    action: AuditAction.Create,
    payload: visit,
    device_id: "device-1",
    created_at: visit.created_at,
    synced_at: null,
  };
}

describe("FakeTransport", () => {
  it("accepts a fresh op and applies it to its own database", async () => {
    const transport = new FakeTransport(serverDbName);
    const visit = makeVisit();
    const op = makeOp(visit);

    const [result] = await transport.pushOps([op]);
    expect(result).toEqual({ op_id: op.op_id, status: "accepted" });
  });

  it("dedups by op_id: resending the exact same op does not double-write", async () => {
    const transport = new FakeTransport(serverDbName);
    const visit = makeVisit();
    const op = makeOp(visit);

    const [first] = await transport.pushOps([op]);
    expect(first.status).toBe("accepted");

    const [second] = await transport.pushOps([op]);
    expect(second).toEqual({ op_id: op.op_id, status: "duplicate" });

    // Verify against a fresh connection to the same server database — not
    // an in-memory shortcut, an actual second read of a real database.
    const verifyDb = new ClintraDatabase(serverDbName);
    expect(await verifyDb.visits.count()).toBe(1);
  });

  it("rejects a later conflicting visit op with conflict_slot_taken, leaving the first untouched", async () => {
    const transport = new FakeTransport(serverDbName);
    const first = makeVisit({ id: id(), created_at: "2026-09-07T06:00:00.000Z" });
    const second = makeVisit({
      id: id(),
      patient_id: "patient-2",
      created_at: "2026-09-07T06:05:00.000Z",
      // Same practitioner_id + visit_date + position as `first` — a real collision.
    });

    const [firstResult] = await transport.pushOps([makeOp(first)]);
    expect(firstResult.status).toBe("accepted");

    const [secondResult] = await transport.pushOps([makeOp(second)]);
    expect(secondResult.status).toBe("rejected");
    expect(secondResult).toMatchObject({ reason: "conflict_slot_taken" });

    const verifyDb = new ClintraDatabase(serverDbName);
    const stored = await verifyDb.visits.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(first.id);
  });

  it("two FakeTransport instances with the same db name share one coherent view — proof it is a real database, not a Map", async () => {
    const transportA = new FakeTransport(serverDbName);
    const transportB = new FakeTransport(serverDbName);

    const visitA = makeVisit({ id: id(), position: 1 });
    const visitB = makeVisit({ id: id(), position: 2, scheduled_at: "2026-09-07T07:30:00.000Z", unique_scheduled_at: "2026-09-07T07:30:00.000Z" });

    const [resultA] = await transportA.pushOps([makeOp(visitA)]);
    const [resultB] = await transportB.pushOps([makeOp(visitB)]);
    expect(resultA.status).toBe("accepted");
    expect(resultB.status).toBe("accepted");

    // transportB's own pullSince sees the op transportA pushed, and vice
    // versa — only possible if they share the same underlying database.
    const seenByB = await transportB.pullSince(null);
    const seenByA = await transportA.pullSince(null);
    expect(seenByB.ops.map((op) => op.entity_id).sort()).toEqual([visitA.id, visitB.id].sort());
    expect(seenByA.ops.map((op) => op.entity_id).sort()).toEqual([visitA.id, visitB.id].sort());
  });

  describe("pullSince", () => {
    it("returns every applied op, oldest first, when cursor is null", async () => {
      const transport = new FakeTransport(serverDbName);
      const visit1 = makeVisit({ id: id(), position: 1, created_at: "2026-09-07T06:00:00.000Z" });
      const visit2 = makeVisit({
        id: id(),
        position: 2,
        scheduled_at: "2026-09-07T07:30:00.000Z",
        unique_scheduled_at: "2026-09-07T07:30:00.000Z",
        created_at: "2026-09-07T06:05:00.000Z",
      });

      await transport.pushOps([makeOp(visit1), makeOp(visit2)]);

      const result = await transport.pullSince(null);
      expect(result.ops.map((op) => op.entity_id)).toEqual([visit1.id, visit2.id]);
    });

    it("returns nothing new when nothing has been pushed since the cursor", async () => {
      const transport = new FakeTransport(serverDbName);
      const visit = makeVisit();
      await transport.pushOps([makeOp(visit)]);

      const first = await transport.pullSince(null);
      const second = await transport.pullSince(first.cursor);
      expect(second.ops).toEqual([]);
    });

    it("returns only ops pushed after the given cursor", async () => {
      const transport = new FakeTransport(serverDbName);
      const visit1 = makeVisit({ id: id(), position: 1, created_at: "2026-09-07T06:00:00.000Z" });
      await transport.pushOps([makeOp(visit1)]);
      const afterFirst = await transport.pullSince(null);

      const visit2 = makeVisit({
        id: id(),
        position: 2,
        scheduled_at: "2026-09-07T07:30:00.000Z",
        unique_scheduled_at: "2026-09-07T07:30:00.000Z",
        created_at: "2026-09-07T06:05:00.000Z",
      });
      await transport.pushOps([makeOp(visit2)]);

      const result = await transport.pullSince(afterFirst.cursor);
      expect(result.ops.map((op) => op.entity_id)).toEqual([visit2.id]);
    });
  });

  // Regression coverage for every entity mutate()/runAtomicMutations()
  // writes today (see fakeTransport.ts's tableForEntity) — invoicing added
  // four new ones in one task and FakeTransport did not know about any of
  // them until a real-browser smoke test caught it, since nothing else in
  // the test suite ever pushed these entities through sync.
  describe.each(["invoices", "invoice_items", "payments", "cash_close", "schedules"])("entity coverage: %s", (entity) => {
    it(`accepts a push for entity "${entity}" instead of throwing fake_transport_unknown_entity`, async () => {
      const transport = new FakeTransport(serverDbName);
      const op = {
        op_id: id(),
        entity,
        entity_id: id(),
        action: AuditAction.Create,
        payload: { id: id() },
        device_id: "device-1",
        created_at: "2026-09-07T06:00:00.000Z",
        synced_at: null,
      };

      const [result] = await transport.pushOps([op]);
      expect(result.status).toBe("accepted");
    });
  });
});
