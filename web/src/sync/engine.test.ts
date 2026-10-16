import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "../db/database";
import { mutate } from "../db/mutate";
import { getDeviceId } from "../db/deviceRegistration";
import { AuditAction, type SyncOp, type Visit } from "../db/types";
import { FakeTransport } from "./fakeTransport";
import {
  DEVICE_SERIES_CONFLICT_REASON,
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
    note: null,
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
  bootstrapCalls: (string | null)[] = [];
  /** Immediately-done by default: most tests don't care about bootstrap at all, only runPullCycle's own pullSince loop. */
  pullBootstrapOutcomeFor: (cursor: string | null) => PullSinceResult | Promise<PullSinceResult> = () => ({
    cursor: "3:",
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

  async pullBootstrap(cursor: string | null): Promise<PullSinceResult> {
    this.bootstrapCalls.push(cursor);
    return this.pullBootstrapOutcomeFor(cursor);
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
      series: 1,
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

  it("runs no cycle before the device is ready, then pulls the moment it is, without waiting for the timer", async () => {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: "0",
      membership_id: null,
      token: null,
      series: 1,
    });
    await writeVisit(makeVisit());

    let isReady = false;
    const listeners = new Set<() => void>();
    const readiness = {
      isReady: () => isReady,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const transport = new StubTransport((op) => ({ op_id: op.op_id, status: "accepted", rev: 1 }));
    let resolvePulled: () => void = () => {};
    const pulled = new Promise<void>((resolve) => {
      resolvePulled = resolve;
    });
    transport.pullOutcomeFor = () => {
      resolvePulled();
      return { cursor: "1", hasMore: false, changes: [] };
    };

    // An hour-long interval: only readiness can start the cycle this test waits for.
    const handle = startSyncEngine(db, transport, 60 * 60 * 1000, readiness);
    handle.triggerSync();
    expect(transport.calls).toHaveLength(0);
    expect(transport.pullCalls).toHaveLength(0);

    isReady = true;
    for (const listener of listeners) {
      listener();
    }
    await pulled;

    expect(transport.calls).toHaveLength(1);
    expect(transport.pullCalls).toEqual(["0"]);
    handle.stop();
    expect(listeners.size).toBe(0);
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
      series: 1,
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

describe("runPullCycle: bootstrap gating (docs/dry-run.md's scenario 17)", () => {
  it("drains pullBootstrap fully, applying its changes, before ever calling pullSince — only when pull_cursor is null", async () => {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: null,
      membership_id: null,
      token: null,
      series: 1,
    });
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    const bootstrapPages: Record<string, PullSinceResult> = {
      null: {
        cursor: "1:",
        hasMore: true,
        changes: [{ entity: "day_state", entity_id: "day-1", rev: 1, payload: { id: "day-1", date: "2026-09-13" } }],
      },
      "1:": {
        cursor: "3:",
        hasMore: false,
        changes: [{ entity: "visits", entity_id: "visit-today", rev: 1, payload: { id: "visit-today" } }],
      },
    };
    transport.pullBootstrapOutcomeFor = (cursor) => bootstrapPages[cursor === null ? "null" : cursor];
    transport.pullOutcomeFor = () => ({ cursor: "0", hasMore: false, changes: [] });

    await runPullCycle(db, transport);

    expect(transport.bootstrapCalls).toEqual([null, "1:"]);
    // Bootstrap ran to completion strictly before the ordinary backfill started.
    expect(transport.pullCalls).toEqual([null]);
    expect(await db.day_state.get("day-1")).toMatchObject({ id: "day-1" });
    expect(await db.visits.get("visit-today")).toMatchObject({ id: "visit-today" });
    // Only the ordinary loop ever persists pull_cursor — bootstrap never does.
    expect((await db.device.get(getDeviceId()))?.pull_cursor).toBe("0");
  });

  it("never calls pullBootstrap once the device has completed a pull cycle before (pull_cursor is non-null)", async () => {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: "5",
      membership_id: null,
      token: null,
      series: 1,
    });
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullOutcomeFor = () => ({ cursor: "5", hasMore: false, changes: [] });

    await runPullCycle(db, transport);

    expect(transport.bootstrapCalls).toEqual([]);
    expect(transport.pullCalls).toEqual(["5"]);
  });

  it("a bootstrap transport failure does not prevent the ordinary backfill from still running", async () => {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: null,
      membership_id: null,
      token: null,
      series: 1,
    });
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullBootstrapOutcomeFor = () => {
      throw new Error("network down mid-bootstrap");
    };
    transport.pullOutcomeFor = () => ({ cursor: "0", hasMore: false, changes: [] });

    await expect(runPullCycle(db, transport)).resolves.toBeUndefined();

    expect(transport.bootstrapCalls).toEqual([null]);
    expect(transport.pullCalls).toEqual([null]);
    expect((await db.device.get(getDeviceId()))?.pull_cursor).toBe("0");
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
      pullBootstrap: async () => ({ cursor: "3:", hasMore: false, changes: [] }),
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
      series: 1,
    });
    const transport: SyncTransport = {
      pushOps: async () => [],
      pullSince: () => {
        throw new SyncAuthError();
      },
      pullBootstrap: async () => ({ cursor: "3:", hasMore: false, changes: [] }),
    };

    await expect(runPullCycle(db, transport)).resolves.toBeUndefined();
  });
});

