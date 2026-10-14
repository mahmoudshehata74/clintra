import { beforeEach, describe, expect, it } from "vitest";
import { clearActiveSession, setActiveMembershipId } from "../auth/session";
import { describeAuditVerb } from "../domain/auditVerb";
import { id } from "../domain/id";
import type { Piastres } from "../domain/money";
import { resolveServicePrice } from "../domain/pricing";
import { generateSlotTimes } from "../domain/schedule";
import { GENERAL_SPECIALTY_KEY } from "../domain/specialtyTemplate";
import { cairoInstant } from "../domain/time";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import {
  addCarePlanSessions,
  CarePlanError,
  carePlanDraftForVisit,
  carePlanSessionLabelForVisit,
  createCarePlan,
  resumeCarePlan,
  skipCarePlanSession,
  stopCarePlan,
  unskipCarePlanSession,
  updateCarePlanDetails,
  type CarePlanSessionGroup,
} from "./carePlans";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import {
  AuditAction,
  CarePlanItemStatus,
  CarePlanStatus,
  type CarePlan,
  type CarePlanItem,
  type Membership,
  type Schedule,
  type Service,
  type Visit,
} from "./types";
import { markVisitInRoom } from "./visitAttendance";
import { bookExistingPatientVisit } from "./visitBooking";
import { cancelVisit, markVisitNoShow } from "./visitCancel";
import { completeVisitWithInvoice } from "./visitCompletion";
import { saveVisitFormField } from "./visitForm";
import { moveVisit } from "./visitMove";
import { addToQueue } from "./visitQueue";
import { undoMostRecentVisitMutation } from "./visitUndo";

