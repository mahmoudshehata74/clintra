import { beforeEach, describe, expect, it } from "vitest";
import { ScheduleMode } from "../domain/scheduleMode";
import { addDaysToClinicDay, cairoInstant, todayInCairo, weekdayOf, type ClinicDay } from "../domain/time";
import { VisitStatus } from "../domain/visitStatus";
import { runSyncCycle } from "../sync/engine";
import { FakeTransport } from "../sync/fakeTransport";
import { describeSyncReview, MODE_SWITCH_REFUSED_LABEL, QUEUE_REORDER_REFUSED_LABEL } from "../sync/reviewSummary";
import { GROUP_REJECTED_REASON, isRefusedGroupReview } from "../sync/syncGroups";
import type { PullSinceResult, PushOpResult, SyncTransport } from "../sync/transport";
import { ClintraDatabase } from "./database";
import { switchModeFromTomorrow, switchScheduleMode } from "./scheduleModeSwitch";
import { findSeededQueuePractitioner, findSeededSlotsPractitioner, seedDatabase, seededVisitsDate } from "./seed";
import type { Schedule, SyncOp, Visit } from "./types";
import { markVisitArrived } from "./visitAttendance";
import { sendVisitToEndOfQueue, undoSendVisitToEndOfQueue } from "./visitQueue";

// "Send to end of queue" and switching a day between slots and queue move
// several visits' positions at once. Each is one group of ops, ordered so
// that no two visits share a position at any step: FakeTransport's own
// database holds the same unique keys as the server and refuses a write
// that collides, so a group it accepts whole is one the server can apply.

