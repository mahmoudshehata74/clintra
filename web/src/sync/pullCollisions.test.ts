import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "../db/database";
import { getDeviceId } from "../db/deviceRegistration";
import { mutate } from "../db/mutate";
import {
  AuditAction,
  type CashClose,
  type DayState,
  type MessageTemplate,
  type Patient,
  type Prescription,
  type PrescriptionItem,
  type SyncOp,
  type SyncReview,
  type Visit,
  type VisitFormData,
} from "../db/types";
import type { Piastres } from "../domain/money";
import { runPullCycle, runSyncCycle } from "./engine";
import { discardMine, getReviewComparison, keepMine, REVIEW_ROW_GONE } from "./reviewActions";
import { FakeTransport } from "./fakeTransport";
import {
  DISPLACED_BY_SERVER_REASON,
  SERVER_UNIQUE_CONFLICT_REASON,
  type DisplacedPayload,
  type RejectedCreatePayload,
  type ServerUniqueConflictPayload,
} from "./pullCollisions";
import type { PulledChange, PullSinceResult, PushOpResult, SyncTransport } from "./transport";

const VISIT_DATE = "2026-09-07";

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: id(),
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: VISIT_DATE,
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

function makeQueueVisit(overrides: Partial<Visit> = {}): Visit {
  const visit = makeVisit({ scheduled_at: null, ...overrides });
  delete visit.unique_scheduled_at;
  return visit;
}

function makePrescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: id(),
    org_id: "org-1",
    location_id: "location-1",
    visit_id: "visit-shared",
    patient_id: "patient-1",
    practitioner_id: "practitioner-1",
    series: 1,
    issued_year: 2026,
    number: 1,
    diagnosis: null,
    printed_at: null,
    created_by: "membership-1",
    created_at: "2026-09-07T08:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function makeItem(prescriptionId: string, name: string, position: number): PrescriptionItem {
  return {
    id: id(),
    prescription_id: prescriptionId,
    name,
    form: "Tablet",
    instructions: "قرص بعد الأكل",
    duration: null,
    note: null,
    position,
    rev: 1,
  };
}

function makeTemplate(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: id(),
    org_id: "org-1",
    key: "booking_confirmation",
    body: "أهلاً {{patient_name}}",
    updated_by: "membership-1",
    updated_at: "2026-09-07T08:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function makeDayState(overrides: Partial<DayState> = {}): DayState {
  return {
    id: id(),
    practitioner_id: "practitioner-1",
    location_id: "location-1",
    date: VISIT_DATE,
    delay_minutes: 15,
    is_closed: false,
    avg_consult_minutes: null,
    rev: 1,
    ...overrides,
  };
}

function makeCashClose(overrides: Partial<CashClose> = {}): CashClose {
  return {
    id: id(),
    location_id: "location-1",
    date: VISIT_DATE,
    total_expected: 50000 as Piastres,
    total_collected: 50000 as Piastres,
    difference: 0 as Piastres,
    difference_note: null,
    closed_by: "membership-1",
    closed_at: "2026-09-07T18:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function makeFormData(overrides: Partial<VisitFormData> = {}): VisitFormData {
  return {
    id: id(),
    visit_id: "visit-shared",
    form_definition_id: "form-general",
    data: { complaint: "صداع" },
    rev: 1,
    ...overrides,
  };
}

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: id(),
    org_id: "org-1",
    full_name: "مريض جديد",
    phone: null,
    gender: null,
    birth_year: null,
    note: null,
    created_at: "2026-09-07T06:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

let serverDbName: string;
const devices: ClintraDatabase[] = [];

beforeEach(() => {
  serverDbName = `clintra-pull-collision-server-${crypto.randomUUID()}`;
});

afterEach(() => {
  vi.restoreAllMocks();
  devices.splice(0).forEach((device) => device.close());
});

/** One device: its own local database, registered and never pulled yet. */
async function newDevice(): Promise<ClintraDatabase> {
  const db = new ClintraDatabase(`clintra-pull-collision-device-${crypto.randomUUID()}`);
  devices.push(db);
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
  return db;
}

/** Creates a row the way every writer does — through mutate(), so a create op is queued for it. */
async function createLocally(db: ClintraDatabase, entity: string, row: { id: string }): Promise<void> {
  await mutate(db, {
    table: db.table(entity),
    entity,
    entityId: row.id,
    action: AuditAction.Create,
    before: null,
    after: row,
    actorMembershipId: "membership-1",
    orgId: "org-1",
  });
}

async function unsentOpsFor(db: ClintraDatabase, entityId: string): Promise<SyncOp[]> {
  return (await db.sync_ops.toArray()).filter((op) => op.entity_id === entityId && op.synced_at === null);
}

async function openReviews(db: ClintraDatabase): Promise<SyncReview[]> {
  return (await db.sync_review.toArray()).filter((review) => review.needs_review);
}

async function snapshot(db: ClintraDatabase, except: readonly string[]): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    if (!except.includes(table.name)) {
      result[table.name] = await table.toArray();
    }
  }
  return result;
}

