import { describe, expect, it } from "vitest";
import { CarePlanItemStatus, CarePlanStatus, type CarePlanItem } from "../db/types";
import {
  carePlanEndDate,
  carePlanExpectedEnd,
  carePlanPaid,
  carePlanSessionMessageLabel,
  CarePlanSessionState,
  carePlanStalledDays,
  carePlanStalledLabel,
  carePlanTotals,
  deriveCarePlanSessions,
  isCarePlanCompleted,
  nextSuggestedSession,
  type SessionVisit,
} from "./carePlan";
import type { Piastres } from "./money";
import { cairoInstant } from "./time";
import { VisitStatus } from "./visitStatus";

function item(sequence: number, overrides: Partial<CarePlanItem> = {}): CarePlanItem {
  return {
    id: `item-${sequence}`,
    care_plan_id: "plan-1",
    service_id: "service-pt",
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

function visit(id: string, status: VisitStatus, visitDate: string): SessionVisit {
  return { id, status, visit_date: visitDate };
}

const SERVICES = new Map([
  ["service-pt", "علاج طبيعي"],
  ["service-review", "متابعة"],
]);

function derive(items: CarePlanItem[], visits: SessionVisit[] = []) {
  return deriveCarePlanSessions(items, new Map(visits.map((v) => [v.id, v])), SERVICES);
}

describe("deriveCarePlanSessions", () => {
  it.each<[string, VisitStatus | "missing", CarePlanSessionState, string | null]>([
    ["a completed visit", VisitStatus.Completed, CarePlanSessionState.Done, "2026-10-01"],
    ["a booked visit", VisitStatus.Booked, CarePlanSessionState.Booked, "2026-10-01"],
    ["a confirmed visit", VisitStatus.Confirmed, CarePlanSessionState.Booked, "2026-10-01"],
    ["an arrived visit", VisitStatus.Arrived, CarePlanSessionState.Booked, "2026-10-01"],
    ["a visit in the room", VisitStatus.InRoom, CarePlanSessionState.Booked, "2026-10-01"],
    ["a cancelled visit, which no longer books it", VisitStatus.Cancelled, CarePlanSessionState.Suggested, null],
    ["a missed visit", VisitStatus.NoShow, CarePlanSessionState.Suggested, null],
    ["a visit moved away", VisitStatus.Rescheduled, CarePlanSessionState.Suggested, null],
    ["a visit missing from the store", "missing", CarePlanSessionState.Suggested, null],
  ])("reads a session linked to %s", (_label, status, state, date) => {
    const visits = status === "missing" ? [] : [visit("visit-1", status, "2026-10-01")];
    const [session] = derive([item(1, { visit_id: "visit-1" })], visits);
    expect(session.state).toBe(state);
    expect(session.date).toBe(date);
    expect(session.visit?.id ?? null).toBe(state === CarePlanSessionState.Suggested ? null : "visit-1");
  });

  it("dates each session from the previous one plus its own gap, in sequence order whatever the input order", () => {
    const sessions = derive(
      [item(3, { min_gap_days: 14 }), item(1, { visit_id: "visit-1" }), item(2, { visit_id: "visit-2" }), item(4)],
      [visit("visit-1", VisitStatus.Completed, "2026-10-01"), visit("visit-2", VisitStatus.Booked, "2026-10-09")],
    );
    expect(sessions.map((s) => [s.item.sequence, s.state, s.date])).toEqual([
      [1, CarePlanSessionState.Done, "2026-10-01"],
      [2, CarePlanSessionState.Booked, "2026-10-09"],
      [3, CarePlanSessionState.Suggested, "2026-10-23"],
      [4, CarePlanSessionState.Suggested, "2026-10-30"],
    ]);
  });

  it("has no date anywhere until a session is linked, and reads each as جلسة {n} with its service name as the label", () => {
    const sessions = derive([item(1), item(2, { service_id: "service-review" })]);
    expect(sessions.map((s) => [s.date, s.fallbackLabel, s.label])).toEqual([
      [null, "جلسة 1", "علاج طبيعي"],
      [null, "جلسة 2", "متابعة"],
    ]);
  });

  it("leaves a skipped session out of the chain: the next one counts from the session before it", () => {
    const sessions = derive(
      [item(1, { visit_id: "visit-1" }), item(2, { status: CarePlanItemStatus.Skipped }), item(3, { min_gap_days: 10 })],
      [visit("visit-1", VisitStatus.Completed, "2026-10-01")],
    );
    expect(sessions.map((s) => [s.state, s.date])).toEqual([
      [CarePlanSessionState.Done, "2026-10-01"],
      [CarePlanSessionState.Skipped, null],
      [CarePlanSessionState.Suggested, "2026-10-11"],
    ]);
  });

  it("dates a session after a linked visit from that visit's day, even when an earlier session has no date", () => {
    const sessions = derive([item(1), item(2, { visit_id: "visit-2" }), item(3)], [visit("visit-2", VisitStatus.Booked, "2026-11-02")]);
    expect(sessions.map((s) => s.date)).toEqual([null, "2026-11-02", "2026-11-09"]);
  });
});

describe("plan totals, end and completion", () => {
  it("counts and prices only the sessions not skipped", () => {
    expect(
      carePlanTotals([
        item(1),
        item(2, { price: 30000 as Piastres }),
        item(3, { status: CarePlanItemStatus.Skipped, price: 99999 as Piastres }),
      ]),
    ).toEqual({ planned_count: 2, total_price: 55000 });
    expect(carePlanTotals([])).toEqual({ planned_count: 0, total_price: 0 });
  });

  it("ends on the last session not skipped, stored at Cairo midnight, or at started_at while there is no date", () => {
    const dated = derive([item(1, { visit_id: "visit-1" }), item(2), item(3, { status: CarePlanItemStatus.Skipped })], [
      visit("visit-1", VisitStatus.Booked, "2026-10-01"),
    ]);
    expect(carePlanEndDate(dated)).toBe("2026-10-08");
    expect(carePlanExpectedEnd("2026-09-01T08:00:00.000Z", dated)).toBe(cairoInstant("2026-10-08", "00:00"));

    const undated = derive([item(1), item(2)]);
    expect(carePlanEndDate(undated)).toBeNull();
    expect(carePlanExpectedEnd("2026-09-01T08:00:00.000Z", undated)).toBe("2026-09-01T08:00:00.000Z");
  });

  it.each<[string, CarePlanItem[], boolean]>([
    ["every session done", [item(1, { visit_id: "done-1" }), item(2, { visit_id: "done-2" })], true],
    ["a skipped session left", [item(1, { visit_id: "done-1" }), item(2, { status: CarePlanItemStatus.Skipped })], true],
    ["a booked session left", [item(1, { visit_id: "done-1" }), item(2, { visit_id: "booked-1" })], false],
    ["a suggested session left", [item(1, { visit_id: "done-1" }), item(2)], false],
  ])("is completed or not with %s", (_label, items, completed) => {
    const sessions = derive(items, [
      visit("done-1", VisitStatus.Completed, "2026-10-01"),
      visit("done-2", VisitStatus.Completed, "2026-10-08"),
      visit("booked-1", VisitStatus.Booked, "2026-10-15"),
    ]);
    expect(isCarePlanCompleted(sessions)).toBe(completed);
  });

  it("finds the next suggested session in sequence order", () => {
    const sessions = derive([item(1, { visit_id: "done-1" }), item(2, { status: CarePlanItemStatus.Skipped }), item(3), item(4)], [
      visit("done-1", VisitStatus.Completed, "2026-10-01"),
    ]);
    expect(nextSuggestedSession(sessions)?.item.sequence).toBe(3);
    expect(nextSuggestedSession(derive([item(1, { visit_id: "done-1" })], [visit("done-1", VisitStatus.Completed, "2026-10-01")]))).toBeNull();
  });
});

describe("carePlanStalledDays", () => {
  // Session 1 was done on 2026-10-01; session 2 is suggested 7 days later, on 2026-10-08.
  const visits = [visit("done-1", VisitStatus.Completed, "2026-10-01"), visit("booked-3", VisitStatus.Booked, "2026-10-30")];
  const items = [item(1, { visit_id: "done-1" }), item(2), item(3)];

  it.each<[string, CarePlanStatus, CarePlanItem[], string, number | null]>([
    ["8 days past the next session's date", CarePlanStatus.Active, items, "2026-10-16", 8],
    ["exactly 7 days past it", CarePlanStatus.Active, items, "2026-10-15", null],
    ["before its date", CarePlanStatus.Active, items, "2026-10-05", null],
    ["a stopped plan", CarePlanStatus.Stopped, items, "2026-10-30", null],
    ["a later session already booked", CarePlanStatus.Active, [items[0], items[1], item(3, { visit_id: "booked-3" })], "2026-10-30", null],
    ["a completed plan", CarePlanStatus.Active, [items[0]], "2026-12-30", null],
    ["a next session with no date", CarePlanStatus.Active, [item(1), item(2)], "2026-12-30", null],
  ])("is %s → %s", (_label, status, planItems, today, days) => {
    expect(carePlanStalledDays({ status }, derive(planItems, visits), today)).toBe(days);
  });

  it.each([
    [8, "المريض متوقف من 8 أيام"],
    [10, "المريض متوقف من 10 أيام"],
    [11, "المريض متوقف من 11 يوم"],
    [30, "المريض متوقف من 30 يوم"],
  ])("reads %i days as %s", (days, label) => {
    expect(carePlanStalledLabel(days)).toBe(label);
  });
});

describe("carePlanPaid", () => {
  it("sums the payments on the invoices of the plan's linked visits, and nothing else", () => {
    const items = [item(1, { visit_id: "visit-1" }), item(2, { visit_id: "visit-2" }), item(3)];
    const invoices = [
      { id: "invoice-1", visit_id: "visit-1" },
      { id: "invoice-2", visit_id: "visit-2" },
      { id: "invoice-other", visit_id: "visit-other" },
      { id: "invoice-walkin", visit_id: null },
    ];
    const payments = [
      { invoice_id: "invoice-1", amount: 25000 as Piastres },
      { invoice_id: "invoice-2", amount: 10000 as Piastres },
      { invoice_id: "invoice-2", amount: 5000 as Piastres },
      { invoice_id: "invoice-other", amount: 99999 as Piastres },
      { invoice_id: "invoice-walkin", amount: 77777 as Piastres },
    ];
    expect(carePlanPaid(items, invoices, payments)).toBe(40000);
    expect(carePlanPaid([item(1)], invoices, payments)).toBe(0);
  });
});

describe("carePlanSessionMessageLabel", () => {
  const sessions = derive([
    item(1),
    item(2, { status: CarePlanItemStatus.Skipped }),
    item(3, { service_id: "service-review" }),
    item(4, { service_id: "service-unknown" }),
  ]);

  it.each<[string, string | null]>([
    ["item-1", "جلسة 1 من 3 · علاج طبيعي"],
    ["item-3", "جلسة 2 من 3 · متابعة"],
    ["item-4", "جلسة 3 من 3"],
    ["item-2", null],
    ["item-missing", null],
  ])("labels %s as %s, counting only the sessions not skipped", (itemId, label) => {
    expect(carePlanSessionMessageLabel(sessions, itemId)).toBe(label);
  });
});