let db: ClintraDatabase;
let serverName: string;

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-queue-position-groups-${crypto.randomUUID()}`);
  serverName = `clintra-queue-position-groups-server-${crypto.randomUUID()}`;
});

/** Puts the device's current visits and schedules on the fake server, as if pushed long ago, and empties the queue. */
async function serverHoldsDevice(): Promise<FakeTransport> {
  const server = new ClintraDatabase(serverName);
  await server.visits.bulkPut(await db.visits.toArray());
  await server.schedules.bulkPut(await db.schedules.toArray());
  await db.sync_ops.clear();
  await db.audit_log.clear();
  return new FakeTransport(serverName);
}

async function serverVisits(): Promise<Map<string, Visit>> {
  const rows = await new ClintraDatabase(serverName).visits.toArray();
  return new Map(rows.map((row) => [row.id, row]));
}

/** A transport refusing every group with `reason` on its first op, and nothing to pull. */
class RefusingTransport implements SyncTransport {
  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    return ops.map((op, index) =>
      index === 0
        ? { op_id: op.op_id, status: "rejected", reason: "conflict_stale_rev" }
        : { op_id: op.op_id, status: "rejected", reason: GROUP_REJECTED_REASON },
    );
  }
  async pullSince(): Promise<PullSinceResult> {
    return { cursor: "0", hasMore: false, changes: [] };
  }
  async pullBootstrap(): Promise<PullSinceResult> {
    return { cursor: "0:", hasMore: false, changes: [] };
  }
}

describe("send to end of queue", () => {
  /** The seeded queue doctor's day with its booked visit marked arrived, sorted by position. */
  async function queueDay(): Promise<Visit[]> {
    await seedDatabase(db, { includeQueueDemo: true });
    const practitioner = await findSeededQueuePractitioner(db);
    const day = () => db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, seededVisitsDate()]).sortBy("position");
    const booked = (await day()).find((visit) => visit.status === VisitStatus.Booked)!;
    await markVisitArrived(db, booked.id);
    return day();
  }

  it("is written as one group the server applies whole, ending where the device shows", async () => {
    const day = await queueDay();
    const transport = await serverHoldsDevice();
    const first = day.find((visit) => visit.status === VisitStatus.Arrived)!;

    const result = await sendVisitToEndOfQueue(db, first.id);

    expect(result.ok).toBe(true);
    const ops = await db.sync_ops.toArray();
    expect(ops.length).toBeGreaterThan(1);
    expect(new Set(ops.map((op) => op.group_id)).size).toBe(1);
    expect(ops[0].group_id).toBeDefined();

    await runSyncCycle(db, transport);

    expect(await db.sync_review.count()).toBe(0);
    expect((await db.sync_ops.toArray()).every((op) => op.synced_at !== null)).toBe(true);
    const server = await serverVisits();
    for (const visit of await db.visits.bulkGet(day.map((row) => row.id))) {
      expect(server.get(visit!.id)?.position).toBe(visit!.position);
    }
    expect((await db.visits.get(first.id))?.position).toBe(Math.max(...day.map((visit) => visit.position)));
  });

  it("moves a day with a gap in its positions without two visits ever sharing one", async () => {
    const day = await queueDay();
    // A gap after the first visit: positions 1, 3, 4, ...
    const shifted = day.slice(1).reverse();
    for (const visit of shifted) {
      await db.visits.update(visit.id, { position: visit.position + 1 });
    }
    const transport = await serverHoldsDevice();
    const first = (await db.visits.bulkGet(day.map((visit) => visit.id))).find((visit) => visit!.status === VisitStatus.Arrived)!;

    expect((await sendVisitToEndOfQueue(db, first.id)).ok).toBe(true);
    await runSyncCycle(db, transport);

    expect(await db.sync_review.count()).toBe(0);
    const server = await serverVisits();
    for (const visit of await db.visits.bulkGet(day.map((row) => row.id))) {
      expect(server.get(visit!.id)?.position).toBe(visit!.position);
    }
  });

  it("its undo is one group too, putting the server back where it was", async () => {
    const day = await queueDay();
    const transport = await serverHoldsDevice();
    const first = day.find((visit) => visit.status === VisitStatus.Arrived)!;
    const result = await sendVisitToEndOfQueue(db, first.id);
    await runSyncCycle(db, transport);
    if (!result.ok) {
      throw new Error("send to end refused");
    }

    expect(await undoSendVisitToEndOfQueue(db, result.moves)).toEqual({ ok: true });
    const undoOps = (await db.sync_ops.toArray()).filter((op) => op.synced_at === null);
    expect(new Set(undoOps.map((op) => op.group_id)).size).toBe(1);
    await runSyncCycle(db, transport);

    expect(await db.sync_review.count()).toBe(0);
    const server = await serverVisits();
    for (const visit of day) {
      expect(server.get(visit.id)?.position).toBe(visit.position);
      expect((await db.visits.get(visit.id))?.position).toBe(visit.position);
    }
  });

  it("refused, leaves exactly one review and the day as it was", async () => {
    const day = await queueDay();
    await serverHoldsDevice();
    const first = day.find((visit) => visit.status === VisitStatus.Arrived)!;
    await sendVisitToEndOfQueue(db, first.id);

    await runSyncCycle(db, new RefusingTransport());

    const reviews = await db.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(isRefusedGroupReview(reviews[0])).toBe(true);
    expect(describeSyncReview(reviews[0])).toBe(QUEUE_REORDER_REFUSED_LABEL);
    expect(await db.sync_ops.count()).toBe(0);
    for (const visit of day) {
      expect((await db.visits.get(visit.id))?.position).toBe(visit.position);
    }
  });
});

describe("switching a day between slots and queue", () => {
  /** A booked slots visit on `date` at `time`, at `position`, copied from a seeded visit. */
  async function putSlotsVisit(practitionerId: string, locationId: string, id: string, date: ClinicDay, time: string, position: number) {
    const [template] = await db.visits.toArray();
    const scheduledAt = cairoInstant(date, time);
    await db.visits.put({
      ...template,
      id,
      practitioner_id: practitionerId,
      location_id: locationId,
      visit_date: date,
      position,
      status: VisitStatus.Booked,
      scheduled_at: scheduledAt,
      unique_scheduled_at: scheduledAt,
      is_overbooked: false,
    });
  }

  /** The seeded slots doctor, working tomorrow, with three of tomorrow's visits booked out of time order. */
  async function slotsDoctorTomorrow() {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const tomorrow = addDaysToClinicDay(todayInCairo(), 1);
    const schedules = (await db.schedules.toArray()).filter((row) => row.practitioner_id === practitioner.id);
    const row = schedules.find((schedule) => schedule.weekday === weekdayOf(tomorrow)) ?? schedules[0];
    if (row.weekday !== weekdayOf(tomorrow)) {
      await db.schedules.put({ ...row, id: crypto.randomUUID(), weekday: weekdayOf(tomorrow) });
    }
    const locationId = row.location_id;
    // Booked in the order 10:00, 09:00, 09:30: slot positions follow booking, not time.
    await putSlotsVisit(practitioner.id, locationId, "late", tomorrow, "10:00", 1);
    await putSlotsVisit(practitioner.id, locationId, "early", tomorrow, "09:00", 2);
    await putSlotsVisit(practitioner.id, locationId, "middle", tomorrow, "09:30", 3);
    return { practitioner, locationId, tomorrow };
  }

  it("to queue from tomorrow: the visits and the schedule rows are one group the server applies whole", async () => {
    const { practitioner, locationId } = await slotsDoctorTomorrow();
    const transport = await serverHoldsDevice();

    expect(await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId, newMode: ScheduleMode.Queue })).toEqual({ ok: true });

    const ops = await db.sync_ops.toArray();
    expect(new Set(ops.map((op) => op.group_id)).size).toBe(1);
    expect(ops[0].group_id).toBeDefined();
    expect(ops.some((op) => op.entity === "schedules")).toBe(true);

    await runSyncCycle(db, transport);

    expect(await db.sync_review.count()).toBe(0);
    expect((await db.sync_ops.toArray()).every((op) => op.synced_at !== null)).toBe(true);
    const server = await serverVisits();
    expect(["early", "middle", "late"].map((visitId) => server.get(visitId)?.position)).toEqual([1, 2, 3]);
    expect(["early", "middle", "late"].map((visitId) => server.get(visitId)?.scheduled_at)).toEqual([null, null, null]);
  });

  it("and back to slots, again one group the server applies whole", async () => {
    const { practitioner, locationId } = await slotsDoctorTomorrow();
    const transport = await serverHoldsDevice();
    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId, newMode: ScheduleMode.Queue });
    await runSyncCycle(db, transport);

    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId, newMode: ScheduleMode.Slots });
    const unsent = (await db.sync_ops.toArray()).filter((op) => op.synced_at === null);
    expect(new Set(unsent.map((op) => op.group_id)).size).toBe(1);
    await runSyncCycle(db, transport);

    expect(await db.sync_review.count()).toBe(0);
    const server = await serverVisits();
    for (const visitId of ["early", "middle", "late"]) {
      expect(server.get(visitId)?.scheduled_at).toBe((await db.visits.get(visitId))?.scheduled_at);
      expect(server.get(visitId)?.scheduled_at).not.toBeNull();
    }
  });

  it("the dev switch at once is one group the server applies whole", async () => {
    const { practitioner, tomorrow } = await slotsDoctorTomorrow();
    const transport = await serverHoldsDevice();

    expect(await switchScheduleMode(db, practitioner.id, weekdayOf(tomorrow), ScheduleMode.Queue)).toEqual({ ok: true });
    expect(new Set((await db.sync_ops.toArray()).map((op) => op.group_id)).size).toBe(1);
    await runSyncCycle(db, transport);

    expect(await db.sync_review.count()).toBe(0);
    const server = await serverVisits();
    expect(["early", "middle", "late"].map((visitId) => server.get(visitId)?.position)).toEqual([1, 2, 3]);
  });

  it("refused, leaves exactly one review naming the switch, and the rows as they were", async () => {
    const { practitioner, locationId } = await slotsDoctorTomorrow();
    await serverHoldsDevice();
    const visitsBefore = await db.visits.bulkGet(["late", "early", "middle"]);
    const schedulesBefore: Schedule[] = (await db.schedules.toArray()).filter((row) => row.practitioner_id === practitioner.id);
    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId, newMode: ScheduleMode.Queue });

    await runSyncCycle(db, new RefusingTransport());

    const reviews = await db.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(describeSyncReview(reviews[0])).toBe(MODE_SWITCH_REFUSED_LABEL);
    expect(await db.sync_ops.count()).toBe(0);
    expect(await db.visits.bulkGet(["late", "early", "middle"])).toEqual(visitsBefore);
    for (const schedule of schedulesBefore) {
      expect(await db.schedules.get(schedule.id)).toEqual(schedule);
    }
  });
});
