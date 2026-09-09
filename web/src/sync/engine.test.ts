import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "../db/database";
import { mutate } from "../db/mutate";
import { AuditAction, type SyncOp, type Visit } from "../db/types";
import { FakeTransport } from "./fakeTransport";
import { runSyncCycle, startSyncEngine } from "./engine";
import type { PullSinceResult, PushOpResult, SyncTransport } from "./transport";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-sync-engine-test-${crypto.randomUUID()}`);
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

async function writeVisit(visit: Visit): Promise<void> {
  await mutate(db, {
    table: db.visits,
    entity: "visits",
    entityId: visit.id,
    action: AuditAction.Create,
    before: null,
    after: visit,
    actorMembershipId: "membership-1",
    orgId: visit.org_id,
  });
}

/** A stub transport with full control over per-op outcomes and call recording. */
class StubTransport implements SyncTransport {
  calls: SyncOp[][] = [];
  private readonly outcomeFor: (op: SyncOp) => PushOpResult;

  constructor(outcomeFor: (op: SyncOp) => PushOpResult) {
    this.outcomeFor = outcomeFor;
  }

  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    this.calls.push([...ops]);
    return ops.map((op) => this.outcomeFor(op));
  }

  async pullSince(): Promise<PullSinceResult> {
    return { cursor: "", ops: [] };
  }
}

describe("runSyncCycle", () => {
  it("marks synced_at on accepted ops and does not resend them", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted" }));

    await runSyncCycle(db, transport);

    const [op] = await db.sync_ops.toArray();
    expect(op.synced_at).not.toBeNull();
    expect(transport.calls).toHaveLength(1);

    await runSyncCycle(db, transport);
    // No unsent ops left, so pushOps is never called a second time.
    expect(transport.calls).toHaveLength(1);
  });

  it("marks synced_at on a duplicate result too, same as accepted", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "duplicate" }));

    await runSyncCycle(db, transport);

    const [op] = await db.sync_ops.toArray();
    expect(op.synced_at).not.toBeNull();
  });

  it("writes a sync_review row for a rejected op without deleting or marking the sync_op", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({
      op_id: op.op_id,
      status: "rejected",
      reason: "conflict_slot_taken",
    }));

    await runSyncCycle(db, transport);

    const [op] = await db.sync_ops.toArray();
    expect(op).toBeTruthy();
    expect(op.synced_at).toBeNull();

    const reviews = await db.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      op_id: op.op_id,
      entity: "visits",
      entity_id: visit.id,
      reason: "conflict_slot_taken",
      needs_review: true,
    });
    expect(reviews[0].payload).toEqual(visit);
  });

  it("does not re-push an op that already has an open review row, avoiding duplicate review spam every cycle", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({
      op_id: op.op_id,
      status: "rejected",
      reason: "conflict_slot_taken",
    }));

    await runSyncCycle(db, transport);
    expect(transport.calls).toHaveLength(1);
    expect(await db.sync_review.count()).toBe(1);

    await runSyncCycle(db, transport);
    // Still unsent, but its review is still open, so it is not resent.
    expect(transport.calls).toHaveLength(1);
    expect(await db.sync_review.count()).toBe(1);
  });

  it("preserves chronological order on push, regardless of local insertion order", async () => {
    // sync_ops.created_at is stamped by mutate() at write time, not read off
    // the payload — so to control ordering directly, write the sync_ops rows
    // themselves (this is exactly what the engine reads; it never inspects
    // the payload's own created_at field).
    const early: SyncOp = {
      op_id: "op-early",
      entity: "visits",
      entity_id: "visit-early",
      action: AuditAction.Create,
      payload: makeVisit({ id: "visit-early" }),
      device_id: "device-1",
      created_at: "2026-09-07T06:00:00.000Z",
      synced_at: null,
    };
    const middle: SyncOp = { ...early, op_id: "op-middle", entity_id: "visit-middle", created_at: "2026-09-07T06:05:00.000Z" };
    const late: SyncOp = { ...early, op_id: "op-late", entity_id: "visit-late", created_at: "2026-09-07T06:10:00.000Z" };

    // Inserted out of chronological order.
    await db.sync_ops.bulkAdd([late, early, middle]);

    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted" }));
    await runSyncCycle(db, transport);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].map((op) => op.op_id)).toEqual([early.op_id, middle.op_id, late.op_id]);
  });

  it("does nothing when there is nothing unsent", async () => {
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted" }));
    await runSyncCycle(db, transport);
    expect(transport.calls).toHaveLength(0);
  });
});

describe("runSyncCycle against FakeTransport: two concurrent bookings on the same slot", () => {
  it("exactly one reaches the fake server; the other becomes a review row with conflict_slot_taken", async () => {
    const serverName = `clintra-fake-server-concurrent-test-${crypto.randomUUID()}`;
    const dbA = new ClintraDatabase(`clintra-device-a-${crypto.randomUUID()}`);
    const dbB = new ClintraDatabase(`clintra-device-b-${crypto.randomUUID()}`);
    const transportA = new FakeTransport(serverName);
    const transportB = new FakeTransport(serverName);

    // Two different devices, each independently booking the same
    // practitioner+date+position — the exact race two tabs could produce.
    const visitA = makeVisit({ id: id(), created_by: "membership-a" });
    const visitB = makeVisit({ id: id(), created_by: "membership-b", patient_id: "patient-2" });

    await mutate(dbA, {
      table: dbA.visits,
      entity: "visits",
      entityId: visitA.id,
      action: AuditAction.Create,
      before: null,
      after: visitA,
      actorMembershipId: "membership-a",
      orgId: "org-1",
    });
    await mutate(dbB, {
      table: dbB.visits,
      entity: "visits",
      entityId: visitB.id,
      action: AuditAction.Create,
      before: null,
      after: visitB,
      actorMembershipId: "membership-b",
      orgId: "org-1",
    });

    await runSyncCycle(dbA, transportA);
    await runSyncCycle(dbB, transportB);

    const [opA] = await dbA.sync_ops.toArray();
    const [opB] = await dbB.sync_ops.toArray();
    expect(opA.synced_at).not.toBeNull();
    expect(opB.synced_at).toBeNull();

    expect(await dbA.sync_review.count()).toBe(0);
    const reviewsB = await dbB.sync_review.toArray();
    expect(reviewsB).toHaveLength(1);
    expect(reviewsB[0].reason).toBe("conflict_slot_taken");
    // The losing operation's payload is preserved, not discarded.
    expect(reviewsB[0].payload).toEqual(visitB);

    const serverDb = new ClintraDatabase(serverName);
    const serverVisits = await serverDb.visits.toArray();
    expect(serverVisits).toHaveLength(1);
    expect(serverVisits[0].id).toBe(visitA.id);
  });
});

describe("startSyncEngine", () => {
  it("never runs a cycle concurrently with itself", async () => {
    // Something must actually be unsent, or runSyncCycle returns before ever
    // calling pushOps and this test would pass without exercising anything.
    await writeVisit(makeVisit());

    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted" }));
    const originalPushOps = transport.pushOps.bind(transport);
    transport.pushOps = async (ops) => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      // Holds the "in-flight" window open long enough for a same-tick
      // trigger to prove it gets dropped rather than starting a second run.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await originalPushOps(ops);
      concurrentCalls--;
      return result;
    };

    const handle = startSyncEngine(db, transport, 1000);
    // Fired synchronously, immediately after the engine's own initial run —
    // every one of these must see isRunning already true and no-op.
    handle.triggerSync();
    handle.triggerSync();
    handle.triggerSync();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(maxConcurrent).toBeLessThanOrEqual(1);
    handle.stop();
  });
});
