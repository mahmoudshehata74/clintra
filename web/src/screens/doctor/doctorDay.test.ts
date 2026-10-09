import { describe, expect, it } from "vitest";
import type { Invoice, Service, Visit } from "../../db/types";
import type { VisitFormFieldValues } from "../../db/visitForm";
import { arabicCount } from "../../domain/arabicText";
import { cairoInstant, type ClockTime } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import {
  canCallIn,
  computeAge,
  computeAttentionItems,
  computeDayList,
  computeMomentum,
  computeWaitingRoom,
  countPriorCompletedVisits,
  dayListAction,
  findCurrentVisit,
  findLastInvoiceState,
  findNextPatient,
  formatRelativeVisitTime,
  hasMissingDiagnosis,
  lastInvoiceStateLabel,
  LONG_WAIT_MINUTES,
  computeSinceLabel,
  PRIOR_VISIT_FORMS,
  summarizeLastVisit,
  TOTAL_VISITS_FORMS,
  WAITING_COUNT_FORMS,
  waitingWord,
} from "./doctorDay";
import { doctorDayStrings as T } from "./strings";

const TODAY = "2026-10-08";
const at = (time: ClockTime, day = TODAY) => cairoInstant(day, time);
const nowAt = (time: ClockTime) => new Date(at(time));

let nextId = 0;
function makeVisit(overrides: Partial<Visit> = {}): Visit {
  nextId += 1;
  return {
    id: `visit-${nextId}`,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: `patient-${nextId}`,
    service_id: null,
    care_plan_item_id: null,
    visit_date: TODAY,
    position: nextId,
    scheduled_at: null,
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: at("08:00"),
    note: null,
    rev: 1,
    ...overrides,
  };
}

function completed(start: ClockTime, end: ClockTime, overrides: Partial<Visit> = {}): Visit {
  return makeVisit({ status: VisitStatus.Completed, started_at: at(start), ended_at: at(end), ...overrides });
}

function makeService(id: string, duration: number): Service {
  return { id, org_id: "org-1", name: id, duration_minutes: duration, default_price: 0, is_active: true, rev: 1 } as Service;
}

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: `invoice-${overrides.visit_id ?? "x"}-${overrides.issued_at ?? ""}`,
    org_id: "org-1",
    location_id: "location-1",
    number: 1,
    issued_year: 2026,
    patient_id: "patient-1",
    practitioner_id: "practitioner-1",
    visit_id: null,
    total: 100,
    paid: 0,
    status: "unpaid",
    issued_at: at("10:00"),
    rev: 1,
    ...overrides,
  } as Invoice;
}

const NO_FORMS = new Map<string, VisitFormFieldValues>();