/** Pushes to its own outcome function, pulls from a FakeTransport — the server's real answer to a child of a rejected parent is `failed`, which Fake (no foreign keys) cannot give. */
class ScriptedPushTransport implements SyncTransport {
  calls: SyncOp[][] = [];
  private readonly server: FakeTransport;
  private readonly outcomeFor: (op: SyncOp) => PushOpResult;

  constructor(server: FakeTransport, outcomeFor: (op: SyncOp) => PushOpResult) {
    this.server = server;
    this.outcomeFor = outcomeFor;
  }

  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    this.calls.push([...ops]);
    return ops.map((op) => this.outcomeFor(op));
  }
  pullSince(cursor: string | null): Promise<PullSinceResult> {
    return this.server.pullSince(cursor);
  }
  pullBootstrap(): Promise<PullSinceResult> {
    return this.server.pullBootstrap();
  }
}

/** Serves fixed pull pages by cursor; pushes nothing. */
class PagedPullTransport implements SyncTransport {
  private readonly pages: Record<string, PullSinceResult>;
  private readonly bootstrap: PullSinceResult;

  constructor(pages: Record<string, PullSinceResult>, bootstrap: PullSinceResult = { cursor: "3:", hasMore: false, changes: [] }) {
    this.pages = pages;
    this.bootstrap = bootstrap;
  }

  async pushOps(): Promise<PushOpResult[]> {
    return [];
  }
  async pullSince(cursor: string | null): Promise<PullSinceResult> {
    return this.pages[cursor ?? "null"] ?? { cursor: cursor ?? "", hasMore: false, changes: [] };
  }
  async pullBootstrap(): Promise<PullSinceResult> {
    return this.bootstrap;
  }
}

interface CollisionCase {
  /** The local unique index the two rows share. */
  index: string;
  entity: string;
  winner: () => { id: string };
  loser: () => { id: string };
}

/**
 * Every local unique index a pulled row can share with a local row of a
 * different id (docs/sync-plan.md's "Local unique collisions on pull" has the
 * full list, including the ones that cannot collide and why).
 */
const COLLISION_CASES: CollisionCase[] = [
  {
    index: "visits &[practitioner_id+visit_date+position]",
    entity: "visits",
    winner: () => makeQueueVisit({ position: 4, patient_id: "patient-a" }),
    loser: () => makeQueueVisit({ position: 4, patient_id: "patient-b" }),
  },
  {
    index: "visits &[practitioner_id+visit_date+unique_scheduled_at]",
    entity: "visits",
    winner: () => makeVisit({ position: 1, patient_id: "patient-a" }),
    loser: () => makeVisit({ position: 2, patient_id: "patient-b" }),
  },
  {
    index: "day_state &[practitioner_id+location_id+date]",
    entity: "day_state",
    winner: () => makeDayState({ delay_minutes: 15 }),
    loser: () => makeDayState({ delay_minutes: 30 }),
  },
  {
    index: "cash_close &[location_id+date]",
    entity: "cash_close",
    winner: () => makeCashClose(),
    loser: () => makeCashClose({ total_collected: 45000 as Piastres, difference: -5000 as Piastres, difference_note: "ناقص" }),
  },
  {
    index: "visit_form_data &[visit_id+form_definition_id]",
    entity: "visit_form_data",
    winner: () => makeFormData({ data: { complaint: "صداع" } }),
    loser: () => makeFormData({ data: { complaint: "دوخة" } }),
  },
  {
    index: "prescriptions &visit_id",
    entity: "prescriptions",
    winner: () => makePrescription({ series: 1, number: 1 }),
    loser: () => makePrescription({ series: 2, number: 1 }),
  },
  {
    index: "message_templates &key",
    entity: "message_templates",
    winner: () => makeTemplate({ body: "أهلاً من الجهاز الأول" }),
    loser: () => makeTemplate({ body: "أهلاً من الجهاز التاني" }),
  },
];

