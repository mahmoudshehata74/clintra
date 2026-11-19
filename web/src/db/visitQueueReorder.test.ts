import { beforeEach, describe, expect, it } from "vitest";
import { VisitStatus } from "../domain/visitStatus";
import { runPullCycle, runSyncCycle } from "../sync/engine";
import { FakeTransport } from "../sync/fakeTransport";
import { GROUP_REJECTED_REASON, isRefusedGroupReview } from "../sync/syncGroups";
import type { PullSinceResult, PushOpResult, SyncTransport } from "../sync/transport";
import { ClintraDatabase } from "./database";
import { getDeviceId } from "./deviceRegistration";
import { findSeededQueuePractitioner, seedDatabase, seededVisitsDate } from "./seed";
import type { SyncOp, Visit } from "./types";
import { markVisitArrived } from "./visitAttendance";
import { moveWaitingVisit } from "./visitQueue";

let db: ClintraDatabase;

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-queue-reorder-test-${crypto.randomUUID()}`);
  await seedDatabase(db, { includeQueueDemo: true });
});

/** The seeded queue doctor's day, with its booked visit marked arrived: two waiting visits. */
async function queueDay(): Promise<Visit[]> {
  const practitioner = await findSeededQueuePractitioner(db);
  const day = () => db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, seededVisitsDate()]).sortBy("position");
  const booked = (await day()).find((visit) => visit.status === VisitStatus.Booked)!;
  await markVisitArrived(db, booked.id);
  await db.sync_ops.clear();
  await db.audit_log.clear();
  return day();
}

const positions = async (visits: readonly Visit[]) =>
  Object.fromEntries(await Promise.all(visits.map(async (visit) => [visit.id, (await db.visits.get(visit.id))!.position])));

/** A transport answering every push with `answer` (per op, in order), and nothing to pull. */
class ScriptedTransport implements SyncTransport {
  private readonly answer: (ops: readonly SyncOp[]) => PushOpResult[];
  pages: (cursor: string | null) => PullSinceResult = () => ({ cursor: "0", hasMore: false, changes: [] });
  constructor(answer: (ops: readonly SyncOp[]) => PushOpResult[]) {
    this.answer = answer;
  }
  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    return this.answer(ops);
  }
  async pullSince(cursor: string | null): Promise<PullSinceResult> {
    return this.pages(cursor);
  }
  async pullBootstrap(): Promise<PullSinceResult> {
    return { cursor: "0:", hasMore: false, changes: [] };
  }
}

describe("moveWaitingVisit", () => {
  it("trades places with the neighbouring waiting visit, written as one group that parks one of them first", async () => {
    const day = await queueDay();
    const [first, second] = day.filter((visit) => visit.status === VisitStatus.Arrived);
    const others = day.filter((visit) => visit.status !== VisitStatus.Arrived);
    const othersBefore = await positions(others);

    const result = await moveWaitingVisit(db, second.id, "up");

    expect(result.ok).toBe(true);
    expect(await positions([first, second])).toEqual({ [first.id]: second.position, [second.id]: first.position });
    expect(await positions(others)).toEqual(othersBefore);

    const ops = (await db.sync_ops.toArray()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(ops.map((op) => [op.entity_id, (op.payload as Visit).position])).toEqual([
      [first.id, -first.position],
      [second.id, first.position],
      [first.id, second.position],
    ]);
    expect(new Set(ops.map((op) => op.group_id)).size).toBe(1);
    expect(ops[0].group_id).toBeDefined();
    expect(ops.map((op) => op.base_rev)).toEqual([first.rev, second.rev, first.rev]);
    expect((ops[0].group_before as Visit).position).toBe(first.position);
  });

  it("refuses the first waiting visit moving up, the last moving down, and a visit not waiting", async () => {
    const day = await queueDay();
    const [first, second] = day.filter((visit) => visit.status === VisitStatus.Arrived);
    const inRoom = day.find((visit) => visit.status === VisitStatus.InRoom)!;

    expect(await moveWaitingVisit(db, first.id, "up")).toEqual({ ok: false, reason: "cannot_move" });
    expect(await moveWaitingVisit(db, second.id, "down")).toEqual({ ok: false, reason: "cannot_move" });
    expect(await moveWaitingVisit(db, inRoom.id, "down")).toEqual({ ok: false, reason: "cannot_move" });
    expect(await moveWaitingVisit(db, "no-such-visit", "down")).toEqual({ ok: false, reason: "visit_not_found" });
    expect(await db.sync_ops.count()).toBe(0);
  });
});

describe("a reorder's group in the sync engine", () => {
  it("is accepted whole by the fake server", async () => {
    const day = await queueDay();
    const [first] = day.filter((visit) => visit.status === VisitStatus.Arrived);
    await moveWaitingVisit(db, first.id, "down");

    await runSyncCycle(db, new FakeTransport(`clintra-queue-reorder-server-${crypto.randomUUID()}`));

    expect((await db.sync_ops.toArray()).every((op) => op.synced_at !== null)).toBe(true);
    expect(await db.sync_review.count()).toBe(0);
  });

  it("refused as stale leaves one review, takes every op of the group out of the queue, and puts the rows back", async () => {
    const day = await queueDay();
    const [first, second] = day.filter((visit) => visit.status === VisitStatus.Arrived);
    await moveWaitingVisit(db, second.id, "up");
    const transport = new ScriptedTransport((ops) =>
      ops.map((op, index) =>
        index === 0
          ? { op_id: op.op_id, status: "rejected", reason: "conflict_stale_rev" }
          : { op_id: op.op_id, status: "rejected", reason: GROUP_REJECTED_REASON },
      ),
    );

    await runSyncCycle(db, transport);

    const reviews = await db.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ reason: "conflict_stale_rev", entity: "visits", needs_review: true });
    expect(isRefusedGroupReview(reviews[0])).toBe(true);
    expect((reviews[0].payload as { group: unknown[] }).group).toHaveLength(3);
    expect(await db.sync_ops.count()).toBe(0);
    expect(await positions([first, second])).toEqual({ [first.id]: first.position, [second.id]: second.position });
  });

  it("failed backs the whole group off, so it is never resent in part", async () => {
    const day = await queueDay();
    const [, second] = day.filter((visit) => visit.status === VisitStatus.Arrived);
    await moveWaitingVisit(db, second.id, "up");
    const transport = new ScriptedTransport((ops) =>
      ops.map((op, index) =>
        index === 1
          ? { op_id: op.op_id, status: "failed", reason: "internal_error" }
          : { op_id: op.op_id, status: "rejected", reason: GROUP_REJECTED_REASON },
      ),
    );

    await runSyncCycle(db, transport);

    const ops = await db.sync_ops.toArray();
    expect(ops).toHaveLength(3);
    expect(new Set(ops.map((op) => op.next_retry_at)).size).toBe(1);
    expect(ops[0].next_retry_at).not.toBeNull();
    expect(await db.sync_review.count()).toBe(0);
  });
});

describe("a pulled reorder made on another device", () => {
  it.each([
    ["without a scheduled key", false],
    ["with the server's null scheduled key", true],
  ])("lands one row at a time, parking the local visit that still holds a position until its own change arrives (%s)", async (_label, serverNull) => {
    const day = await queueDay();
    const arrived = day.filter((visit) => visit.status === VisitStatus.Arrived);
    if (serverNull) {
      // As pulled from the server, whose column is nullable (no scheduled time in queue mode).
      await db.visits.bulkPut(arrived.map((visit) => ({ ...visit, unique_scheduled_at: null }) as unknown as Visit));
    }
    const [first, second] = (await db.visits.bulkGet(arrived.map((visit) => visit.id))) as Visit[];
    // The server's current rows after another device swapped them, each pulled as its own change.
    const pulledSecond = { ...second, position: first.position, rev: second.rev + 1 };
    const pulledFirst = { ...first, position: second.position, rev: first.rev + 2 };
    const pages: PullSinceResult[] = [
      { cursor: "1", hasMore: true, changes: [{ entity: "visits", entity_id: second.id, rev: pulledSecond.rev, payload: pulledSecond }] },
      { cursor: "2", hasMore: false, changes: [{ entity: "visits", entity_id: first.id, rev: pulledFirst.rev, payload: pulledFirst }] },
    ];
    await db.device.put({
      id: getDeviceId(),
      org_id: first.org_id,
      location_id: first.location_id,
      registered_at: new Date().toISOString(),
      pull_cursor: "0",
      membership_id: null,
      token: null,
      series: 1,
    });
    const transport = new ScriptedTransport(() => []);
    transport.pages = (cursor) => pages[cursor === "0" ? 0 : 1];

    await runPullCycle(db, transport);

    expect(await positions([first, second])).toEqual({ [first.id]: second.position, [second.id]: first.position });
    expect(await db.sync_review.count()).toBe(0);
  });
});