describe("computeMomentum", () => {
  const services = new Map([
    ["s15", makeService("s15", 15)],
    ["s20", makeService("s20", 20)],
    ["s30", makeService("s30", 30)],
  ]);

  it("is null (bar hidden) until a consultation today has a recorded length", () => {
    const visits = [makeVisit({ status: VisitStatus.InRoom, started_at: at("09:00") }), makeVisit()];
    expect(computeMomentum(visits, services, false, TODAY, nowAt("09:30"))).toBeNull();
    // Completed but missing started_at: still no recorded length.
    const noLength = [makeVisit({ status: VisitStatus.Completed, ended_at: at("09:20") })];
    expect(computeMomentum(noLength, services, false, TODAY, nowAt("09:30"))).toBeNull();
  });

  it("slots: median of consult lengths, median service duration as the plan, lateness from the earliest overdue unstarted visit", () => {
    const visits = [
      completed("09:00", "09:21", { service_id: "s15", scheduled_at: at("09:00") }),
      completed("09:21", "09:40", { service_id: "s20", scheduled_at: at("09:30") }),
      completed("09:40", "10:05", { service_id: "s20", scheduled_at: at("10:00") }),
      makeVisit({ status: VisitStatus.Arrived, scheduled_at: at("10:30"), service_id: "s30" }),
      makeVisit({ status: VisitStatus.Booked, scheduled_at: at("11:00"), service_id: "s15" }),
      // Cancelled visits are not part of the plan.
      makeVisit({ status: VisitStatus.Cancelled, scheduled_at: at("11:30"), service_id: "s30" }),
    ];
    const momentum = computeMomentum(visits, services, false, TODAY, nowAt("10:45"));
    expect(momentum).toMatchObject({
      medianMinutes: 21,
      plannedMinutes: 20,
      lateMinutes: 15,
      isLate: true,
      runsLongerThanPlan: true,
    });
    // Two waiting (arrived + booked), none in the room: 10:45 + 2 × 21.
    expect(momentum?.expectedFinish).toBe("11:27");
  });

  it("slots: reads on time at or below the five-minute tolerance, and with nothing overdue", () => {
    const base = [completed("09:00", "09:15", { service_id: "s15" })];
    const fiveLate = [...base, makeVisit({ status: VisitStatus.Booked, scheduled_at: at("10:00") })];
    expect(computeMomentum(fiveLate, services, false, TODAY, nowAt("10:05"))).toMatchObject({
      lateMinutes: 5,
      isLate: false,
    });
    const sixLate = computeMomentum(fiveLate, services, false, TODAY, nowAt("10:06"));
    expect(sixLate).toMatchObject({ lateMinutes: 6, isLate: true });

    const notYetDue = [...base, makeVisit({ status: VisitStatus.Booked, scheduled_at: at("11:00") })];
    expect(computeMomentum(notYetDue, services, false, TODAY, nowAt("10:06"))).toMatchObject({
      lateMinutes: 0,
      isLate: false,
    });
  });

  it("slots: an in-room visit past its time is not counted as late — only unstarted ones are", () => {
    const visits = [
      completed("09:00", "09:15"),
      makeVisit({ status: VisitStatus.InRoom, scheduled_at: at("09:30"), started_at: at("09:40") }),
    ];
    expect(computeMomentum(visits, services, false, TODAY, nowAt("10:30"))?.lateMinutes).toBe(0);
  });

  it("slots: no plan when no occupying visit has a service", () => {
    const visits = [completed("09:00", "09:15")];
    expect(computeMomentum(visits, services, false, TODAY, nowAt("10:00"))).toMatchObject({
      plannedMinutes: null,
      runsLongerThanPlan: false,
    });
  });

  it("queue: no plan and no lateness — only the median and the expected finish", () => {
    const visits = [
      completed("10:00", "10:12", { service_id: "s30" }),
      makeVisit({ status: VisitStatus.InRoom, started_at: at("10:12") }),
      makeVisit({ status: VisitStatus.Arrived }),
      makeVisit({ status: VisitStatus.Booked }),
    ];
    const momentum = computeMomentum(visits, services, true, TODAY, nowAt("10:20"));
    expect(momentum).toMatchObject({
      medianMinutes: 12,
      plannedMinutes: null,
      lateMinutes: null,
      isLate: false,
      runsLongerThanPlan: false,
    });
    // In the room + two waiting = three turns: 10:20 + 36.
    expect(momentum?.expectedFinish).toBe("10:56");
  });

  it("drops time-relative figures off the live day (a ?seedDay=1 pin), keeping the median", () => {
    const visits = [completed("09:00", "09:15"), makeVisit({ status: VisitStatus.Booked, scheduled_at: at("09:30") })];
    const momentum = computeMomentum(visits, services, false, TODAY, new Date(at("10:00", "2026-10-12")));
    expect(momentum).toMatchObject({ medianMinutes: 15, lateMinutes: null, isLate: false, expectedFinish: null });
  });

  it("has no expected finish once nobody is left", () => {
    const visits = [completed("09:00", "09:15")];
    expect(computeMomentum(visits, services, false, TODAY, nowAt("10:00"))?.expectedFinish).toBeNull();
  });
});

describe("findCurrentVisit", () => {
  it("returns the in-room visit, or null with nobody in the room", () => {
    const inRoom = makeVisit({ status: VisitStatus.InRoom, started_at: at("10:00") });
    expect(findCurrentVisit([makeVisit(), inRoom])).toBe(inRoom);
    expect(findCurrentVisit([makeVisit(), completed("09:00", "09:10")])).toBeNull();
  });

  it("picks the earliest started when more than one is in the room", () => {
    const later = makeVisit({ status: VisitStatus.InRoom, started_at: at("10:10") });
    const earlier = makeVisit({ status: VisitStatus.InRoom, started_at: at("10:00") });
    expect(findCurrentVisit([later, earlier])).toBe(earlier);
  });
});