let db: ClintraDatabase;
let practitionerMembership: Membership;
let schedule: Schedule;
let physio: Service;
let review: Service;

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-care-plans-test-${crypto.randomUUID()}`);
  await seedDatabase(db);
  const found = (await db.memberships.toArray()).find((membership) => membership.practitioner_id !== null);
  if (!found) throw new Error("seed did not produce a membership with a practitioner");
  practitionerMembership = found;
  setActiveMembershipId(practitionerMembership.id);
  const schedules = await db.schedules.toArray();
  schedule = schedules.find((candidate) => candidate.practitioner_id === found.practitioner_id)!;
  [physio, review] = await db.services.toArray();
});

const DAY = "2026-10-20";

/** A visit written directly (bypassing mutate()), for the plan practitioner and the first patient unless overridden. */
async function makeVisit(overrides: Partial<Visit> = {}): Promise<Visit> {
  const practitionerId = overrides.practitioner_id ?? practitionerMembership.practitioner_id!;
  const practitioner = await db.practitioners.get(practitionerId);
  const [patient] = await db.patients.toArray();
  const visitDate = overrides.visit_date ?? DAY;
  const sameDay = await db.visits.where("[practitioner_id+visit_date]").equals([practitionerId, visitDate]).toArray();
  const visit: Visit = {
    id: id(),
    org_id: practitioner!.org_id,
    location_id: schedule.location_id,
    practitioner_id: practitionerId,
    patient_id: patient.id,
    service_id: physio.id,
    care_plan_item_id: null,
    visit_date: visitDate,
    position: sameDay.reduce((max, v) => Math.max(max, v.position), 0) + 1,
    scheduled_at: null,
    status: VisitStatus.InRoom,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: practitionerMembership.id,
    created_at: "2026-10-20T06:00:00.000Z",
    note: null,
    rev: 1,
    ...overrides,
  };
  await db.visits.add(visit);
  return visit;
}

const GROUPS: CarePlanSessionGroup[] = [
  { serviceId: "", count: 1, gapDays: 3 },
  { serviceId: "", count: 2, gapDays: 7 },
];

/** The first group is one review session, the second two physio sessions, a week apart. */
function groups(): CarePlanSessionGroup[] {
  return [
    { ...GROUPS[0], serviceId: review.id },
    { ...GROUPS[1], serviceId: physio.id },
  ];
}

async function makePlan(): Promise<{ plan: CarePlan; items: CarePlanItem[]; visit: Visit }> {
  const visit = await makeVisit();
  const { plan, items } = await createCarePlan(db, { visitId: visit.id, goal: "  استعادة الحركة ", diagnosis: "التهاب وتر", sessions: groups() });
  return { plan, items, visit };
}

async function writeCounts() {
  return {
    auditRows: await db.audit_log.count(),
    syncOps: await db.sync_ops.count(),
    plans: await db.care_plans.count(),
    items: await db.care_plan_items.count(),
    visits: await db.visits.count(),
  };
}

async function verbsFor(entity: string, entityId: string): Promise<string[]> {
  return (await db.audit_log.orderBy("seq").toArray())
    .filter((row) => row.entity === entity && row.entity_id === entityId)
    .map((row) => describeAuditVerb(row));
}

function slotTime(index: number): string {
  return generateSlotTimes(schedule)[index];
}

/** Books session `item` (as the seeded assistant would), returning the booked visit. */
async function bookSession(item: CarePlanItem, visitDate = "2026-10-27", time = slotTime(1)): Promise<Visit> {
  const plan = (await db.care_plans.get(item.care_plan_id))!;
  const result = await bookExistingPatientVisit(db, {
    practitionerId: plan.practitioner_id,
    locationId: plan.location_id,
    orgId: plan.org_id,
    patientId: plan.patient_id,
    serviceId: item.service_id,
    visitDate,
    time,
    schedule,
    carePlanItemId: item.id,
  });
  if (!result.ok) throw new Error(result.reason);
  const booked = await db.visits.where("[practitioner_id+visit_date]").equals([plan.practitioner_id, visitDate]).toArray();
  return booked.find((visit) => visit.scheduled_at === cairoInstant(visitDate, time))!;
}

describe("createCarePlan", () => {
  it("creates the plan from the visit with its sessions expanded, priced and spaced, all in one audited write", async () => {
    // A practitioner override on physio: the effective price, not the default.
    await db.service_price_overrides.add({
      id: id(),
      service_id: physio.id,
      practitioner_id: practitionerMembership.practitioner_id,
      location_id: null,
      price: 22000 as Piastres,
      rev: 1,
    });
    const before = await writeCounts();
    const { plan, items, visit } = await makePlan();

    const template = (await db.specialty_templates.toArray()).find((candidate) => candidate.key === GENERAL_SPECIALTY_KEY);
    expect(plan).toMatchObject({
      org_id: visit.org_id,
      location_id: visit.location_id,
      patient_id: visit.patient_id,
      practitioner_id: visit.practitioner_id,
      template_id: template?.id,
      goal: "استعادة الحركة",
      diagnosis: "التهاب وتر",
      planned_count: 3,
      total_price: review.default_price + 2 * 22000,
      paid: 0,
      status: CarePlanStatus.Active,
      rev: 1,
    });
    // No session has a date yet, so the stored end is the start.
    expect(plan.expected_end).toBe(plan.started_at);
    expect(items.map((item) => [item.sequence, item.service_id, item.min_gap_days, item.price, item.visit_id, item.status])).toEqual([
      [1, review.id, 0, review.default_price, null, CarePlanItemStatus.Planned],
      [2, physio.id, 7, 22000, null, CarePlanItemStatus.Planned],
      [3, physio.id, 7, 22000, null, CarePlanItemStatus.Planned],
    ]);
    expect(await db.care_plans.get(plan.id)).toEqual(plan);

    const after = await writeCounts();
    expect(after.auditRows - before.auditRows).toBe(4);
    expect(after.syncOps - before.syncOps).toBe(4);
    expect(await verbsFor("care_plans", plan.id)).toEqual(["بدأ خطة رعاية"]);
    expect(await verbsFor("care_plan_items", items[0].id)).toEqual(["أضاف جلسات للخطة"]);
    const ops = (await db.sync_ops.toArray()).filter((op) => op.entity === "care_plans" || op.entity === "care_plan_items");
    expect(ops.every((op) => op.action === AuditAction.Create && op.base_rev === null)).toBe(true);
  });

  it("starts from the diagnosis the visit form holds", async () => {
    const visit = await makeVisit();
    expect(await carePlanDraftForVisit(db, visit.id)).toEqual({ diagnosis: "" });
    await saveVisitFormField(db, visit.id, "diagnosis", "  خشونة الركبة ");
    expect(await carePlanDraftForVisit(db, visit.id)).toEqual({ diagnosis: "خشونة الركبة" });
  });

  it.each<[string, Partial<{ goal: string; diagnosis: string; sessions: CarePlanSessionGroup[] }>, string]>([
    ["a blank goal", { goal: "  " }, CarePlanError.GoalRequired],
    ["a blank diagnosis", { diagnosis: "" }, CarePlanError.DiagnosisRequired],
    ["no sessions", { sessions: [] }, CarePlanError.SessionsRequired],
    ["a count of 0", { sessions: [{ serviceId: "physio", count: 0, gapDays: 7 }] }, CarePlanError.CountInvalid],
    ["a fractional count", { sessions: [{ serviceId: "physio", count: 1.5, gapDays: 7 }] }, CarePlanError.CountInvalid],
    ["a negative gap", { sessions: [{ serviceId: "physio", count: 2, gapDays: -1 }] }, CarePlanError.GapInvalid],
    ["an unknown service", { sessions: [{ serviceId: "missing", count: 2, gapDays: 7 }] }, CarePlanError.ServiceNotFound],
  ])("refuses %s and writes nothing", async (_label, fields, error) => {
    const visit = await makeVisit();
    const sessions = (fields.sessions ?? groups()).map((group) => (group.serviceId === "physio" ? { ...group, serviceId: physio.id } : group));
    const before = await writeCounts();
    await expect(
      createCarePlan(db, { visitId: visit.id, goal: fields.goal ?? "هدف", diagnosis: fields.diagnosis ?? "تشخيص", sessions }),
    ).rejects.toThrow(error);
    expect(await writeCounts()).toEqual(before);
  });

  it("refuses anyone but the visit's own practitioner, and a missing visit", async () => {
    const visit = await makeVisit();
    const before = await writeCounts();
    clearActiveSession();
    await expect(createCarePlan(db, { visitId: visit.id, goal: "هدف", diagnosis: "تشخيص", sessions: groups() })).rejects.toThrow(
      CarePlanError.NotPlanPractitioner,
    );
    setActiveMembershipId(practitionerMembership.id);
    await expect(createCarePlan(db, { visitId: "missing", goal: "هدف", diagnosis: "تشخيص", sessions: groups() })).rejects.toThrow(
      CarePlanError.VisitNotFound,
    );
    expect(await writeCounts()).toEqual(before);
  });
});

describe("one plan under way per patient and practitioner", () => {
  it("refuses a second plan while one is under way, and writes nothing", async () => {
    const { visit } = await makePlan();
    const before = await writeCounts();
    await expect(createCarePlan(db, { visitId: visit.id, goal: "هدف", diagnosis: "تشخيص", sessions: groups() })).rejects.toThrow(
      CarePlanError.PlanAlreadyActive,
    );
    expect(await writeCounts()).toEqual(before);
  });

  it("allows a new plan once the first is stopped or completed, and refuses to resume the first while the new one is under way", async () => {
    const { plan, visit } = await makePlan();
    await stopCarePlan(db, plan.id);
    const second = await createCarePlan(db, { visitId: visit.id, goal: "هدف", diagnosis: "تشخيص", sessions: [{ serviceId: physio.id, count: 1, gapDays: 0 }] });
    await expect(resumeCarePlan(db, plan.id)).rejects.toThrow(CarePlanError.PlanAlreadyActive);
    expect((await db.care_plans.get(plan.id))?.status).toBe(CarePlanStatus.Stopped);

    // The second plan's only session done: it is completed, so a third may start and the first may resume.
    const booked = await bookSession(second.items[0], "2026-10-27");
    await db.visits.update(booked.id, { status: VisitStatus.Completed });
    expect(await resumeCarePlan(db, plan.id)).not.toBeNull();
    expect((await db.care_plans.get(plan.id))?.status).toBe(CarePlanStatus.Active);
  });

  it("does not count another patient's plan", async () => {
    await makePlan();
    const otherPatient = (await db.patients.toArray())[1];
    const visit = await makeVisit({ patient_id: otherPatient.id, position: 40 });
    await expect(createCarePlan(db, { visitId: visit.id, goal: "هدف", diagnosis: "تشخيص", sessions: groups() })).resolves.toBeTruthy();
  });
});

describe("plan edits", () => {
  it("updates the goal and diagnosis, and writes nothing when they are unchanged", async () => {
    const { plan } = await makePlan();
    expect(await updateCarePlanDetails(db, plan.id, { goal: " هدف جديد ", diagnosis: "تشخيص جديد" })).not.toBeNull();
    expect(await db.care_plans.get(plan.id)).toMatchObject({ goal: "هدف جديد", diagnosis: "تشخيص جديد" });
    const before = await writeCounts();
    expect(await updateCarePlanDetails(db, plan.id, { goal: "هدف جديد", diagnosis: "تشخيص جديد" })).toBeNull();
    expect(await writeCounts()).toEqual(before);
    await expect(updateCarePlanDetails(db, plan.id, { goal: "", diagnosis: "x" })).rejects.toThrow(CarePlanError.GoalRequired);
    expect(await verbsFor("care_plans", plan.id)).toEqual(["بدأ خطة رعاية", "عدّل خطة رعاية"]);
  });

  it("appends sessions after the last one, each group's gap kept, and recomputes the totals", async () => {
    const { plan, items } = await makePlan();
    const added = await addCarePlanSessions(db, plan.id, [{ serviceId: review.id, count: 2, gapDays: 14 }]);
    expect(added.map((item) => [item.sequence, item.min_gap_days, item.price])).toEqual([
      [4, 14, review.default_price],
      [5, 14, review.default_price],
    ]);
    expect(await db.care_plans.get(plan.id)).toMatchObject({
      planned_count: 5,
      total_price: plan.total_price + 2 * review.default_price,
    });
    expect(await db.care_plan_items.where("care_plan_id").equals(plan.id).count()).toBe(items.length + 2);
    expect(await verbsFor("care_plan_items", added[0].id)).toEqual(["أضاف جلسات للخطة"]);
    await expect(addCarePlanSessions(db, plan.id, [])).rejects.toThrow(CarePlanError.SessionsRequired);
  });

  it("skips and unskips a suggested session, keeping the totals current, and writes nothing when unchanged", async () => {
    const { plan, items } = await makePlan();
    expect(await skipCarePlanSession(db, items[2].id)).not.toBeNull();
    expect((await db.care_plan_items.get(items[2].id))?.status).toBe(CarePlanItemStatus.Skipped);
    expect(await db.care_plans.get(plan.id)).toMatchObject({ planned_count: 2, total_price: plan.total_price - items[2].price });

    const before = await writeCounts();
    expect(await skipCarePlanSession(db, items[2].id)).toBeNull();
    expect(await writeCounts()).toEqual(before);

    expect(await unskipCarePlanSession(db, items[2].id)).not.toBeNull();
    expect(await db.care_plans.get(plan.id)).toMatchObject({ planned_count: 3, total_price: plan.total_price });
    expect(await verbsFor("care_plan_items", items[2].id)).toEqual(["أضاف جلسات للخطة", "أجّل جلسة", "رجّع جلسة"]);
  });

  it("refuses to skip a booked or a done session", async () => {
    const { items } = await makePlan();
    setActiveMembershipId(practitionerMembership.id);
    const booked = await bookSession(items[0]);
    await expect(skipCarePlanSession(db, items[0].id)).rejects.toThrow(CarePlanError.SessionNotSkippable);

    await db.visits.update(booked.id, { status: VisitStatus.Completed });
    const before = await writeCounts();
    await expect(skipCarePlanSession(db, items[0].id)).rejects.toThrow(CarePlanError.SessionNotSkippable);
    expect(await writeCounts()).toEqual(before);
  });

  it("stops and resumes the plan, writing nothing when it is already so", async () => {
    const { plan } = await makePlan();
    expect(await stopCarePlan(db, plan.id)).not.toBeNull();
    expect((await db.care_plans.get(plan.id))?.status).toBe(CarePlanStatus.Stopped);
    expect(await stopCarePlan(db, plan.id)).toBeNull();
    expect(await resumeCarePlan(db, plan.id)).not.toBeNull();
    expect(await resumeCarePlan(db, plan.id)).toBeNull();
    expect(await verbsFor("care_plans", plan.id)).toEqual(["بدأ خطة رعاية", "وقّف الخطة", "رجّع الخطة"]);
  });

  it("refuses every edit from anyone but the plan's practitioner, and never deletes", async () => {
    const { plan, items } = await makePlan();
    clearActiveSession();
    const before = await writeCounts();
    await expect(updateCarePlanDetails(db, plan.id, { goal: "x", diagnosis: "y" })).rejects.toThrow(CarePlanError.NotPlanPractitioner);
    await expect(addCarePlanSessions(db, plan.id, groups())).rejects.toThrow(CarePlanError.NotPlanPractitioner);
    await expect(skipCarePlanSession(db, items[1].id)).rejects.toThrow(CarePlanError.NotPlanPractitioner);
    await expect(stopCarePlan(db, plan.id)).rejects.toThrow(CarePlanError.NotPlanPractitioner);
    expect(await writeCounts()).toEqual(before);
    expect((await db.sync_ops.toArray()).some((op) => op.action === AuditAction.Delete)).toBe(false);
  });
});

describe("links kept by the visit writers", () => {
  it("booking a session links it in the same transaction, reads as a booking, and dates the rest of the plan", async () => {
    const { plan, items } = await makePlan();
    clearActiveSession(); // the assistant books
    const before = await writeCounts();
    const booked = await bookSession(items[0], "2026-10-27");

    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBe(booked.id);
    expect(booked.care_plan_item_id).toBeNull();
    // The visit, the session and the plan's recomputed end: 2026-10-27 + 7 + 7.
    const after = await writeCounts();
    expect(after.auditRows - before.auditRows).toBe(3);
    expect((await db.care_plans.get(plan.id))?.expected_end).toBe(cairoInstant("2026-11-10", "00:00"));
    expect(await verbsFor("care_plan_items", items[0].id)).toEqual(["أضاف جلسات للخطة", "سجّل حجز"]);
    expect(await verbsFor("visits", booked.id)).toEqual(["سجّل حجز"]);
  });

  it.each<[string, (context: { plan: CarePlan; items: CarePlanItem[] }) => Promise<Partial<Parameters<typeof bookExistingPatientVisit>[1]>>, string]>([
    [
      "a stopped plan",
      async ({ plan }) => {
        await stopCarePlan(db, plan.id);
        return {};
      },
      CarePlanError.PlanStopped,
    ],
    ["another patient", async () => ({ patientId: (await db.patients.toArray())[1].id }), CarePlanError.SessionMismatch],
    ["another service", async () => ({ serviceId: review.id }), CarePlanError.SessionMismatch],
    [
      "a skipped session",
      async ({ items }) => {
        await skipCarePlanSession(db, items[1].id);
        return {};
      },
      CarePlanError.SessionNotBookable,
    ],
    [
      "a session already booked",
      async ({ items }) => {
        await bookSession(items[1], "2026-11-03");
        return {};
      },
      CarePlanError.SessionNotBookable,
    ],
    ["a missing session", async () => ({ carePlanItemId: "missing" }), CarePlanError.SessionNotFound],
  ])("refuses to book %s and writes nothing", async (_label, arrange, error) => {
    const context = await makePlan();
    const overrides = await arrange(context);
    const before = await writeCounts();
    await expect(
      bookExistingPatientVisit(db, {
        practitionerId: context.plan.practitioner_id,
        locationId: context.plan.location_id,
        orgId: context.plan.org_id,
        patientId: context.plan.patient_id,
        serviceId: physio.id,
        visitDate: "2026-10-28",
        time: slotTime(2),
        schedule,
        carePlanItemId: context.items[1].id,
        ...overrides,
      }),
    ).rejects.toThrow(error);
    expect(await writeCounts()).toEqual(before);
  });

  it("adding a session's visit to a queue links it in the same transaction", async () => {
    const { plan, items } = await makePlan();
    clearActiveSession(); // the assistant adds to the queue
    const before = await writeCounts();
    const { auditLogId } = await addToQueue(db, {
      practitionerId: plan.practitioner_id,
      locationId: plan.location_id,
      orgId: plan.org_id,
      patientId: plan.patient_id,
      serviceId: items[0].service_id,
      visitDate: "2026-10-27",
      carePlanItemId: items[0].id,
    });

    const queued = (await db.audit_log.get(auditLogId))!.entity_id;
    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBe(queued);
    expect((await db.care_plans.get(plan.id))?.expected_end).toBe(cairoInstant("2026-11-10", "00:00"));
    expect((await writeCounts()).auditRows - before.auditRows).toBe(3);
    expect(await verbsFor("care_plan_items", items[0].id)).toEqual(["أضاف جلسات للخطة", "سجّل حجز"]);
  });

  it("refuses a queue visit for a session that is not bookable, and writes nothing", async () => {
    const { plan, items } = await makePlan();
    await skipCarePlanSession(db, items[1].id);
    const before = await writeCounts();
    await expect(
      addToQueue(db, {
        practitionerId: plan.practitioner_id,
        locationId: plan.location_id,
        orgId: plan.org_id,
        patientId: plan.patient_id,
        serviceId: items[1].service_id,
        visitDate: "2026-10-27",
        carePlanItemId: items[1].id,
      }),
    ).rejects.toThrow(CarePlanError.SessionNotBookable);
    expect(await writeCounts()).toEqual(before);
  });

  it("an overbooked session booking links it too", async () => {
    const { items } = await makePlan();
    const plan = (await db.care_plans.get(items[1].care_plan_id))!;
    const result = await bookExistingPatientVisit(db, {
      practitionerId: plan.practitioner_id,
      locationId: plan.location_id,
      orgId: plan.org_id,
      patientId: plan.patient_id,
      serviceId: physio.id,
      visitDate: "2026-10-28",
      time: slotTime(0),
      schedule,
      isOverbooked: true,
      carePlanItemId: items[1].id,
    });
    expect(result.ok).toBe(true);
    const linked = await db.visits.get((await db.care_plan_items.get(items[1].id))!.visit_id!);
    expect(linked?.is_overbooked).toBe(true);
  });

  it("moving a booked session's visit carries the link to the new visit and re-dates the plan", async () => {
    const { plan, items } = await makePlan();
    const booked = await bookSession(items[0], "2026-10-27");
    const result = await moveVisit(db, { visitId: booked.id, toDate: "2026-11-03", toTime: slotTime(3), toSchedule: schedule });
    if (!result.ok) throw new Error(result.reason);

    const moved = (await db.care_plan_items.get(items[0].id))!.visit_id!;
    expect(moved).not.toBe(booked.id);
    expect((await db.visits.get(moved))?.rescheduled_from).toBe(booked.id);
    expect((await db.care_plans.get(plan.id))?.expected_end).toBe(cairoInstant("2026-11-17", "00:00"));
    expect(await verbsFor("care_plan_items", items[0].id)).toEqual(["أضاف جلسات للخطة", "سجّل حجز", "نقل الميعاد"]);
  });

  it.each<[string, (visitId: string) => Promise<string>]>([
    ["cancelling", (visitId) => cancelVisit(db, visitId, "patient")],
    ["marking a no-show", (visitId) => markVisitNoShow(db, visitId)],
  ])("%s the visit clears the link in the same transaction: the session is suggested again", async (_label, free) => {
    const { plan, items } = await makePlan();
    const booked = await bookSession(items[0], "2026-10-27");
    const auditLogId = await free(booked.id);

    expect((await db.audit_log.get(auditLogId))?.entity_id).toBe(booked.id);
    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBeNull();
    // No session has a date again.
    expect((await db.care_plans.get(plan.id))?.expected_end).toBe(plan.started_at);
    // A session freed this way can be booked again.
    await bookSession(items[0], "2026-11-03");
  });

  it("cancelling or missing a visit that books no session writes only the visit, as before", async () => {
    const visit = await makeVisit({ status: VisitStatus.Booked });
    const before = await writeCounts();
    await cancelVisit(db, visit.id, "clinic");
    expect((await writeCounts()).auditRows - before.auditRows).toBe(1);
    expect((await writeCounts()).syncOps - before.syncOps).toBe(1);
  });
});

describe("undoing a visit write restores the session link with it", () => {
  /** The queued ops in the order runSyncCycle pushes them (sync/engine.ts: by created_at). */
  async function opsInPushOrder() {
    return (await db.sync_ops.toArray()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /**
   * Replays the queued ops in push order as the server applies them, and
   * returns every visit delete that a session would still point to at that
   * moment — the deletes the server refuses on care_plan_items.visit_id's
   * foreign key.
   */
  async function refusedVisitDeletes(): Promise<string[]> {
    const links = new Map<string, string | null>();
    const refused: string[] = [];
    for (const op of await opsInPushOrder()) {
      if (op.entity === "care_plan_items") {
        links.set(op.entity_id, (op.payload as CarePlanItem).visit_id);
      }
      if (op.entity === "visits" && op.action === AuditAction.Delete && [...links.values()].includes(op.entity_id)) {
        refused.push(op.entity_id);
      }
    }
    return refused;
  }

  it("undoing a move carries the session back to the original visit and re-dates the plan", async () => {
    const { plan, items } = await makePlan();
    const booked = await bookSession(items[0], "2026-10-27");
    const bookedEnd = (await db.care_plans.get(plan.id))!.expected_end;
    const result = await moveVisit(db, { visitId: booked.id, toDate: "2026-11-03", toTime: slotTime(3), toSchedule: schedule });
    if (!result.ok) throw new Error(result.reason);
    const movedTo = (await db.care_plan_items.get(items[0].id))!.visit_id!;

    // As DayScreen's "visit_move" undo: the new visit first, then the original.
    expect(await undoMostRecentVisitMutation(db, result.newVisitAuditLogId)).toEqual({ ok: true });
    expect(await undoMostRecentVisitMutation(db, result.oldVisitAuditLogId)).toEqual({ ok: true });

    expect(await db.visits.get(movedTo)).toBeUndefined();
    expect((await db.visits.get(booked.id))?.status).toBe(VisitStatus.Booked);
    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBe(booked.id);
    expect((await db.care_plans.get(plan.id))?.expected_end).toBe(bookedEnd);
    expect(await verbsFor("care_plan_items", items[0].id)).toEqual(["أضاف جلسات للخطة", "سجّل حجز", "نقل الميعاد", "نقل الميعاد"]);
  });

  it("queues the session's restored link before the moved visit's delete, so the server never refuses that delete", async () => {
    const { items } = await makePlan();
    const booked = await bookSession(items[0], "2026-10-27");
    const result = await moveVisit(db, { visitId: booked.id, toDate: "2026-11-03", toTime: slotTime(3), toSchedule: schedule });
    if (!result.ok) throw new Error(result.reason);
    const movedTo = (await db.care_plan_items.get(items[0].id))!.visit_id!;
    await undoMostRecentVisitMutation(db, result.newVisitAuditLogId);
    await undoMostRecentVisitMutation(db, result.oldVisitAuditLogId);

    const ops = await opsInPushOrder();
    const deleteIndex = ops.findIndex((op) => op.entity === "visits" && op.entity_id === movedTo && op.action === AuditAction.Delete);
    const restoreIndex = ops.findLastIndex(
      (op) => op.entity === "care_plan_items" && op.entity_id === items[0].id && (op.payload as CarePlanItem).visit_id === booked.id,
    );
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeLessThan(deleteIndex);
    expect(await refusedVisitDeletes()).toEqual([]);
  });

  it.each<[string, (visitId: string) => Promise<string>]>([
    ["a cancel", (visitId) => cancelVisit(db, visitId, "patient")],
    ["a no-show", (visitId) => markVisitNoShow(db, visitId)],
  ])("undoing %s relinks the session it freed and re-dates the plan, in one transaction", async (_label, free) => {
    const { plan, items } = await makePlan();
    const booked = await bookSession(items[0], "2026-10-27");
    const bookedEnd = (await db.care_plans.get(plan.id))!.expected_end;
    const auditLogId = await free(booked.id);
    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBeNull();

    const before = await writeCounts();
    expect(await undoMostRecentVisitMutation(db, auditLogId)).toEqual({ ok: true });

    expect((await db.visits.get(booked.id))?.status).toBe(VisitStatus.Booked);
    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBe(booked.id);
    expect((await db.care_plans.get(plan.id))?.expected_end).toBe(bookedEnd);
    // The session, the visit and the plan's end: three writes, together.
    expect((await writeCounts()).auditRows - before.auditRows).toBe(3);
    expect(await verbsFor("care_plan_items", items[0].id)).toEqual(["أضاف جلسات للخطة", "سجّل حجز", "عدّل خطة رعاية", "سجّل حجز"]);
  });

  it("undoing a session's booking unlinks the session before the visit is deleted", async () => {
    const { plan, items } = await makePlan();
    const booked = await bookSession(items[0], "2026-10-27");
    const bookingRow = (await db.audit_log.orderBy("seq").toArray()).find(
      (row) => row.entity === "visits" && row.entity_id === booked.id,
    )!;

    expect(await undoMostRecentVisitMutation(db, bookingRow.id)).toEqual({ ok: true });

    expect(await db.visits.get(booked.id)).toBeUndefined();
    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBeNull();
    expect((await db.care_plans.get(plan.id))?.expected_end).toBe(plan.started_at);
    expect(await refusedVisitDeletes()).toEqual([]);
  });

  it("a session changed since keeps its later link", async () => {
    const { items } = await makePlan();
    const booked = await bookSession(items[0], "2026-10-27");
    const auditLogId = await cancelVisit(db, booked.id, "patient");
    const rebooked = await bookSession(items[0], "2026-11-03");

    expect(await undoMostRecentVisitMutation(db, auditLogId)).toEqual({ ok: true });

    expect((await db.visits.get(booked.id))?.status).toBe(VisitStatus.Booked);
    expect((await db.care_plan_items.get(items[0].id))?.visit_id).toBe(rebooked.id);
  });
});

describe("completion bills a session at its own price", () => {
  it("bills a linked visit at the session's price, not the service's", async () => {
    const { items } = await makePlan();
    await db.care_plan_items.update(items[1].id, { price: 12345 as Piastres });
    const booked = await bookSession({ ...items[1], price: 12345 as Piastres }, "2026-10-27");
    await db.visits.update(booked.id, { status: VisitStatus.Arrived, arrived_at: "2026-10-27T07:00:00.000Z" });
    await markVisitInRoom(db, booked.id);

    const { invoice } = await completeVisitWithInvoice(db, booked.id);
    expect(invoice.total).toBe(12345);
    const [line] = await db.invoice_items.where("invoice_id").equals(invoice.id).toArray();
    expect([line.unit_price, line.total, line.service_id, line.description]).toEqual([12345, 12345, physio.id, physio.name]);
    // Still linked, and now done.
    expect((await db.care_plan_items.get(items[1].id))?.visit_id).toBe(booked.id);
  });

  it("bills a visit that books no session exactly as before: the service's effective price", async () => {
    await db.service_price_overrides.add({
      id: id(),
      service_id: physio.id,
      practitioner_id: null,
      location_id: schedule.location_id,
      price: 18000 as Piastres,
      rev: 1,
    });
    await makePlan(); // a plan exists, but this visit is not one of its sessions
    const visit = await makeVisit({ position: 50 });
    const { invoice } = await completeVisitWithInvoice(db, visit.id);
    const expected = resolveServicePrice(physio, await db.service_price_overrides.toArray(), {
      practitionerId: visit.practitioner_id,
      locationId: visit.location_id,
    });
    expect(expected).toBe(18000);
    expect(invoice.total).toBe(expected);
  });
});

describe("carePlanSessionLabelForVisit", () => {
  it("labels a visit that books a session, counting only the sessions not skipped, and none otherwise", async () => {
    const { items, visit } = await makePlan();
    await skipCarePlanSession(db, items[1].id);
    const booked = await bookSession(items[2], "2026-10-27");
    expect(await carePlanSessionLabelForVisit(db, booked.id)).toBe(`جلسة 2 من 2 · ${physio.name}`);
    expect(await carePlanSessionLabelForVisit(db, visit.id)).toBeNull();
  });
});
