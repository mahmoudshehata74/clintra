import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "../db/database";
import { AuditAction, type Patient, type SyncOp, type Visit } from "../db/types";
import { Role } from "../domain/role";
import { LocationScope, PractitionerScope } from "../domain/scope";
import { VisitSource } from "../domain/visitSource";
import { CancelReason, VisitStatus } from "../domain/visitStatus";
import { runSyncCycle } from "./engine";
import { discardMine, getReviewComparison, keepMine } from "./reviewActions";
import type { PullSinceResult, PushOpResult, SyncTransport } from "./transport";

let db: ClintraDatabase;
const MEMBERSHIP_ID = "membership-1";
const ORG_ID = "org-1";

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-review-actions-test-${crypto.randomUUID()}`);
  // setTestActorResolver (src/test/setupIndexedDb.ts) reads this row back
  // as the acting membership — every reviewActions.ts write goes through
  // mutate(), which requires one.
  await db.memberships.add({
    id: MEMBERSHIP_ID,
    user_id: "user-1",
    org_id: ORG_ID,
    role: Role.Assistant,
    location_scope: LocationScope.All,
    practitioner_scope: PractitionerScope.All,
    practitioner_id: null,
    pin_hash: "hash",
    pin_salt: "salt",
    is_active: true,
    rev: 1,
  });
});

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "patient-1",
    org_id: ORG_ID,
    full_name: "مريض الأصل",
    phone: "+201000000000",
    gender: null,
    birth_year: null,
    note: null,
    created_at: "2026-09-07T06:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "visit-1",
    org_id: ORG_ID,
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
    created_by: MEMBERSHIP_ID,
    created_at: "2026-09-07T06:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

/** A rejected sync_ops row still sitting in the queue, exactly as runSyncCycle leaves it. */
function makeStaleOp(overrides: Partial<SyncOp> = {}): SyncOp {
  return {
    op_id: "op-1",
    entity: "patients",
    entity_id: "patient-1",
    action: AuditAction.Update,
    payload: {},
    device_id: "device-1",
    created_at: "2026-09-07T06:05:00.000Z",
    synced_at: null,
    base_rev: 1,
    failure_count: 0,
    next_retry_at: null,
    ...overrides,
  };
}

describe("getReviewComparison: readiness (docs/sync-plan.md's Q6)", () => {
  it("an edit conflict is NOT ready before a pull updates the local row past base_rev", async () => {
    await db.patients.add(makePatient({ rev: 1 }));
    const myEdit = makePatient({ full_name: "مريض بعد التعديل", rev: 1 });
    const review = {
      id: "review-1",
      op_id: "op-1",
      entity: "patients",
      entity_id: "patient-1",
      reason: "conflict_stale_rev",
      payload: myEdit,
      needs_review: true,
      created_at: "2026-09-07T06:05:00.000Z",
      action: AuditAction.Update,
      base_rev: 1,
    };

    const comparison = await getReviewComparison(db, review);

    expect(comparison.ready).toBe(false);
    expect(comparison.server).toBeNull();
  });

  it("an edit conflict IS ready once the local row's rev has moved past base_rev (a pull happened)", async () => {
    const serverVersion = makePatient({ full_name: "اسم من جهاز تاني", rev: 2 });
    await db.patients.add(serverVersion);
    const myEdit = makePatient({ full_name: "مريض بعد التعديل", rev: 1 });
    const review = {
      id: "review-1",
      op_id: "op-1",
      entity: "patients",
      entity_id: "patient-1",
      reason: "conflict_stale_rev",
      payload: myEdit,
      needs_review: true,
      created_at: "2026-09-07T06:05:00.000Z",
      action: AuditAction.Update,
      base_rev: 1,
    };

    const comparison = await getReviewComparison(db, review);

    expect(comparison.ready).toBe(true);
    expect(comparison.mine).toEqual(myEdit);
    expect(comparison.server).toEqual(serverVersion);
  });

  it("a create (slot) conflict is always ready — there is no server row to wait for", async () => {
    await db.visits.add(makeVisit());
    const review = {
      id: "review-1",
      op_id: "op-1",
      entity: "visits",
      entity_id: "visit-1",
      reason: "conflict_slot_taken",
      payload: makeVisit(),
      needs_review: true,
      created_at: "2026-09-07T06:05:00.000Z",
      action: AuditAction.Create,
      base_rev: null,
    };

    const comparison = await getReviewComparison(db, review);

    expect(comparison.ready).toBe(true);
    expect(comparison.server).toBeNull();
  });
});

describe("keepMine / discardMine: an edit conflict (conflict_stale_rev)", () => {
  async function seedReadyEditConflict() {
    const serverVersion = makePatient({ full_name: "اسم من جهاز تاني", rev: 2 });
    await db.patients.add(serverVersion);
    const myEdit = makePatient({ full_name: "مريض بعد التعديل", rev: 1 });
    await db.sync_ops.add(makeStaleOp({ payload: myEdit }));
    await db.sync_review.add({
      id: "review-1",
      op_id: "op-1",
      entity: "patients",
      entity_id: "patient-1",
      reason: "conflict_stale_rev",
      payload: myEdit,
      needs_review: true,
      created_at: "2026-09-07T06:05:00.000Z",
      action: AuditAction.Update,
      base_rev: 1,
    });
    return { serverVersion, myEdit };
  }

  it("throws rather than acting if called before the comparison is ready", async () => {
    const myEdit = makePatient({ full_name: "مريض بعد التعديل", rev: 1 });
    await db.patients.add(makePatient({ rev: 1 }));
    await db.sync_ops.add(makeStaleOp({ payload: myEdit }));
    await db.sync_review.add({
      id: "review-1",
      op_id: "op-1",
      entity: "patients",
      entity_id: "patient-1",
      reason: "conflict_stale_rev",
      payload: myEdit,
      needs_review: true,
      created_at: "2026-09-07T06:05:00.000Z",
      action: AuditAction.Update,
      base_rev: 1,
    });

    await expect(keepMine(db, "review-1")).rejects.toThrow("review_not_ready_to_keep_mine");
    await expect(discardMine(db, "review-1")).rejects.toThrow("review_not_ready_to_discard_mine");
  });

  it("'keep mine' overwrites the local row with my payload, rebased onto the server's real rev, and queues a fresh op with that base_rev — the stale op is gone", async () => {
    const { myEdit } = await seedReadyEditConflict();

    await keepMine(db, "review-1");

    const localRow = await db.patients.get("patient-1");
    expect(localRow?.full_name).toBe(myEdit.full_name);
    expect(localRow?.rev).toBe(2); // rebased onto the server's current rev

    const ops = await db.sync_ops.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].op_id).not.toBe("op-1"); // the stale op is gone, not resent as-is
    expect(ops[0].base_rev).toBe(2);
    expect(ops[0].action).toBe(AuditAction.Update);
    expect((ops[0].payload as Patient).full_name).toBe(myEdit.full_name);

    const review = await db.sync_review.get("review-1");
    expect(review?.needs_review).toBe(false);
  });

  it("the rebased op is actually accepted once resent through a real sync cycle — proves the corrected base_rev really matches the server", async () => {
    await seedReadyEditConflict();
    await keepMine(db, "review-1");

    // A transport that only accepts when base_rev matches its own record
    // of the current rev — the same check SyncOpApplier::applyUpdate
    // makes server-side — rather than trusting the op's own claim.
    const transport: SyncTransport = {
      pushOps: async (ops): Promise<PushOpResult[]> =>
        ops.map((op) => (op.base_rev === 2 ? { op_id: op.op_id, status: "accepted", rev: 3 } : { op_id: op.op_id, status: "rejected", reason: "conflict_stale_rev" })),
      pullSince: async (): Promise<PullSinceResult> => ({ cursor: "", hasMore: false, changes: [] }),
    };

    await runSyncCycle(db, transport);

    const [op] = await db.sync_ops.toArray();
    expect(op.synced_at).not.toBeNull();
    expect(await db.sync_review.count()).toBe(1); // the old review, already resolved
    expect((await db.sync_review.toArray())[0].needs_review).toBe(false);
    // No new review was created — this second push cycle genuinely succeeded.
  });

  it("'discard mine' leaves the local row as the server's version untouched, and drops the stale op with no replacement queued", async () => {
    const { serverVersion } = await seedReadyEditConflict();

    await discardMine(db, "review-1");

    const localRow = await db.patients.get("patient-1");
    expect(localRow).toEqual(serverVersion);

    expect(await db.sync_ops.count()).toBe(0);

    const review = await db.sync_review.get("review-1");
    expect(review?.needs_review).toBe(false);
  });
});

describe("keepMine / discardMine: a slot conflict on a rejected create (docs/sync-plan.md's Q7)", () => {
  async function seedSlotConflict() {
    const myVisit = makeVisit();
    await db.visits.add(myVisit);
    await db.sync_ops.add(
      makeStaleOp({
        op_id: "op-visit-1",
        entity: "visits",
        entity_id: "visit-1",
        action: AuditAction.Create,
        base_rev: null,
        payload: myVisit,
      }),
    );
    await db.sync_review.add({
      id: "review-visit-1",
      op_id: "op-visit-1",
      entity: "visits",
      entity_id: "visit-1",
      reason: "conflict_slot_taken",
      payload: myVisit,
      needs_review: true,
      created_at: "2026-09-07T06:05:00.000Z",
      action: AuditAction.Create,
      base_rev: null,
    });
    return { myVisit };
  }

  it("'keep mine': the patient's visit survives, but the slot stops looking confirmed — status becomes cancelled/sync_conflict, and the futile op is dropped", async () => {
    await seedSlotConflict();

    await keepMine(db, "review-visit-1");

    const localVisit = await db.visits.get("visit-1");
    expect(localVisit).toBeTruthy(); // the patient's record survives
    expect(localVisit?.status).toBe(VisitStatus.Cancelled);
    expect(localVisit?.cancel_reason).toBe(CancelReason.SyncConflict);
    expect(localVisit?.patient_id).toBe("patient-1"); // nothing about the patient link is lost

    // Nothing about this entity_id is ever sent to the server again: it
    // never existed there, mutate()'s own follow-up op for the
    // cancellation write is dropped right along with the stale create —
    // resending either would only ever come back conflict_stale_rev
    // forever, since there is no server row under this id to update.
    expect(await db.sync_ops.count()).toBe(0);

    const review = await db.sync_review.get("review-visit-1");
    expect(review?.needs_review).toBe(false);
  });

  it("'discard mine': the phantom local row (never real server-side) is removed entirely", async () => {
    await seedSlotConflict();

    await discardMine(db, "review-visit-1");

    expect(await db.visits.get("visit-1")).toBeUndefined();
    expect(await db.sync_ops.count()).toBe(0);

    const review = await db.sync_review.get("review-visit-1");
    expect(review?.needs_review).toBe(false);
  });
});

describe("keepMine: conflict_day_closed — a permanent state block, never a rebase", () => {
  it("drops the futile op and leaves the local row exactly as it was, without ever attempting a rebase", async () => {
    const localDayState = { id: "day-1", practitioner_id: "p1", location_id: "l1", date: "2026-09-07", delay_minutes: 15, is_closed: true, avg_consult_minutes: null, rev: 1 };
    await db.day_state.add(localDayState);
    await db.sync_ops.add(
      makeStaleOp({ op_id: "op-day-1", entity: "day_state", entity_id: "day-1", action: AuditAction.Update, base_rev: 1 }),
    );
    await db.sync_review.add({
      id: "review-day-1",
      op_id: "op-day-1",
      entity: "day_state",
      entity_id: "day-1",
      reason: "conflict_day_closed",
      payload: { ...localDayState, delay_minutes: 20 },
      needs_review: true,
      created_at: "2026-09-07T06:05:00.000Z",
      action: AuditAction.Update,
      base_rev: 1,
    });

    await keepMine(db, "review-day-1");

    expect(await db.day_state.get("day-1")).toEqual(localDayState);
    expect(await db.sync_ops.count()).toBe(0);
  });
});