describe("findNextPatient", () => {
  it("queue: the waiting visit with the lowest position, arrived or not", () => {
    const booked = makeVisit({ position: 2, status: VisitStatus.Booked });
    const arrived = makeVisit({ position: 3, status: VisitStatus.Arrived });
    expect(findNextPatient([arrived, booked], true)).toEqual({ visit: booked, hasArrived: false });
    expect(findNextPatient([arrived], true)).toEqual({ visit: arrived, hasArrived: true });
  });

  it("slots: the earliest arrived visit beats an earlier-scheduled one not yet here", () => {
    const bookedEarly = makeVisit({ status: VisitStatus.Booked, scheduled_at: at("09:00") });
    const arrivedLate = makeVisit({ status: VisitStatus.Arrived, scheduled_at: at("10:00") });
    const arrivedLater = makeVisit({ status: VisitStatus.Arrived, scheduled_at: at("10:30") });
    expect(findNextPatient([arrivedLater, bookedEarly, arrivedLate], false)).toEqual({
      visit: arrivedLate,
      hasArrived: true,
    });
  });

  it("slots: falls back to the earliest booked or confirmed visit", () => {
    const confirmed = makeVisit({ status: VisitStatus.Confirmed, scheduled_at: at("09:30") });
    const booked = makeVisit({ status: VisitStatus.Booked, scheduled_at: at("10:00") });
    expect(findNextPatient([booked, confirmed], false)).toEqual({ visit: confirmed, hasArrived: false });
  });

  it("is null when nobody is left to see", () => {
    const visits = [completed("09:00", "09:10"), makeVisit({ status: VisitStatus.InRoom })];
    expect(findNextPatient(visits, false)).toBeNull();
    expect(findNextPatient(visits, true)).toBeNull();
  });
});

describe("canCallIn / dayListAction", () => {
  it("allows the call only where transitions.ts allows in_room (arrived)", () => {
    expect(canCallIn(makeVisit({ status: VisitStatus.Arrived }))).toBe(true);
    for (const status of [VisitStatus.Booked, VisitStatus.Confirmed, VisitStatus.InRoom, VisitStatus.Completed]) {
      expect(canCallIn(makeVisit({ status }))).toBe(false);
    }
  });

  it("maps status to the row action", () => {
    expect(dayListAction(makeVisit({ status: VisitStatus.Completed }))).toBe("review");
    expect(dayListAction(makeVisit({ status: VisitStatus.InRoom }))).toBe("open");
    expect(dayListAction(makeVisit({ status: VisitStatus.Arrived }))).toBe("call");
    expect(dayListAction(makeVisit({ status: VisitStatus.Booked }))).toBeNull();
  });
});

describe("patient history", () => {
  const current = makeVisit({ patient_id: "p", status: VisitStatus.InRoom });
  const old = completed("09:00", "09:20", { patient_id: "p", visit_date: "2026-09-17", practitioner_id: "other" });
  const recent = completed("11:00", "11:20", { patient_id: "p", visit_date: "2026-10-01" });
  const cancelled = makeVisit({ patient_id: "p", visit_date: "2026-10-05", status: VisitStatus.Cancelled });
  const someoneElse = completed("09:00", "09:20", { patient_id: "q", visit_date: "2026-10-07" });
  const history = [current, old, recent, cancelled, someoneElse];

  it("counts prior completed visits only, optionally with one practitioner", () => {
    expect(countPriorCompletedVisits(history, current)).toBe(2);
    expect(countPriorCompletedVisits(history, current, "practitioner-1")).toBe(1);
    expect(countPriorCompletedVisits([current], current)).toBe(0);
  });

  it("summarizes the most recent completed visit with any practitioner, omitting empty parts", () => {
    const forms = new Map<string, VisitFormFieldValues>([
      [recent.id, { complaint: "صداع", diagnosis: "  " }],
      [old.id, { complaint: "", diagnosis: "شد عضلي" }],
    ]);
    expect(summarizeLastVisit(history, current, forms, TODAY)).toEqual({
      visit: recent,
      relativeTime: "قبل 7 أيام",
      complaint: "صداع",
      diagnosis: null,
      nothingRecorded: false,
    });
    // The older visit wins once the recent one is gone, even with another practitioner.
    expect(summarizeLastVisit([current, old], current, forms, TODAY)).toMatchObject({
      visit: old,
      relativeTime: "قبل 3 أسابيع",
      complaint: null,
      diagnosis: "شد عضلي",
    });
  });

  it("keeps the block, flagged nothingRecorded, when the prior visit has neither complaint nor diagnosis", () => {
    const blank = new Map<string, VisitFormFieldValues>([[recent.id, { complaint: " ", diagnosis: "" }]]);
    expect(summarizeLastVisit(history, current, blank, TODAY)).toMatchObject({
      visit: recent,
      complaint: null,
      diagnosis: null,
      nothingRecorded: true,
    });
    // No form row at all reads the same way.
    expect(summarizeLastVisit(history, current, NO_FORMS, TODAY)?.nothingRecorded).toBe(true);
  });

  it("returns null (block omitted) without a prior completed visit", () => {
    expect(summarizeLastVisit([current, cancelled], current, NO_FORMS, TODAY)).toBeNull();
  });

  it("counts an earlier completed visit the same day as prior", () => {
    const sameDay = completed("09:00", "09:10", { patient_id: "p" });
    expect(summarizeLastVisit([current, sameDay], current, NO_FORMS, TODAY)?.relativeTime).toBe(T.relativeToday);
  });
});