describe("a pulled row that collides with a never-accepted local row on a unique key", () => {
  describe.each(COLLISION_CASES)("$index", ({ entity, winner: makeWinner, loser: makeLoser }) => {
    it("displaces the rejected local row into review, writes the server's row, and advances the cursor", async () => {
      const server = new FakeTransport(serverDbName);
      const deviceA = await newDevice();
      const deviceB = await newDevice();
      const winner = makeWinner();
      const loser = makeLoser();

      await createLocally(deviceA, entity, winner);
      await runSyncCycle(deviceA, server);
      await createLocally(deviceB, entity, loser);
      await runSyncCycle(deviceB, server);
      // The server refused B's create: B now holds an open rejection.
      const rejections = await openReviews(deviceB);
      expect(rejections.map((review) => review.entity_id)).toEqual([loser.id]);

      await runPullCycle(deviceB, server);

      const table = deviceB.table(entity);
      expect(await table.get(winner.id)).toEqual(winner);
      expect(await table.get(loser.id)).toBeUndefined();
      expect(await unsentOpsFor(deviceB, loser.id)).toEqual([]);

      const open = await openReviews(deviceB);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ entity, entity_id: loser.id, reason: DISPLACED_BY_SERVER_REASON, action: AuditAction.Create });
      // The rejection is closed and folded in: one review per entity, acknowledge-only.
      expect(open[0].payload).toEqual({
        row: loser,
        children: [],
        superseded: [{ entity, entity_id: loser.id, reason: rejections[0].reason, action: AuditAction.Create, payload: loser }],
      } satisfies DisplacedPayload);
      expect((await deviceB.sync_review.get(rejections[0].id))?.needs_review).toBe(false);

      const { cursor } = await server.pullSince(null);
      expect((await deviceB.device.get(getDeviceId()))?.pull_cursor).toBe(cursor);
    });

    it("displaces a local row whose create is still queued, unsent", async () => {
      const server = new FakeTransport(serverDbName);
      const deviceA = await newDevice();
      const deviceB = await newDevice();
      const winner = makeWinner();
      const loser = makeLoser();

      await createLocally(deviceA, entity, winner);
      await runSyncCycle(deviceA, server);
      await createLocally(deviceB, entity, loser);

      await runPullCycle(deviceB, server);

      expect(await deviceB.table(entity).get(winner.id)).toEqual(winner);
      expect(await deviceB.table(entity).get(loser.id)).toBeUndefined();
      expect(await unsentOpsFor(deviceB, loser.id)).toEqual([]);
      const open = await openReviews(deviceB);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ entity_id: loser.id, reason: DISPLACED_BY_SERVER_REASON });
    });
  });

  it("takes a displaced prescription's items with it, and changes nothing else on the device", async () => {
    const server = new FakeTransport(serverDbName);
    const deviceA = await newDevice();
    const deviceB = await newDevice();

    const winner = makePrescription({ series: 1, number: 1 });
    const winnerItems = [makeItem(winner.id, "Panadol 500mg", 1)];
    await createLocally(deviceA, "prescriptions", winner);
    for (const item of winnerItems) await createLocally(deviceA, "prescription_items", item);
    await runSyncCycle(deviceA, server);

    // Unrelated rows on B, synced and unsent, that must come through untouched.
    const otherPrescription = makePrescription({ visit_id: "visit-other", series: 2, number: 7 });
    const otherItem = makeItem(otherPrescription.id, "Augmentin 1g", 1);
    const unsentPatient = makePatient({ full_name: "مريض لسه متبعتش" });
    await createLocally(deviceB, "prescriptions", otherPrescription);
    await createLocally(deviceB, "prescription_items", otherItem);
    await createLocally(deviceB, "patients", unsentPatient);

    const loser = makePrescription({ series: 2, number: 2 });
    const loserItems = [makeItem(loser.id, "Brufen 400mg", 1), makeItem(loser.id, "Voltaren Gel", 2)];
    await createLocally(deviceB, "prescriptions", loser);
    for (const item of loserItems) await createLocally(deviceB, "prescription_items", item);

    const untouchedBefore = await snapshot(deviceB, ["prescriptions", "prescription_items", "sync_ops", "sync_review", "device"]);
    const opsBefore = await deviceB.sync_ops.toArray();
    const loserIds = new Set([loser.id, ...loserItems.map((item) => item.id)]);

    await runPullCycle(deviceB, server);

    expect(await deviceB.prescriptions.toArray()).toEqual(
      expect.arrayContaining([winner, otherPrescription]),
    );
    expect(await deviceB.prescriptions.count()).toBe(2);
    expect(await deviceB.prescription_items.toArray()).toEqual(expect.arrayContaining([...winnerItems, otherItem]));
    expect(await deviceB.prescription_items.count()).toBe(2);

    // Exactly the displaced rows' ops left the queue; every other op is as it was.
    expect(await deviceB.sync_ops.toArray()).toEqual(opsBefore.filter((op) => !loserIds.has(op.entity_id)));

    const reviews = await deviceB.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ entity: "prescriptions", entity_id: loser.id, reason: DISPLACED_BY_SERVER_REASON, needs_review: true });
    const payload = reviews[0].payload as DisplacedPayload;
    expect(payload.row).toEqual(loser);
    // Children come in primary-key order, which for random ids is no order the test can predict.
    expect(payload.children).toHaveLength(loserItems.length);
    expect(payload.children).toEqual(expect.arrayContaining(loserItems.map((item) => ({ entity: "prescription_items", row: item }))));

    expect(await snapshot(deviceB, ["prescriptions", "prescription_items", "sync_ops", "sync_review", "device"])).toEqual(untouchedBefore);
  });

  it("takes a displaced visit's prescription and that prescription's items with it", async () => {
    const deviceB = await newDevice();
    const loser = makeVisit({ patient_id: "patient-b" });
    const prescription = makePrescription({ visit_id: loser.id, series: 2 });
    const item = makeItem(prescription.id, "Brufen 400mg", 1);
    await createLocally(deviceB, "visits", loser);
    await createLocally(deviceB, "prescriptions", prescription);
    await createLocally(deviceB, "prescription_items", item);

    const winner = makeVisit({ patient_id: "patient-a" });
    const transport = new PagedPullTransport({
      null: { cursor: "1", hasMore: false, changes: [{ entity: "visits", entity_id: winner.id, rev: 1, payload: { ...winner } }] },
    });

    await runPullCycle(deviceB, transport);

    expect(await deviceB.visits.get(winner.id)).toEqual(winner);
    expect(await deviceB.visits.get(loser.id)).toBeUndefined();
    expect(await deviceB.prescriptions.count()).toBe(0);
    expect(await deviceB.prescription_items.count()).toBe(0);
    expect(await deviceB.sync_ops.filter((op) => op.synced_at === null).count()).toBe(0);
    const [review] = await openReviews(deviceB);
    expect((review.payload as DisplacedPayload).children).toEqual([
      { entity: "prescriptions", row: prescription },
      { entity: "prescription_items", row: item },
    ]);
  });

  it("applies a bootstrapped row the same way", async () => {
    const deviceB = await newDevice();
    const loser = makeTemplate({ body: "نسختي" });
    await createLocally(deviceB, "message_templates", loser);
    const winner = makeTemplate({ body: "نسخة السيرفر" });
    const transport = new PagedPullTransport(
      {},
      { cursor: "3:9", hasMore: false, changes: [{ entity: "message_templates", entity_id: winner.id, rev: 2, payload: { ...winner } }] },
    );

    await runPullCycle(deviceB, transport);

    expect(await deviceB.message_templates.toArray()).toEqual([winner]);
    expect((await openReviews(deviceB)).map((review) => review.reason)).toEqual([DISPLACED_BY_SERVER_REASON]);
  });

  it("a second pull cycle does not re-create the review row, and later server changes keep arriving", async () => {
    const server = new FakeTransport(serverDbName);
    const deviceA = await newDevice();
    const deviceB = await newDevice();
    const winner = makePrescription({ series: 1 });
    const loser = makePrescription({ series: 2 });
    await createLocally(deviceA, "prescriptions", winner);
    await runSyncCycle(deviceA, server);
    await createLocally(deviceB, "prescriptions", loser);
    await runSyncCycle(deviceB, server);

    await runPullCycle(deviceB, server);
    const reviewsAfterFirst = await deviceB.sync_review.toArray();
    await runPullCycle(deviceB, server);
    expect(await deviceB.sync_review.toArray()).toEqual(reviewsAfterFirst);
    expect((await openReviews(deviceB)).map((review) => review.reason)).toEqual([DISPLACED_BY_SERVER_REASON]);

    const later = makePatient({ full_name: "مريض من الجهاز الأول", created_at: "2026-09-07T09:00:00.000Z" });
    await createLocally(deviceA, "patients", later);
    await runSyncCycle(deviceA, server);
    await runPullCycle(deviceB, server);
    expect(await deviceB.patients.get(later.id)).toEqual(later);
  });
});

