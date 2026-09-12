import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "../db/database";
import { mutate } from "../db/mutate";
import { getDeviceId } from "../db/deviceRegistration";
import { AuditAction, type SyncOp, type Visit } from "../db/types";
import { FakeTransport } from "./fakeTransport";
import {
  describeFailedOpEscalation,
  isServerUnreachable,
  resetTransportHealthForTests,
  runPullCycle,
  runSyncCycle,
  startSyncEngine,
} from "./engine";
import { SyncAuthError, type PulledChange, type PullSinceResult, type PushOpResult, type SyncTransport } from "./transport";

let db: ClintraDatabase;

beforeEach(() => {
  resetTransportHealthForTests();
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
    rev: 1,
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
  pullCalls: (string | null)[] = [];
  pullOutcomeFor: (cursor: string | null) => PullSinceResult | Promise<PullSinceResult> = () => ({
    cursor: "",
    hasMore: false,
    changes: [],
  });
  private readonly outcomeFor: (op: SyncOp) => PushOpResult;

  constructor(outcomeFor: (op: SyncOp) => PushOpResult) {
    this.outcomeFor = outcomeFor;
  }

  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    this.calls.push([...ops]);
    return ops.map((op) => this.outcomeFor(op));
  }

  async pullSince(cursor: string | null): Promise<PullSinceResult> {
    this.pullCalls.push(cursor);
    return this.pullOutcomeFor(cursor);
  }
}

const BASE_SYNC_OP_FIELDS = { base_rev: null, failure_count: 0, next_retry_at: null } as const;

describe("runSyncCycle", () => {
  it("marks synced_at on accepted ops and does not resend them", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted", rev: 1 }));

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
      ...BASE_SYNC_OP_FIELDS,
    };
    const middle: SyncOp = { ...early, op_id: "op-middle", entity_id: "visit-middle", created_at: "2026-09-07T06:05:00.000Z" };
    const late: SyncOp = { ...early, op_id: "op-late", entity_id: "visit-late", created_at: "2026-09-07T06:10:00.000Z" };

    // Inserted out of chronological order.
    await db.sync_ops.bulkAdd([late, early, middle]);

    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted", rev: 1 }));
    await runSyncCycle(db, transport);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].map((op) => op.op_id)).toEqual([early.op_id, middle.op_id, late.op_id]);
  });

  it("does nothing when there is nothing unsent", async () => {
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
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
    // runPullCycle (chained after runSyncCycle in runGuarded) requires a
    // registered device — without one it would throw on every tick,
    // caught by the outer catch, but noisily and pointlessly for a test
    // about push concurrency specifically.
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: null,
      membership_id: null,
      token: null,
    });

    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted", rev: 1 }));
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

describe("runSyncCycle: accepted writes the server's rev back to the local row", () => {
  it("updates the entity row's rev field on an accepted create/update", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted", rev: 7 }));

    await runSyncCycle(db, transport);

    const stored = await db.visits.get(visit.id);
    expect(stored?.rev).toBe(7);
  });

  it("does not throw when the accepted op was a delete (no local row left to update)", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    await db.visits.delete(visit.id);
    await db.sync_ops.toCollection().modify({ action: AuditAction.Delete });
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted", rev: 2 }));

    await expect(runSyncCycle(db, transport)).resolves.toBeUndefined();
  });
});