describe("findLastInvoiceState", () => {
  it("reads the most recent non-void invoice", () => {
    const invoices = [
      makeInvoice({ status: "paid", issued_at: at("10:00", "2026-09-01") }),
      makeInvoice({ status: "partial", issued_at: at("10:00", "2026-09-20") }),
      makeInvoice({ status: "void", issued_at: at("10:00", "2026-10-01") }),
    ];
    expect(findLastInvoiceState(invoices)).toBe("partial");
    expect(findLastInvoiceState(invoices.slice(0, 1))).toBe("paid");
  });

  it("is null with no invoice, or only void ones", () => {
    expect(findLastInvoiceState([])).toBeNull();
    expect(findLastInvoiceState([makeInvoice({ status: "void" })])).toBeNull();
  });

  it("labels each state in the owner's wording", () => {
    expect(lastInvoiceStateLabel("paid")).toBe("مدفوعة كاملة");
    expect(lastInvoiceStateLabel("partial")).toBe("مدفوعة جزئيًا");
    expect(lastInvoiceStateLabel("unpaid")).toBe("مش مدفوعة");
  });
});

describe("computeWaitingRoom", () => {
  it("lists arrived visits only, in slot order, with waits from arrived_at and long-wait flags", () => {
    const late = makeVisit({ status: VisitStatus.Arrived, scheduled_at: at("10:30"), arrived_at: at("10:20") });
    const early = makeVisit({ status: VisitStatus.Arrived, scheduled_at: at("10:00"), arrived_at: at("09:50") });
    const visits = [
      late,
      early,
      makeVisit({ status: VisitStatus.Booked, scheduled_at: at("11:00") }),
      makeVisit({ status: VisitStatus.InRoom, scheduled_at: at("09:30") }),
    ];
    const room = computeWaitingRoom(visits, false, TODAY, nowAt("10:30"));
    expect(room.rows).toEqual([
      { visit: early, waitedMinutes: 40, isLong: true },
      { visit: late, waitedMinutes: 10, isLong: false },
    ]);
    expect(room.longestMinutes).toBe(40);
    expect(room.longCount).toBe(1);
  });

  it("is long only above the threshold, not at it", () => {
    const visit = makeVisit({ status: VisitStatus.Arrived, arrived_at: at("10:00") });
    const atThreshold = computeWaitingRoom([visit], true, TODAY, new Date(new Date(at("10:00")).getTime() + LONG_WAIT_MINUTES * 60_000));
    expect(atThreshold.rows[0].isLong).toBe(false);
    expect(atThreshold.longCount).toBe(0);
  });

  it("queue: orders by position and falls back to created_at without arrived_at", () => {
    const second = makeVisit({ status: VisitStatus.Arrived, position: 5, arrived_at: at("10:00") });
    const first = makeVisit({ status: VisitStatus.Arrived, position: 4, arrived_at: null, created_at: at("09:45") });
    const room = computeWaitingRoom([second, first], true, TODAY, nowAt("10:15"));
    expect(room.rows.map((row) => [row.visit, row.waitedMinutes])).toEqual([
      [first, 30],
      [second, 15],
    ]);
  });

  it("is empty with nobody waiting", () => {
    expect(computeWaitingRoom([makeVisit()], false, TODAY, nowAt("10:00"))).toEqual({
      rows: [],
      longestMinutes: null,
      longCount: 0,
    });
  });

  it("has no wait figures off the live day", () => {
    const visit = makeVisit({ status: VisitStatus.Arrived, arrived_at: at("09:00") });
    const room = computeWaitingRoom([visit], false, TODAY, new Date(at("10:00", "2026-10-12")));
    expect(room.rows).toEqual([{ visit, waitedMinutes: null, isLong: false }]);
    expect(room.longestMinutes).toBeNull();
  });
});