describe("a pulled row that collides with a local row the server accepted", () => {
  it("leaves both rows alone, records one server_unique_conflict, skips the row and keeps pulling", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const deviceB = await newDevice();
    const local = makeTemplate({ body: "نسخة مقبولة" });
    await createLocally(deviceB, "message_templates", local);
    await deviceB.sync_ops.toCollection().modify({ synced_at: "2026-09-07T08:01:00.000Z" });

    const pulled = makeTemplate({ body: "نسخة تانية بنفس المفتاح" });
    const unrelated = makePatient({ full_name: "مريض بعده في نفس الصفحة" });
    const changes: PulledChange[] = [
      { entity: "message_templates", entity_id: pulled.id, rev: 1, payload: { ...pulled } },
      { entity: "patients", entity_id: unrelated.id, rev: 1, payload: { ...unrelated } },
    ];
    const later = makePatient({ full_name: "مريض في الصفحة اللي بعدها" });
    const transport = new PagedPullTransport({
      null: { cursor: "1", hasMore: true, changes },
      "1": { cursor: "2", hasMore: false, changes: [{ entity: "patients", entity_id: later.id, rev: 1, payload: { ...later } }] },
    });

    await runPullCycle(deviceB, transport);

    expect(await deviceB.message_templates.toArray()).toEqual([local]);
    expect(await deviceB.patients.get(unrelated.id)).toEqual(unrelated);
    expect(await deviceB.patients.get(later.id)).toEqual(later);
    expect((await deviceB.device.get(getDeviceId()))?.pull_cursor).toBe("2");
    expect(consoleError).toHaveBeenCalled();

    const reviews = await deviceB.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ entity: "message_templates", entity_id: pulled.id, reason: SERVER_UNIQUE_CONFLICT_REASON, needs_review: true });
    const expected: ServerUniqueConflictPayload = { pulled: { ...pulled }, local: [{ ...local }] };
    expect(reviews[0].payload).toEqual(expected);
    expect(await deviceB.sync_ops.get(reviews[0].op_id)).toBeUndefined();

    // The same change pulled again (a cursor reset, a bootstrap) adds no second open row.
    await deviceB.device.update(getDeviceId(), { pull_cursor: "0" });
    await runPullCycle(deviceB, new PagedPullTransport({ "0": { cursor: "2", hasMore: false, changes } }));
    expect(await deviceB.sync_review.count()).toBe(1);
  });
});