describe("runSyncCycle: failed vs blocked (docs/sync-plan.md's Q11/Q2)", () => {
  it("a failed op is retried with backoff and never enters sync_review", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "failed", reason: "internal_error" }));

    await runSyncCycle(db, transport);

    const [op] = await db.sync_ops.toArray();
    expect(op.synced_at).toBeNull();
    expect(op.failure_count).toBe(1);
    expect(op.next_retry_at).not.toBeNull();
    expect(new Date(op.next_retry_at!).getTime()).toBeGreaterThan(Date.now());
    expect(await db.sync_review.count()).toBe(0);

    // Backed off: a second cycle right away must not resend it yet.
    await runSyncCycle(db, transport);
    expect(transport.calls).toHaveLength(1);

    // Once the backoff window has passed, it is eligible again.
    await db.sync_ops.update(op.op_id, { next_retry_at: new Date(Date.now() - 1000).toISOString() });
    await runSyncCycle(db, transport);
    expect(transport.calls).toHaveLength(2);
    const [retried] = await db.sync_ops.toArray();
    expect(retried.failure_count).toBe(2);
  });

  it("a blocked op stays queued untouched and is retried next cycle, never reviewed", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "blocked" }));

    await runSyncCycle(db, transport);

    const [op] = await db.sync_ops.toArray();
    expect(op.synced_at).toBeNull();
    expect(op.failure_count).toBe(0);
    expect(await db.sync_review.count()).toBe(0);

    await runSyncCycle(db, transport);
    expect(transport.calls).toHaveLength(2);
  });
});

describe("describeFailedOpEscalation", () => {
  const baseOp: SyncOp = {
    op_id: "12345678-abcd",
    entity: "visits",
    entity_id: "visit-1",
    action: AuditAction.Update,
    payload: {},
    device_id: "device-1",
    created_at: "2026-09-07T06:00:00.000Z",
    synced_at: null,
    ...BASE_SYNC_OP_FIELDS,
  };

  it("returns null below the escalation cap — nothing is ever shown for an ordinary retry", () => {
    expect(describeFailedOpEscalation({ ...baseOp, failure_count: 4 })).toBeNull();
  });

  it("returns a stable, quotable reference code once the cap is reached", () => {
    const escalation = describeFailedOpEscalation({ ...baseOp, failure_count: 5 });
    expect(escalation).not.toBeNull();
    expect(escalation!.referenceCode).toBe("12345678".toUpperCase());
  });
});

describe("runPullCycle", () => {
  beforeEach(async () => {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: null,
      membership_id: null,
      token: null,
    });
  });

  it("throws when no device is registered — pull has no meaning without one", async () => {
    const freshDb = new (Object.getPrototypeOf(db).constructor)(`clintra-pull-unregistered-${crypto.randomUUID()}`);
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    await expect(runPullCycle(freshDb, transport)).rejects.toThrow("pull_requires_registered_device");
  });

  it("applies a pulled change (upsert) and advances the persisted cursor", async () => {
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    const change: PulledChange = {
      entity: "patients",
      entity_id: "patient-remote-1",
      rev: 3,
      payload: {
        id: "patient-remote-1",
        org_id: "org-1",
        full_name: "مريض بعيد",
        phone: null,
        gender: null,
        birth_year: null,
        note: null,
        created_at: "2026-09-07T06:00:00.000Z",
        rev: 3,
      },
    };
    transport.pullOutcomeFor = () => ({ cursor: "10", hasMore: false, changes: [change] });

    await runPullCycle(db, transport);

    const stored = await db.patients.get("patient-remote-1");
    expect(stored?.rev).toBe(3);
    expect((await db.device.get(getDeviceId()))?.pull_cursor).toBe("10");
  });

  it("deletes the local row when a pulled change's payload is null", async () => {
    await db.patients.add({
      id: "patient-to-delete",
      org_id: "org-1",
      full_name: "سيُحذف",
      phone: null,
      gender: null,
      birth_year: null,
      note: null,
      created_at: "2026-09-07T06:00:00.000Z",
      rev: 1,
    });
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullOutcomeFor = () => ({
      cursor: "11",
      hasMore: false,
      changes: [{ entity: "patients", entity_id: "patient-to-delete", rev: 2, payload: null }],
    });

    await runPullCycle(db, transport);

    expect(await db.patients.get("patient-to-delete")).toBeUndefined();
  });

  it("follows hasMore across pages before returning, resuming from each page's own cursor", async () => {
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    const pages: Record<string, PullSinceResult> = {
      null: { cursor: "1", hasMore: true, changes: [] },
      "1": { cursor: "2", hasMore: false, changes: [] },
    };
    transport.pullOutcomeFor = (cursor) => pages[cursor === null ? "null" : cursor];

    await runPullCycle(db, transport);

    expect(transport.pullCalls).toEqual([null, "1"]);
    expect((await db.device.get(getDeviceId()))?.pull_cursor).toBe("2");
  });
});