describe("isServerUnreachable: the sync chip's fourth state (docs/sync-plan.md's Q10)", () => {
  // pull_cursor "0", not null: this describe block models a device that
  // has already completed one pull cycle and is now experiencing an
  // outage — "merely behind," the case runBootstrapWindow must never run
  // for (engine.ts's own doc comment on runPullCycle). A literally never-
  // synced device is exercised separately, in the sync bootstrap tests.
  async function registerDevice() {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: "0",
      membership_id: null,
      token: null,
      series: 1,
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
      pullBootstrap: async () => ({ cursor: "3:", hasMore: false, changes: [] }),
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
      pullBootstrap: async () => ({ cursor: "3:", hasMore: false, changes: [] }),
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
      pullBootstrap: async () => ({ cursor: "3:", hasMore: false, changes: [] }),
    };

    await runPullCycle(db, authFailing);
    await runPullCycle(db, authFailing);
    await runPullCycle(db, authFailing);
    await runPullCycle(db, authFailing);

    expect(isServerUnreachable()).toBe(false);
  });
});

describe("runPullCycle: device_series", () => {
  async function addDevice(series: number | null, pullCursor: string | null) {
    await db.device.add({
      id: getDeviceId(),
      org_id: "org-1",
      location_id: "location-1",
      registered_at: new Date().toISOString(),
      pull_cursor: pullCursor,
      membership_id: "membership-1",
      token: "1|token",
      series,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the series a bootstrap page reports while this device's own is still null", async () => {
    await addDevice(null, null);
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullBootstrapOutcomeFor = () => ({ cursor: "3:", hasMore: false, changes: [], deviceSeries: 2 });

    await runPullCycle(db, transport);

    expect((await db.device.get(getDeviceId()))?.series).toBe(2);
  });

  it("stores the series a pull page reports while this device's own is still null", async () => {
    await addDevice(null, "5");
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullOutcomeFor = () => ({ cursor: "6", hasMore: false, changes: [], deviceSeries: 3 });

    await runPullCycle(db, transport);

    expect(transport.bootstrapCalls).toEqual([]);
    expect((await db.device.get(getDeviceId()))?.series).toBe(3);
  });

  it("leaves the series alone when a page reports none", async () => {
    await addDevice(null, "5");
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullOutcomeFor = () => ({ cursor: "6", hasMore: false, changes: [], deviceSeries: null });

    await runPullCycle(db, transport);

    expect((await db.device.get(getDeviceId()))?.series).toBeNull();
  });

  it("never overwrites a different non-null series: logs it and leaves exactly one open review, not one per cycle", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await addDevice(1, "5");
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullOutcomeFor = () => ({ cursor: "6", hasMore: false, changes: [], deviceSeries: 2 });

    await runPullCycle(db, transport);
    await runPullCycle(db, transport);

    expect((await db.device.get(getDeviceId()))?.series).toBe(1);
    expect(consoleError).toHaveBeenCalled();
    const reviews = await db.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      entity: "device",
      entity_id: getDeviceId(),
      reason: DEVICE_SERIES_CONFLICT_REASON,
      needs_review: true,
      payload: { stored_series: 1, server_series: 2 },
    });
    // No op stands behind it, so nothing is ever held back or resent for it.
    expect(await db.sync_ops.get(reviews[0].op_id)).toBeUndefined();
  });

  it("does nothing when the reported series is the one already stored", async () => {
    await addDevice(2, "5");
    const transport = new StubTransport(() => ({ op_id: "unused", status: "accepted", rev: 1 }));
    transport.pullOutcomeFor = () => ({ cursor: "6", hasMore: false, changes: [], deviceSeries: 2 });

    await runPullCycle(db, transport);

    expect((await db.device.get(getDeviceId()))?.series).toBe(2);
    expect(await db.sync_review.count()).toBe(0);
  });
});

