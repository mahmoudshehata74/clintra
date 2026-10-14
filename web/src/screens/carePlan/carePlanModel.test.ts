import { describe, expect, it } from "vitest";
import { CarePlanError } from "../../db/carePlans";
import { CarePlanItemStatus, CarePlanStatus, type CarePlan, type CarePlanItem, type Service, type Visit } from "../../db/types";
import type { Piastres } from "../../domain/money";
import { cairoInstant, type ClinicDay } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import {
  buildCarePlanSheet,
  canStartCarePlan,
  carePlanBadgeProgress,
  carePlanErrorMessage,
  derivePlanSessions,
  formatPlanMoney,
  formatShortClock,
  ongoingPlanFor,
  parseWholeNumber,
  previewCarePlanSessions,
  validateCarePlanDraft,
  type CarePlanSheetSource,
  type DraftGroup,
  type SessionRow,
} from "./carePlanModel";

const TODAY: ClinicDay = "2026-10-14";
const DOCTOR = "practitioner-1";

const physio: Service = {
  id: "physio",
  org_id: "org",
  name: "علاج طبيعي",
  duration_minutes: 30,
  default_price: 25000 as Piastres,
  is_active: true,
  rev: 1,
};
const review: Service = { ...physio, id: "review", name: "تقييم", duration_minutes: 45, default_price: 40000 as Piastres };
const SERVICES = [physio, review];