describe("children of a rejected create", () => {
  it("their queued ops leave the queue and are folded into the parent's review, so they never retry", async () => {
    const server = new FakeTransport(serverDbName);
    const deviceB = await newDevice();
    const prescription = makePrescription({ series: 2 });
    const first = makeItem(prescription.id, "Brufen 400mg", 1);
    const second = makeItem(prescription.id, "Voltaren Gel", 2);
    const unrelated = makePatient();
    await createLocally(deviceB, "prescriptions", prescription);
    await createLocally(deviceB, "prescription_items", first);
    await createLocally(deviceB, "prescription_items", second);
    await mutate(deviceB, {
      table: deviceB.prescription_items,
      entity: "prescription_items",
      entityId: first.id,
      action: AuditAction.Update,
      before: first,
      after: { ...first, duration: "5 أيام" },
      actorMembershipId: "membership-1",
      orgId: "org-1",
    });
    await createLocally(deviceB, "patients", unrelated);
    const childOps = (await deviceB.sync_ops.toArray())
      .filter((op) => op.entity === "prescription_items")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    // What the server answers: the parent loses on its visit's one-prescription rule; each child fails on its foreign key.
    const transport = new ScriptedPushTransport(server, (op): PushOpResult => {
      if (op.entity === "prescriptions") return { op_id: op.op_id, status: "rejected", reason: "conflict_visit_has_prescription" };
      if (op.entity === "prescription_items") return { op_id: op.op_id, status: "failed", reason: "internal_error" };
      return { op_id: op.op_id, status: "accepted", rev: 1 };
    });

    await runSyncCycle(deviceB, transport);

    const remaining = await deviceB.sync_ops.toArray();
    expect(remaining.filter((op) => op.entity === "prescription_items")).toEqual([]);
    expect(remaining.find((op) => op.entity_id === unrelated.id)?.synced_at).not.toBeNull();
    expect(await unsentOpsFor(deviceB, prescription.id)).toHaveLength(1);

    const [review] = await deviceB.sync_review.toArray();
    expect(review).toMatchObject({ entity: "prescriptions", entity_id: prescription.id, reason: "conflict_visit_has_prescription" });
    expect(review.payload).toEqual({
      row: prescription,
      child_ops: childOps.map((op) => ({ op_id: op.op_id, entity: op.entity, entity_id: op.entity_id, action: op.action, payload: op.payload })),
    } satisfies RejectedCreatePayload);

    // The local rows themselves stay until the parent's own review is settled (or a pull displaces it).
    expect(await deviceB.prescription_items.count()).toBe(2);

    await runSyncCycle(deviceB, transport);
    expect(transport.calls).toHaveLength(1);
  });

  it("a rejected create with no children keeps its plain row as the review payload", async () => {
    const deviceB = await newDevice();
    const template = makeTemplate();
    await createLocally(deviceB, "message_templates", template);
    const transport = new ScriptedPushTransport(new FakeTransport(serverDbName), (op) => ({
      op_id: op.op_id,
      status: "rejected",
      reason: "conflict_already_exists",
    }));

    await runSyncCycle(deviceB, transport);

    const [review] = await deviceB.sync_review.toArray();
    expect(review.payload).toEqual(template);
  });
});