describe("waitingWord", () => {
  it("is gendered from patients.gender, neutral when unknown", () => {
    expect(waitingWord({ gender: "female" })).toBe("مستنية");
    expect(waitingWord({ gender: "male" })).toBe("مستني");
    expect(waitingWord({ gender: null })).toBe("مستني");
    expect(waitingWord(undefined)).toBe("مستني");
  });
});

describe("computeAttentionItems", () => {
  const noDiagnosis = completed("09:00", "09:28");
  const withDiagnosis = completed("09:30", "09:50");
  const unpaid = completed("10:00", "10:15");
  const forms = new Map<string, VisitFormFieldValues>([
    [withDiagnosis.id, { complaint: "", diagnosis: "التهاب" }],
    [unpaid.id, { complaint: "", diagnosis: "نزلة برد" }],
  ]);

  it("lists empty diagnoses, then unpaid or partially paid invoices; void and paid are not owed", () => {
    const invoices = new Map<string, Invoice>([
      [noDiagnosis.id, makeInvoice({ visit_id: noDiagnosis.id, status: "paid" })],
      [withDiagnosis.id, makeInvoice({ visit_id: withDiagnosis.id, status: "partial" })],
      [unpaid.id, makeInvoice({ visit_id: unpaid.id, status: "unpaid" })],
    ]);
    const items = computeAttentionItems([unpaid, withDiagnosis, noDiagnosis], forms, invoices);
    expect(items).toEqual([
      { kind: "missing_diagnosis", visit: noDiagnosis },
      { kind: "unpaid_invoice", visit: withDiagnosis, invoiceStatus: "partial" },
      { kind: "unpaid_invoice", visit: unpaid, invoiceStatus: "unpaid" },
    ]);

    const voided = new Map<string, Invoice>([[unpaid.id, makeInvoice({ visit_id: unpaid.id, status: "void" })]]);
    expect(computeAttentionItems([unpaid], forms, voided)).toEqual([]);
  });

  it("ignores visits that are not completed", () => {
    const inRoom = makeVisit({ status: VisitStatus.InRoom });
    const invoices = new Map<string, Invoice>([[inRoom.id, makeInvoice({ visit_id: inRoom.id })]]);
    expect(computeAttentionItems([inRoom], NO_FORMS, invoices)).toEqual([]);
  });

  it("is empty when there is nothing to show", () => {
    expect(computeAttentionItems([], NO_FORMS, new Map())).toEqual([]);
  });

  it("flags a completed visit's missing diagnosis for the day list too", () => {
    expect(hasMissingDiagnosis(noDiagnosis, forms)).toBe(true);
    expect(hasMissingDiagnosis(withDiagnosis, forms)).toBe(false);
    expect(hasMissingDiagnosis(makeVisit({ status: VisitStatus.InRoom }), forms)).toBe(false);
  });
});

describe("computeDayList", () => {
  it("slots: occupying visits by time, overbooked ties by position; cancelled, no-show and rescheduled left out", () => {
    const nine = makeVisit({ scheduled_at: at("09:00"), position: 3, status: VisitStatus.Completed });
    const tenExtra = makeVisit({ scheduled_at: at("10:00"), position: 9, is_overbooked: true });
    const ten = makeVisit({ scheduled_at: at("10:00"), position: 2, status: VisitStatus.Arrived });
    const visits = [
      tenExtra,
      ten,
      makeVisit({ scheduled_at: at("09:30"), status: VisitStatus.Cancelled }),
      makeVisit({ scheduled_at: at("09:30"), status: VisitStatus.NoShow }),
      makeVisit({ scheduled_at: at("11:00"), status: VisitStatus.Rescheduled }),
      nine,
    ];
    expect(computeDayList(visits, false)).toEqual([nine, ten, tenExtra]);
  });

  it("queue: occupying visits by position", () => {
    const a = makeVisit({ position: 1, status: VisitStatus.Completed });
    const b = makeVisit({ position: 2, status: VisitStatus.InRoom });
    const c = makeVisit({ position: 3 });
    expect(computeDayList([c, makeVisit({ position: 4, status: VisitStatus.NoShow }), a, b], true)).toEqual([a, b, c]);
  });

  it("is empty for an empty day", () => {
    expect(computeDayList([], false)).toEqual([]);
  });
});