function plan(overrides: Partial<CarePlan> = {}): CarePlan {
  return {
    id: "plan-1",
    org_id: "org",
    location_id: "loc",
    template_id: "tpl",
    patient_id: "patient-1",
    practitioner_id: DOCTOR,
    goal: "استعادة الحركة",
    diagnosis: "التهاب وتر",
    planned_count: 10,
    total_price: 250000 as Piastres,
    paid: 0 as Piastres,
    status: CarePlanStatus.Active,
    started_at: "2026-08-15T07:00:00.000Z",
    expected_end: "2026-08-15T07:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function item(sequence: number, overrides: Partial<CarePlanItem> = {}): CarePlanItem {
  return {
    id: `item-${sequence}`,
    care_plan_id: "plan-1",
    service_id: sequence === 1 ? review.id : physio.id,
    sequence,
    visit_id: null,
    min_gap_days: sequence === 1 ? 0 : 7,
    depends_on_item_id: null,
    price: 25000 as Piastres,
    status: CarePlanItemStatus.Planned,
    rev: 1,
    ...overrides,
  };
}

function visit(id: string, status: VisitStatus, visitDate: ClinicDay, time: string | null = "09:30"): Visit {
  return {
    id,
    org_id: "org",
    location_id: "loc",
    practitioner_id: DOCTOR,
    patient_id: "patient-1",
    service_id: physio.id,
    care_plan_item_id: null,
    visit_date: visitDate,
    position: 1,
    scheduled_at: time === null ? null : cairoInstant(visitDate, time),
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership",
    created_at: "2026-08-15T07:00:00.000Z",
    note: null,
    rev: 1,
  };
}

function source(items: CarePlanItem[], visits: Visit[], overrides: Partial<CarePlanSheetSource> = {}): CarePlanSheetSource {
  return {
    plan: plan(),
    items,
    visits,
    services: SERVICES,
    patientName: "كريم فتحي",
    practitionerName: "أحمد المصري",
    invoices: [],
    payments: [],
    ...overrides,
  };
}

/** The prototype's plan: sessions 1–5 done a week apart from 2026-09-02, 6 booked today, 7–10 suggested. */
function prototypePlan() {
  const doneDays: ClinicDay[] = ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"];
  const visits = [
    ...doneDays.map((day, index) => visit(`done-${index + 1}`, VisitStatus.Completed, day)),
    visit("booked-6", VisitStatus.Booked, TODAY, "16:30"),
  ];
  const items = Array.from({ length: 10 }, (_, index) =>
    item(index + 1, { visit_id: index < 5 ? `done-${index + 1}` : index === 5 ? "booked-6" : null }),
  );
  return { items, visits };
}

const metaText = (row: SessionRow) => row.meta.map((part) => part.text).join(" · ");

describe("formatting", () => {
  it("formats times and money as the screen shows them", () => {
    expect(formatShortClock(cairoInstant("2026-10-14", "09:30"))).toBe("9:30");
    expect(formatShortClock(cairoInstant("2026-10-14", "16:30"))).toBe("16:30");
    expect(formatPlanMoney(250000 as Piastres)).toBe("2,500 ج.م");
    expect(formatPlanMoney(125050 as Piastres)).toBe("1,250.50 ج.م");
  });
});

describe("buildCarePlanSheet", () => {
  it("shows the prototype's plan: 5 done, the 6th booked and next, 4 suggested", () => {
    const { items, visits } = prototypePlan();
    const model = buildCarePlanSheet(
      source(items, visits, {
        invoices: [
          { id: "inv-1", visit_id: "done-1" },
          { id: "inv-2", visit_id: "done-2" },
          { id: "inv-other", visit_id: "unrelated" },
        ],
        payments: [
          { invoice_id: "inv-1", amount: 25000 as Piastres },
          { invoice_id: "inv-2", amount: 100000 as Piastres },
          { invoice_id: "inv-other", amount: 99900 as Piastres },
        ],
      }),
      TODAY,
      DOCTOR,
    );

    expect(model).toMatchObject({
      initial: "ك",
      patientName: "كريم فتحي",
      goal: "استعادة الحركة",
      diagnosis: "التهاب وتر",
      countLabel: "10 جلسات",
      done: 5,
      count: 10,
      progressLabel: "5 / 10 جلسة",
      progressPercent: 50,
      startedOn: "15 / 8 / 2026",
      // 16:30 today, then 7, 14, 21 and 28 days on.
      expectedEnd: "11 / 11 / 2026",
      total: "2,500 ج.م",
      paid: "1,250 ج.م",
      statusLine: null,
      sessionsSubtitle: "5 جلسات تمّت · 5 متبقية",
      canEdit: true,
    });
    expect(model.rows.map((row) => [row.n, row.tone, row.statusLabel])).toEqual([
      [1, "done", "تمّت"],
      [2, "done", "تمّت"],
      [3, "done", "تمّت"],
      [4, "done", "تمّت"],
      [5, "done", "تمّت"],
      [6, "next", "التالية"],
      [7, "suggested", "مقترحة"],
      [8, "suggested", "مقترحة"],
      [9, "suggested", "مقترحة"],
      [10, "suggested", "مقترحة"],
    ]);
    expect(model.rows[0].name).toBe("تقييم");
    expect(metaText(model.rows[0])).toBe("2 / 9 · د. أحمد المصري · 45 دقيقة");
    expect(model.rows[0].meta.map((part) => part.strong)).toEqual([false, true, false]);
    expect(metaText(model.rows[5])).toBe("14 / 10 · 16:30 · د. أحمد المصري · 30 دقيقة");
    expect(metaText(model.rows[6])).toBe("21 / 10 · مقترح");
    expect(model.rows[6].meta[1].strong).toBe(true);
    // The practitioner may skip a suggested session; nothing else has an action.
    expect(model.rows.map((row) => row.action?.label ?? null)).toEqual([null, null, null, null, null, null, "أجّل", "أجّل", "أجّل", "أجّل"]);

    expect(model.book).toEqual({
      itemId: "item-6",
      serviceId: physio.id,
      date: TODAY,
      disabledReason: "الجلسة التالية محجوزة 14 / 10 · 16:30",
    });
    expect(model.reminder).toEqual({ visitId: "booked-6", disabledReason: null });
  });

  it("books the next suggested session on its suggested day, today when that has passed or it has none", () => {
    const future = buildCarePlanSheet(
      source([item(1, { visit_id: "done-1" }), item(2)], [visit("done-1", VisitStatus.Completed, "2026-10-10")]),
      TODAY,
      DOCTOR,
    );
    expect(future.book).toEqual({ itemId: "item-2", serviceId: physio.id, date: "2026-10-17", disabledReason: null });

    const passed = buildCarePlanSheet(
      source([item(1, { visit_id: "done-1" }), item(2)], [visit("done-1", VisitStatus.Completed, "2026-10-01")]),
      TODAY,
      DOCTOR,
    );
    expect(passed.book?.date).toBe(TODAY);

    const undated = buildCarePlanSheet(source([item(1), item(2)], []), TODAY, DOCTOR);
    expect(undated.book).toEqual({ itemId: "item-1", serviceId: review.id, date: TODAY, disabledReason: null });
    // An undated session has no meta; nothing is booked to remind about.
    expect(undated.rows.map((row) => row.meta)).toEqual([[], []]);
    expect(undated.expectedEnd).toBe("—");
    expect(undated.reminder).toEqual({ visitId: null, disabledReason: "احجز الجلسة الأول" });
  });

  it("names a booked session's day alone in the reason when its visit has no time (queue)", () => {
    const model = buildCarePlanSheet(source([item(1, { visit_id: "queued" })], [visit("queued", VisitStatus.Booked, "2026-10-20", null)]), TODAY, DOCTOR);
    expect(model.book?.disabledReason).toBe("الجلسة التالية محجوزة 20 / 10");
    expect(metaText(model.rows[0])).toBe("20 / 10 · د. أحمد المصري · 45 دقيقة");
  });

  it("marks only the first booked session as next; a later one reads محجوزة", () => {
    const model = buildCarePlanSheet(
      source(
        [item(1, { visit_id: "b-1" }), item(2, { visit_id: "b-2" })],
        [visit("b-1", VisitStatus.Booked, "2026-10-20"), visit("b-2", VisitStatus.Confirmed, "2026-10-27")],
      ),
      TODAY,
      DOCTOR,
    );
    expect(model.rows.map((row) => [row.tone, row.statusLabel])).toEqual([
      ["next", "التالية"],
      ["booked", "محجوزة"],
    ]);
    expect(model.reminder.visitId).toBe("b-1");
  });

  it("warns that a plan has stalled, with nothing booked and the next session over a week past", () => {
    const model = buildCarePlanSheet(
      source([item(1, { visit_id: "done-1" }), item(2)], [visit("done-1", VisitStatus.Completed, "2026-09-24")]),
      TODAY,
      DOCTOR,
    );
    // Session 2 was due on 2026-10-01: 13 days ago.
    expect(model.statusLine).toEqual({ kind: "stalled", text: "المريض متوقف من 13 يوم" });
    expect(model.book?.disabledReason).toBeNull();
  });

  it("says a stopped plan is stopped and offers no booking", () => {
    const model = buildCarePlanSheet(source([item(1), item(2)], [], { plan: plan({ status: CarePlanStatus.Stopped }) }), TODAY, DOCTOR);
    expect(model.statusLine).toEqual({ kind: "stopped", text: "الخطة متوقفة" });
    expect(model.book).toBeNull();
  });

  it("says a completed plan is completed and offers no booking", () => {
    const model = buildCarePlanSheet(
      source(
        [item(1, { visit_id: "done-1" }), item(2, { status: CarePlanItemStatus.Skipped })],
        [visit("done-1", VisitStatus.Completed, "2026-10-01")],
      ),
      TODAY,
      DOCTOR,
    );
    expect(model.statusLine).toEqual({ kind: "completed", text: "الخطة اكتملت" });
    expect(model.book).toBeNull();
    expect(model.progressLabel).toBe("1 / 1 جلسة");
    expect(model.progressPercent).toBe(100);
    expect(model.rows[1]).toMatchObject({ tone: "skipped", statusLabel: "مؤجلة", meta: [], action: { kind: "unskip", label: "رجّع" } });
  });

  it("reads a plan whose every session is skipped as active with nothing to book", () => {
    const model = buildCarePlanSheet(
      source([item(1, { status: CarePlanItemStatus.Skipped }), item(2, { status: CarePlanItemStatus.Skipped })], []),
      TODAY,
      DOCTOR,
    );
    expect(model.statusLine).toBeNull();
    expect(model.book).toBeNull();
    expect(model.countLabel).toBe("0 جلسة");
    expect(model.progressPercent).toBe(0);
  });

  it("gives anyone but the plan's practitioner no edit and no skip, but the booking and the reminder", () => {
    const { items, visits } = prototypePlan();
    for (const acting of [null, "practitioner-2"]) {
      const model = buildCarePlanSheet(source(items, visits), TODAY, acting);
      expect(model.canEdit).toBe(false);
      expect(model.rows.every((row) => row.action === null)).toBe(true);
      expect(model.book).not.toBeNull();
      expect(model.reminder.visitId).toBe("booked-6");
    }
  });

  it("reads a session linked to a cancelled visit as suggested again", () => {
    const model = buildCarePlanSheet(source([item(1, { visit_id: "gone" })], [visit("gone", VisitStatus.Cancelled, "2026-10-20")]), TODAY, DOCTOR);
    expect(model.rows[0]).toMatchObject({ tone: "suggested", statusLabel: "مقترحة", meta: [] });
    expect(model.book?.disabledReason).toBeNull();
  });
});

describe("screen 10's entry points", () => {
  const { items, visits } = prototypePlan();
  const sessions = derivePlanSessions(items, visits, SERVICES);

  it("numbers the badge by the session this visit books, else by the done sessions plus one", () => {
    expect(carePlanBadgeProgress(sessions, "booked-6")).toBe("جلسة 6 من 10");
    expect(carePlanBadgeProgress(sessions, "done-2")).toBe("جلسة 2 من 10");
    expect(carePlanBadgeProgress(sessions, "another-visit")).toBe("جلسة 6 من 10");
    // Skipped sessions are not counted; done + 1 never passes the count.
    const skipped = derivePlanSessions([item(1, { visit_id: "done-1" }), item(2, { status: CarePlanItemStatus.Skipped })], visits, SERVICES);
    expect(carePlanBadgeProgress(skipped, "x")).toBe("جلسة 1 من 1");
    expect(carePlanBadgeProgress(derivePlanSessions([item(1), item(2), item(3)], [], SERVICES), "x")).toBe("جلسة 1 من 3");
  });

  it("finds the patient's plan under way with the practitioner, never a stopped or completed one", () => {
    const ongoing = { plan: plan(), sessions };
    const stopped = { plan: plan({ id: "stopped", status: CarePlanStatus.Stopped }), sessions };
    const completed = {
      plan: plan({ id: "completed" }),
      sessions: derivePlanSessions([item(1, { visit_id: "done-1" })], visits, SERVICES),
    };
    expect(ongoingPlanFor([stopped, completed, ongoing], "patient-1", DOCTOR)?.plan.id).toBe("plan-1");
    expect(ongoingPlanFor([stopped, completed], "patient-1", DOCTOR)).toBeNull();
    expect(ongoingPlanFor([ongoing], "patient-2", DOCTOR)).toBeNull();
    expect(ongoingPlanFor([ongoing], "patient-1", "practitioner-2")).toBeNull();
  });

  it.each<[string, string | null, VisitStatus, boolean, boolean]>([
    ["the visit's practitioner, in the room", DOCTOR, VisitStatus.InRoom, false, true],
    ["the visit's practitioner, completed", DOCTOR, VisitStatus.Completed, false, true],
    ["the visit's practitioner, booked", DOCTOR, VisitStatus.Booked, false, false],
    ["the visit's practitioner, arrived", DOCTOR, VisitStatus.Arrived, false, false],
    ["another practitioner", "practitioner-2", VisitStatus.InRoom, false, false],
    ["the assistant", null, VisitStatus.InRoom, false, false],
    ["a plan already under way", DOCTOR, VisitStatus.InRoom, true, false],
  ])("offers ابدأ خطة رعاية or not: %s", (_label, acting, status, hasOngoing, offered) => {
    expect(canStartCarePlan(acting, { practitioner_id: DOCTOR, status }, hasOngoing)).toBe(offered);
  });
});

describe("the create form", () => {
  const ACTIVE = new Set(SERVICES.map((service) => service.id));
  const group = (overrides: Partial<DraftGroup> = {}): DraftGroup => ({ key: "g", serviceId: physio.id, count: "6", gap: "7", ...overrides });

  it("parses whole numbers as typed, Arabic-Indic digits included", () => {
    expect(parseWholeNumber(" 6 ", 1)).toBe(6);
    expect(parseWholeNumber("١٢", 1)).toBe(12);
    expect(parseWholeNumber("0", 0)).toBe(0);
    expect(parseWholeNumber("0", 1)).toBeNull();
    expect(parseWholeNumber("2.5", 1)).toBeNull();
    expect(parseWholeNumber("-1", 0)).toBeNull();
    expect(parseWholeNumber("", 0)).toBeNull();
  });

  it("validates as the writer does, one message per field", () => {
    const valid = validateCarePlanDraft({ goal: " هدف ", diagnosis: "تشخيص", groups: [group(), group({ serviceId: review.id, count: "1", gap: "0" })] }, ACTIVE);
    expect(valid).toEqual({
      ok: true,
      errors: { groups: [{}, {}] },
      groups: [
        { serviceId: physio.id, count: 6, gapDays: 7 },
        { serviceId: review.id, count: 1, gapDays: 0 },
      ],
    });

    const invalid = validateCarePlanDraft(
      { goal: " ", diagnosis: "", groups: [group({ count: "0" }), group({ gap: "-2" }), group({ serviceId: "inactive" })] },
      ACTIVE,
    );
    expect(invalid).toEqual({
      ok: false,
      errors: {
        goal: "اكتب الهدف",
        diagnosis: "اكتب التشخيص",
        groups: [
          { count: "عدد الجلسات لازم يكون 1 أو أكتر" },
          { gap: "عدد الأيام لازم يكون 0 أو أكتر" },
          { serviceId: "اختار الخدمة" },
        ],
      },
    });
    expect(validateCarePlanDraft({ goal: "هدف", diagnosis: "تشخيص", groups: [] }, ACTIVE).ok).toBe(false);
    // The edit form's added sessions need no goal or diagnosis.
    expect(validateCarePlanDraft({ goal: "", diagnosis: "", groups: [group()] }, ACTIVE, false).ok).toBe(true);
  });

  it("previews the sessions with their suggested days and the total at each service's effective price", () => {
    const priceOf = (service: Service) => (service.id === physio.id ? (20000 as Piastres) : service.default_price);
    const preview = previewCarePlanSessions(
      [group({ serviceId: review.id, count: "1", gap: "3" }), group({ count: "2", gap: "7" })],
      SERVICES,
      priceOf,
      TODAY,
    );
    expect(preview.rows).toEqual([
      { n: 1, serviceName: "تقييم", date: "14 / 10" },
      { n: 2, serviceName: "علاج طبيعي", date: "21 / 10" },
      { n: 3, serviceName: "علاج طبيعي", date: "28 / 10" },
    ]);
    expect(preview.total).toBe(40000 + 2 * 20000);
  });

  it("leaves a group that is not valid yet out of the preview", () => {
    const preview = previewCarePlanSessions([group({ count: "" }), group({ count: "2", gap: "4" })], SERVICES, (s) => s.default_price, TODAY);
    expect(preview.rows.map((row) => row.date)).toEqual(["14 / 10", "18 / 10"]);
    expect(preview.total).toBe(50000);
  });

  it("maps the writer's refusals to Arabic", () => {
    expect(carePlanErrorMessage(new Error(CarePlanError.PlanAlreadyActive))).toBe("المريض عنده خطة رعاية جارية مع الدكتور ده");
    expect(carePlanErrorMessage(new Error(CarePlanError.NotPlanPractitioner))).toBe("الخطة بيعدّلها دكتور الخطة بس");
    expect(carePlanErrorMessage(new Error(CarePlanError.GoalRequired))).toBe("اكتب الهدف");
    expect(carePlanErrorMessage(new Error("boom"))).toBe("ما اتحفظش، جرّب تاني");
  });
});