describe("SyncAuthError: a 401 is surfaced, never left to throw uncaught into a bare console.error", () => {
  // This suite runs without a DOM (no jsdom — see vitest.config.ts), so
  // SYNC_AUTH_ERROR_EVENT_NAME's actual window dispatch is untestable here,
  // the same as MUTATION_EVENT_NAME's dispatch always has been; both are
  // guarded by the identical `typeof window !== "undefined"` check
  // (mutate.ts's notifyMutationCommitted, engine.ts's notifySyncAuthError).
  // What is testable, and is the actual behavior this task requires, is
  // that a SyncAuthError from the transport resolves the cycle cleanly
  // instead of rejecting it — the thing that would otherwise reach
  // startSyncEngine's generic `.catch(console.error)`.
  it("runSyncCycle resolves cleanly on a SyncAuthError instead of rejecting", async () => {
    await writeVisit(makeVisit());
    const transport: SyncTransport = {
      pushOps: () => {
        throw new SyncAuthError();
      },
      pullSince: async () => ({ cursor: "", hasMore: false, changes: [] }),
    };

    await expect(runSyncCycle(db, transport)).resolves.toBeUndefined();
  });

  it("runPullCycle resolves cleanly on a SyncAuthError instead of rejecting", async () => {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: null,
      membership_id: null,
      token: null,
    });
    const transport: SyncTransport = {
      pushOps: async () => [],
      pullSince: () => {
        throw new SyncAuthError();
      },
    };

    await expect(runPullCycle(db, transport)).resolves.toBeUndefined();
  });
});

describe("isServerUnreachable: the sync chip's fourth state (docs/sync-plan.md's Q10)", () => {
  async function registerDevice() {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: null,
      membership_id: null,
      token: null,
    });
  }

  function throwingTransport(): SyncTransport {
    return {
      pushOps: async () => {
        throw new Error("network down");
      },
      pullSince: async () => {
        throw new Error("network down");
      },
    };
  }

  it("stays false below the consecutive-failure threshold, then flips true once it's reached", async () => {
    await registerDevice();
    const transport = throwingTransport();

    expect(isServerUnreachable()).toBe(false);
    await runPullCycle(db, transport); // 1
    expect(isServerUnreachable()).toBe(false);
    await runPullCycle(db, transport); // 2
    expect(isServerUnreachable()).toBe(false);
    await runPullCycle(db, transport); // 3 — the threshold
    expect(isServerUnreachable()).toBe(true);
  });

  // SYNC_TRANSPORT_STATUS_EVENT_NAME's actual window dispatch is
  // untestable in this suite (no jsdom — see vitest.config.ts), the same
  // as SyncAuthError's own event in the tests above; both are guarded by
  // an identical `typeof window !== "undefined"` check. What's tested
  // here is the state transition the event exists to announce.

  it("returns to normal (and fires the event again) on the very next success — no lingering unreachable state", async () => {
    await registerDevice();
    const failing = throwingTransport();
    await runPullCycle(db, failing);
    await runPullCycle(db, failing);
    await runPullCycle(db, failing);
    expect(isServerUnreachable()).toBe(true);

    const recovered: SyncTransport = {
      pushOps: async () => [],
      pullSince: async () => ({ cursor: "", hasMore: false, changes: [] }),
    };
    await runPullCycle(db, recovered);

    expect(isServerUnreachable()).toBe(false);
  });

  it("a SyncAuthError never counts as a transport failure — it is a different, already-handled signal", async () => {
    await registerDevice();
    const authFailing: SyncTransport = {
      pushOps: async () => [],
      pullSince: async () => {
        throw new SyncAuthError();
      },
    };

    await runPullCycle(db, authFailing);
    await runPullCycle(db, authFailing);
    await runPullCycle(db, authFailing);
    await runPullCycle(db, authFailing);

    expect(isServerUnreachable()).toBe(false);
  });
});