describe("computeAge", () => {
  it("is the current Cairo year minus birth_year, null when unknown", () => {
    expect(computeAge(1992, nowAt("10:00"))).toBe(34);
    expect(computeAge(null, nowAt("10:00"))).toBeNull();
  });

  it("uses the Cairo year, not UTC, on New Year's Eve night", () => {
    // 2026-12-31T22:30Z is already 2027-01-01 in Cairo.
    expect(computeAge(2000, new Date("2026-12-31T22:30:00Z"))).toBe(27);
  });
});

describe("counted phrases", () => {
  const phrase = (count: number, forms: Parameters<typeof arabicCount>[1]) => {
    const { numeral, words } = arabicCount(count, forms);
    return numeral === null ? words : `${numeral} ${words}`;
  };

  it.each([
    [1, "زيارة سابقة"],
    [2, "زيارتين سابقتين"],
    [3, "3 زيارات سابقة"],
    [10, "10 زيارات سابقة"],
    [11, "11 زيارة سابقة"],
  ])("prior visits: %i → %s", (count, expected) => {
    expect(phrase(count, PRIOR_VISIT_FORMS)).toBe(expected);
  });

  it.each([
    [1, "زيارة واحدة إجمالي عندك"],
    [2, "زيارتين إجمالي عندك"],
    [4, "4 زيارات إجمالي عندك"],
    [15, "15 زيارة إجمالي عندك"],
  ])("total visits: %i → %s", (count, expected) => {
    expect(phrase(count, TOTAL_VISITS_FORMS)).toBe(expected);
  });

  it.each([
    [1, "مريض واحد في الصالة"],
    [2, "مريضين في الصالة"],
    [3, "3 مرضى في الصالة"],
    [12, "12 مريض في الصالة"],
  ])("waiting room: %i → %s", (count, expected) => {
    expect(phrase(count, WAITING_COUNT_FORMS)).toBe(expected);
  });
});

describe("computeSinceLabel", () => {
  it("reads as just now under one minute, then as elapsed minutes", () => {
    expect(computeSinceLabel(at("10:00"), TODAY, new Date(new Date(at("10:00")).getTime() + 59_000))).toEqual({
      kind: "just_now",
    });
    expect(computeSinceLabel(at("10:00"), TODAY, nowAt("10:01"))).toEqual({ kind: "elapsed", label: "1د" });
    expect(computeSinceLabel(at("10:00"), TODAY, nowAt("10:12"))).toEqual({ kind: "elapsed", label: "12د" });
  });

  it("is null off the live day", () => {
    expect(computeSinceLabel(at("10:00"), TODAY, new Date(at("10:00", "2026-10-12")))).toBeNull();
  });
});

describe("formatRelativeVisitTime", () => {
  it.each([
    ["2026-10-08", "النهارده"],
    ["2026-10-07", "قبل يوم"],
    ["2026-10-06", "قبل يومين"],
    ["2026-10-05", "قبل 3 أيام"],
    ["2026-09-28", "قبل 10 أيام"],
    ["2026-09-27", "قبل 11 يوم"],
    ["2026-09-25", "قبل 13 يوم"],
    ["2026-09-24", "قبل أسبوعين"],
    ["2026-09-17", "قبل 3 أسابيع"],
    ["2026-08-10", "قبل 8 أسابيع"],
    ["2026-08-09", "من شهرين"],
    ["2026-07-08", "من 3 شهور"],
    ["2025-12-12", "من 10 شهور"],
    ["2025-11-01", "من 11 شهر"],
    ["2024-10-08", "من 24 شهر"],
  ])("%s → %s", (day, label) => {
    expect(formatRelativeVisitTime(day, TODAY)).toBe(label);
  });
});