describe("one review per entity: a displacement supersedes the create's own rejection", () => {
  async function rejectedThenDisplaced(sameCycle: boolean) {
    const server = new FakeTransport(serverDbName);
    const deviceA = await newDevice();
    const deviceB = await newDevice();
    const winner = makeVisit({ position: 1, patient_id: "patient-a" });
    const loser = makeVisit({ position: 2, patient_id: "patient-b" });
    await createLocally(deviceA, "visits", winner);
    await runSyncCycle(deviceA, server);
    await createLocally(deviceB, "visits", loser);

    await runSyncCycle(deviceB, server);
    const [rejection] = await openReviews(deviceB);
    if (!sameCycle) {
      // The sheet, opened between cycles, offers keep/discard on the rejection.
      expect(rejection).toMatchObject({ entity_id: loser.id, action: AuditAction.Create });
      expect(await getReviewComparison(deviceB, rejection)).toMatchObject({ ready: true, rowGone: false });
    }
    await runPullCycle(deviceB, server);
    return { deviceB, loser, rejection };
  }

  it.each([
    ["the rejection first, the pull in a later cycle", false],
    ["the pull in the same cycle as the rejection", true],
  ])("%s: only the displacement stays open, and keep/discard on the rejection throw a named error", async (_label, sameCycle) => {
    const { deviceB, loser, rejection } = await rejectedThenDisplaced(sameCycle);

    const open = await openReviews(deviceB);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ entity_id: loser.id, reason: DISPLACED_BY_SERVER_REASON });
    expect((open[0].payload as DisplacedPayload).superseded).toEqual([
      { entity: "visits", entity_id: loser.id, reason: rejection.reason, action: AuditAction.Create, payload: loser },
    ]);

    const closed = (await deviceB.sync_review.get(rejection.id))!;
    expect(closed.needs_review).toBe(false);
    expect(await getReviewComparison(deviceB, closed)).toMatchObject({ ready: false, rowGone: true });
    await expect(keepMine(deviceB, rejection.id)).rejects.toThrow(REVIEW_ROW_GONE);
    await expect(discardMine(deviceB, rejection.id)).rejects.toThrow(REVIEW_ROW_GONE);
    expect(await deviceB.visits.get(loser.id)).toBeUndefined();
    expect(await deviceB.sync_ops.filter((op) => op.synced_at === null).count()).toBe(0);
  });
});