/**
 * A stand-in for the server's rev check (api's SyncOpApplier): a create
 * starts a row at rev 1; an update is accepted only on the row's current
 * rev and raises it by one; after a rejected or failed op, the batch's
 * later ops on that row are blocked (Q2). failFirstAttemptOf fails the
 * named op's first attempt.
 */
class RevCheckingTransport extends StubTransport {
  readonly revs = new Map<string, number>();
  private readonly failOnce = new Set<string>();

  constructor() {
    super(() => {
      throw new Error("unused");
    });
  }

  failFirstAttemptOf(opId: string): void {
    this.failOnce.add(opId);
  }

  override async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    this.calls.push([...ops]);
    const stopped = new Set<string>();
    return ops.map((op): PushOpResult => {
      if (stopped.has(op.entity_id)) {
        return { op_id: op.op_id, status: "blocked" };
      }
      if (this.failOnce.delete(op.op_id)) {
        stopped.add(op.entity_id);
        return { op_id: op.op_id, status: "failed", reason: "server_error" };
      }
      if (op.action === AuditAction.Create) {
        this.revs.set(op.entity_id, 1);
        return { op_id: op.op_id, status: "accepted", rev: 1 };
      }
      const current = this.revs.get(op.entity_id);
      if (current === undefined || op.base_rev !== current) {
        stopped.add(op.entity_id);
        return { op_id: op.op_id, status: "rejected", reason: "conflict" };
      }
      this.revs.set(op.entity_id, current + 1);
      return { op_id: op.op_id, status: "accepted", rev: current + 1 };
    });
  }
}

describe("runSyncCycle: a device's own quick successive writes of one row", () => {
  async function advance(visitId: string, status: Visit["status"]): Promise<void> {
    const before = (await db.visits.get(visitId))!;
    await mutate(db, {
      table: db.visits,
      entity: "visits",
      entityId: visitId,
      action: AuditAction.Update,
      before,
      after: { ...before, status },
      actorMembershipId: "membership-1",
      orgId: before.org_id,
    });
  }

  async function updateOps(): Promise<SyncOp[]> {
    return (await db.sync_ops.toArray())
      .filter((op) => op.action === AuditAction.Update)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  it("two updates written before either was pushed are both accepted, in order", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new RevCheckingTransport();
    await runSyncCycle(db, transport);
    await advance(visit.id, VisitStatus.Arrived);
    await advance(visit.id, VisitStatus.InRoom);

    await runSyncCycle(db, transport);

    expect(transport.calls[1].map((op) => op.base_rev)).toEqual([1, 2]);
    expect(await db.sync_review.count()).toBe(0);
    expect((await db.sync_ops.toArray()).every((op) => op.synced_at !== null)).toBe(true);
    expect((await db.visits.get(visit.id))?.rev).toBe(3);
  });

  it("a create and two updates in one batch are all accepted", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    await advance(visit.id, VisitStatus.Arrived);
    await advance(visit.id, VisitStatus.InRoom);
    const transport = new RevCheckingTransport();

    await runSyncCycle(db, transport);

    expect(transport.calls[0].map((op) => op.base_rev)).toEqual([null, 1, 2]);
    expect(await db.sync_review.count()).toBe(0);
    expect((await db.visits.get(visit.id))?.rev).toBe(3);
  });

  it("an update left unsent behind an accepted one is sent on the new rev next cycle", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new RevCheckingTransport();
    await runSyncCycle(db, transport);
    await advance(visit.id, VisitStatus.Arrived);
    await advance(visit.id, VisitStatus.InRoom);
    const [, second] = await updateOps();
    transport.failFirstAttemptOf(second.op_id);

    await runSyncCycle(db, transport);
    await db.sync_ops.update(second.op_id, { next_retry_at: null });
    await runSyncCycle(db, transport);

    expect(transport.calls[2].map((op) => op.base_rev)).toEqual([2]);
    expect(await db.sync_review.count()).toBe(0);
    expect((await db.visits.get(visit.id))?.rev).toBe(3);
  });

  it("a row another device moved on is still a conflict", async () => {
    const visit = makeVisit();
    await writeVisit(visit);
    const transport = new RevCheckingTransport();
    await runSyncCycle(db, transport);
    transport.revs.set(visit.id, 2);
    await advance(visit.id, VisitStatus.Cancelled);

    await runSyncCycle(db, transport);

    const [review] = await db.sync_review.toArray();
    expect(review?.reason).toBe("conflict");
  });
});
