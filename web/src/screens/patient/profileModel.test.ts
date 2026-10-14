import { describe, expect, it } from "vitest";
import {
  CarePlanItemStatus,
  CarePlanStatus,
  InvoiceStatus,
  MessageChannel,
  PaymentMethod,
  type CarePlan,
  type CarePlanItem,
  type Invoice,
  type Message,
  type Patient,
  type Payment,
  type Prescription,
  type PrescriptionItem,
  type Visit,
} from "../../db/types";
import type { VisitFormFieldValues } from "../../db/visitForm";
import type { Piastres } from "../../domain/money";
import { cairoInstant, type ClinicDay, type ClockTime } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import {
  buildProfileEvents,
  buildProfileHero,
  filterProfileEvents,
  groupProfileEvents,
  lastVisitLine,
  pageProfileEvents,
  patientBalance,
  planStartDays,
  profileDayHeading,
  profileTabCounts,
  PROFILE_PAGE_SIZE,
  type DetailPart,
  type PatientProfileSource,
  type ProfileEvent,
} from "./profileModel";

const TODAY: ClinicDay = "2026-10-14";
const NOW = new Date(cairoInstant(TODAY, "17:00"));
const DOCTOR = "practitioner-1";
const at = (day: ClinicDay, time: ClockTime) => cairoInstant(day, time);

const karim: Patient = {
  id: "patient-1",
  org_id: "org",
  full_name: "كريم فتحي",
  phone: "+201112345678",
  gender: "male",
  birth_year: 1992,
  note: null,
  created_at: at("2026-09-01", "09:00"),
  rev: 1,
};

function visit(id: string, status: VisitStatus, day: ClinicDay, time: ClockTime, overrides: Partial<Visit> = {}): Visit {
  return {
    id,
    org_id: "org",
    location_id: "loc",
    practitioner_id: DOCTOR,
    patient_id: karim.id,
    service_id: "review",
    care_plan_item_id: null,
    visit_date: day,
    position: 1,
    scheduled_at: at(day, time),
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-assistant",
    created_at: at(day, "08:00"),
    note: null,
    rev: 1,
    ...overrides,
  };
}

const plan: CarePlan = {
  id: "plan-1",
  org_id: "org",
  location_id: "loc",
  template_id: "tpl",
  patient_id: karim.id,
  practitioner_id: DOCTOR,
  goal: "استعادة الحركة",
  diagnosis: "التهاب وتر الرضفة",
  planned_count: 4,
  total_price: 100000 as Piastres,
  paid: 0 as Piastres,
  status: CarePlanStatus.Active,
  started_at: at("2026-09-09", "08:30"),
  expected_end: at("2026-09-09", "08:30"),
  rev: 1,
};

function planItem(sequence: number, overrides: Partial<CarePlanItem> = {}): CarePlanItem {
  return {
    id: `item-${sequence}`,
    care_plan_id: plan.id,
    service_id: sequence === 1 ? "review" : "physio",
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

function invoice(id: string, total: number, paid: number, status: InvoiceStatus, visitId: string | null, number: number): Invoice {
  return {
    id,
    org_id: "org",
    location_id: "loc",
    number,
    issued_year: 2026,
    series: 1,
    patient_id: karim.id,
    practitioner_id: DOCTOR,
    visit_id: visitId,
    total: total as Piastres,
    paid: paid as Piastres,
    status,
    issued_at: at("2026-09-09", "09:30"),
    rev: 1,
  };
}

function payment(id: string, invoiceId: string, amount: number, method: PaymentMethod, createdAt: string): Payment {
  return {
    id,
    invoice_id: invoiceId,
    location_id: "loc",
    amount: amount as Piastres,
    method,
    receipt_number: "1",
    series: 1,
    note: null,
    after_close: false,
    created_by: "membership-assistant",
    created_at: createdAt,
    rev: 1,
  };
}

const prescription: Prescription = {
  id: "rx-1",
  org_id: "org",
  location_id: "loc",
  visit_id: "v-session",
  patient_id: karim.id,
  practitioner_id: DOCTOR,
  series: 1,
  issued_year: 2026,
  number: 1,
  diagnosis: null,
  printed_at: at("2026-09-09", "09:25"),
  created_by: "membership-doctor",
  created_at: at("2026-09-09", "09:20"),
  rev: 1,
};

function drug(position: number, name: string): PrescriptionItem {
  return {
    id: `drug-${position}`,
    prescription_id: prescription.id,
    name,
    form: null,
    instructions: "قرص بعد الأكل",
    duration: null,
    note: null,
    position,
    rev: 1,
  };
}

const message: Message = {
  id: "msg-1",
  org_id: "org",
  location_id: "loc",
  patient_id: karim.id,
  visit_id: "v-today",
  template_key: "care_plan_session_reminder",
  channel: MessageChannel.WhatsApp,
  phone: karim.phone!,
  body: "مرحباً كريم،\nميعاد جلستك الجاية",
  attempted_at: at(TODAY, "16:35"),
  marked_sent_at: null,
  created_by: "membership-assistant",
  created_at: at(TODAY, "16:35"),
  rev: 1,
};

function values(complaint: string, diagnosis: string): VisitFormFieldValues {
  return { complaint, diagnosis };
}

/**
 * كريم: a plan session on 9 / 9 (with a printed two-drug prescription, a
 * note and a paid invoice), a cancelled visit on 30 / 9, a no-show on
 * 1 / 10, a visit today (partly paid, a message after it) and one booked
 * next week, which the timeline leaves out.
 */
function source(overrides: Partial<PatientProfileSource> = {}): PatientProfileSource {
  return {
    patient: karim,
    visits: [
      visit("v-session", VisitStatus.Completed, "2026-09-09", "09:00", {
        started_at: at("2026-09-09", "09:05"),
        note: "تحسن ملحوظ",
      }),
      visit("v-cancelled", VisitStatus.Cancelled, "2026-09-30", "10:00"),
      visit("v-noshow", VisitStatus.NoShow, "2026-10-01", "11:00"),
      visit("v-today", VisitStatus.Completed, TODAY, "16:00", { started_at: at(TODAY, "16:15"), service_id: "physio" }),
      visit("v-next", VisitStatus.Booked, "2026-10-21", "16:00"),
    ],
    formValuesByVisitId: new Map([
      ["v-session", values("ألم في الركبة اليمنى", "التهاب وتر الرضفة")],
      ["v-today", values("", "خشونة بسيطة")],
    ]),
    practitioners: [{ id: DOCTOR, full_name: "أحمد المصري" }],
    services: [
      { id: "review", name: "تقييم" },
      { id: "physio", name: "علاج طبيعي" },
    ],
    plans: [plan],
    planItems: [planItem(1, { visit_id: "v-session" }), planItem(2), planItem(3), planItem(4, { status: CarePlanItemStatus.Skipped })],
    prescriptions: [prescription],
    prescriptionItems: [drug(2, "Paracetamol"), drug(1, "Diclofenac")],
    messages: [message],
    invoices: [
      invoice("inv-session", 25000, 25000, InvoiceStatus.Paid, "v-session", 7),
      invoice("inv-today", 40000, 15000, InvoiceStatus.Partial, "v-today", 128),
      invoice("inv-void", 99900, 0, InvoiceStatus.Void, null, 9),
    ],
    payments: [
      payment("pay-session", "inv-session", 25000, PaymentMethod.Cash, at("2026-09-09", "09:40")),
      payment("pay-today", "inv-today", 15000, PaymentMethod.Card, at(TODAY, "16:40")),
    ],
    staffNames: new Map([["membership-assistant", "سارة حسن"]]),
    ...overrides,
  };
}

/** `.d` as it reads: groups joined by " · ". */
const detailText = (event: ProfileEvent) =>
  event.details.map((group: DetailPart[]) => group.map((part) => part.text).join("")).join(" · ");

const byKey = (events: readonly ProfileEvent[], key: string) => events.find((event) => event.key === key)!;

describe("buildProfileHero", () => {
  it("reads the name, age and gender, local phone and first completed visit", () => {
    const hero = buildProfileHero(source(), NOW);
    expect(hero).toMatchObject({
      initial: "ك",
      name: "كريم فتحي",
      ageLine: "34 سنة · ذكر",
      phone: "011 1234 5678",
      firstVisit: "9 / 9 / 2026",
    });
  });

  it("omits each part of the age line when unknown, and the line when both are", () => {
    expect(buildProfileHero(source({ patient: { ...karim, birth_year: null } }), NOW).ageLine).toBe("ذكر");
    expect(buildProfileHero(source({ patient: { ...karim, gender: "female", birth_year: null } }), NOW).ageLine).toBe("أنثى");
    expect(buildProfileHero(source({ patient: { ...karim, gender: null } }), NOW).ageLine).toBe("34 سنة");
    expect(buildProfileHero(source({ patient: { ...karim, gender: "other", birth_year: null } }), NOW).ageLine).toBeNull();
  });

  it("has no phone or first visit without them", () => {
    const hero = buildProfileHero(source({ patient: { ...karim, phone: null }, visits: [] }), NOW);
    expect(hero.phone).toBeNull();
    expect(hero.firstVisit).toBeNull();
    expect(hero.visitCount).toBe(0);
  });

  it("counts completed visits only", () => {
    expect(buildProfileHero(source(), NOW).visitCount).toBe(2);
  });

  it("owes the unpaid part of every invoice not voided", () => {
    expect(buildProfileHero(source(), NOW).balance).toBe("250");
    expect(buildProfileHero(source({ invoices: [] }), NOW).balance).toBe("0");
    expect(
      patientBalance([
        { status: InvoiceStatus.Unpaid, total: 125000 as Piastres, paid: 0 as Piastres },
        { status: InvoiceStatus.Paid, total: 5000 as Piastres, paid: 5000 as Piastres },
        { status: InvoiceStatus.Void, total: 9000 as Piastres, paid: 0 as Piastres },
      ]),
    ).toBe(125000);
  });

  it("shows the most recent plan's state: under way, stopped or completed", () => {
    expect(buildProfileHero(source(), NOW).plan).toEqual({ planId: "plan-1", label: "جارية" });
    expect(buildProfileHero(source({ plans: [{ ...plan, status: CarePlanStatus.Stopped }] }), NOW).plan?.label).toBe("متوقفة");
    const allDone = source({
      planItems: [planItem(1, { visit_id: "v-session" }), planItem(2, { status: CarePlanItemStatus.Skipped })],
    });
    expect(buildProfileHero(allDone, NOW).plan?.label).toBe("اكتملت");
    expect(buildProfileHero(source({ plans: [] }), NOW).plan).toBeNull();
  });

  it("picks the plan that started last", () => {
    const older = { ...plan, id: "plan-0", status: CarePlanStatus.Stopped, started_at: at("2026-01-01", "09:00") };
    expect(buildProfileHero(source({ plans: [older, plan] }), NOW).plan?.planId).toBe("plan-1");
  });

  it("warns when the plan under way is stalled", () => {
    // Session 2 was due 16 / 9 (session 1 + 7 days) and nothing is booked: 28 days.
    expect(buildProfileHero(source(), NOW).stalledLine).toBe("المريض متوقف من 28 يوم");
    expect(buildProfileHero(source({ plans: [{ ...plan, status: CarePlanStatus.Stopped }] }), NOW).stalledLine).toBeNull();
    const booked = source({
      planItems: [planItem(1, { visit_id: "v-session" }), planItem(2, { visit_id: "v-next" }), planItem(3)],
    });
    expect(buildProfileHero(booked, NOW).stalledLine).toBeNull();
  });
});

describe("buildProfileEvents", () => {
  const events = buildProfileEvents(source());

  it("lists history newest first, leaving out what is still to come", () => {
    expect(events.map((event) => event.key)).toEqual([
      "pay:pay-today",
      "msg:msg-1",
      "visit:v-today",
      "visit:v-noshow",
      "visit:v-cancelled",
      "pay:pay-session",
      "rx:rx-1",
      "visit:v-session",
      "note:v-session",
    ]);
  });

  it("titles a visit by its diagnosis, and details the doctor, diagnosis, complaint and drugs", () => {
    const today = byKey(events, "visit:v-today");
    expect(today).toMatchObject({ kind: "visit", day: TODAY, time: "16:15", title: "زيارة — خشونة بسيطة", muted: false });
    expect(today.target).toEqual({ kind: "visit", visitId: "v-today" });
    expect(detailText(today)).toBe("د. أحمد المصري · خشونة بسيطة");
    expect(today.details[0][0].tone).toBe("strong");
    expect(today.details[1][0].tone).toBe("dx");
  });

  it("titles a plan session by its service and place", () => {
    const session = byKey(events, "visit:v-session");
    expect(session.title).toBe("جلسة تقييم · 1 من 3");
    expect(detailText(session)).toBe("د. أحمد المصري · التهاب وتر الرضفة · شكوى: ألم في الركبة اليمنى · وصف دوائين");
  });

  it("falls back to زيارة without a diagnosis", () => {
    const bare = buildProfileEvents(source({ formValuesByVisitId: new Map() }));
    expect(byKey(bare, "visit:v-today").title).toBe("زيارة");
  });

  it("shows a cancelled visit and a no-show muted, at their booked time", () => {
    expect(byKey(events, "visit:v-cancelled")).toMatchObject({ title: "زيارة اتلغت", muted: true, time: "10:00" });
    expect(byKey(events, "visit:v-noshow")).toMatchObject({ title: "ما حضرش", muted: true, time: "11:00" });
  });

  it("names a prescription's drugs in order and whether it was printed", () => {
    const rx = byKey(events, "rx:rx-1");
    expect(rx).toMatchObject({ kind: "rx", day: "2026-09-09", time: "9:20", title: "وصفة طبية · دوائين" });
    expect(detailText(rx)).toBe("Diclofenac، Paracetamol · اتطبعت");
    expect(rx.details[0].filter((part) => part.tone === "strong").every((part) => part.ltr)).toBe(true);
    expect(rx.target).toEqual({ kind: "rx", prescriptionId: "rx-1" });
    const draft = buildProfileEvents(source({ prescriptions: [{ ...prescription, printed_at: null }] }));
    expect(detailText(byKey(draft, "rx:rx-1"))).toBe("Diclofenac، Paracetamol · لسه ما اتطبعتش");
  });

  it("leaves out a prescription with no drug left", () => {
    expect(buildProfileEvents(source({ prescriptionItems: [] })).some((event) => event.kind === "rx")).toBe(false);
  });

  it("titles a message by its template and channel, with its first line and state", () => {
    const msg = byKey(events, "msg:msg-1");
    expect(msg).toMatchObject({ title: "تذكير جلسة خطة · واتساب", time: "16:35", target: null });
    expect(detailText(msg)).toBe("مرحباً كريم، · اتفتحت");
    const sms = buildProfileEvents(
      source({ messages: [{ ...message, channel: MessageChannel.Sms, marked_sent_at: at(TODAY, "16:50") }] }),
    );
    expect(byKey(sms, "msg:msg-1").title).toBe("تذكير جلسة خطة · SMS");
    expect(detailText(byKey(sms, "msg:msg-1"))).toBe("مرحباً كريم، · اتبعتت");
  });

  it("titles a payment by its amount and method, with the invoice number and who took it", () => {
    const pay = byKey(events, "pay:pay-today");
    expect(pay).toMatchObject({ title: "دفعة · 150 ج.م فيزا", time: "16:40" });
    expect(detailText(pay)).toBe("فاتورة INV-2026-0128 · سارة حسن");
    expect(pay.details[1][0].tone).toBe("strong");
    expect(pay.target).toEqual({ kind: "invoice", invoiceId: "inv-today" });
    expect(byKey(events, "pay:pay-session").title).toBe("دفعة · 250 ج.م كاش");
  });

  it("adds the doctor's note after its visit, at the visit's time", () => {
    const note = byKey(events, "note:v-session");
    expect(note).toMatchObject({ kind: "note", title: "ملاحظة الطبيب", time: "9:05", target: null });
    expect(detailText(note)).toBe("تحسن ملحوظ");
  });
});

describe("tabs", () => {
  const events = buildProfileEvents(source());

  it("counts every tab", () => {
    expect(profileTabCounts(events)).toEqual({ all: 9, visits: 4, rx: 1, messages: 1, payments: 2, notes: 1 });
  });

  it("filters each tab to its kind, and shows notes only under الكل and ملاحظات", () => {
    expect(filterProfileEvents(events, "visits").every((event) => event.kind === "visit")).toBe(true);
    expect(filterProfileEvents(events, "payments").map((event) => event.key)).toEqual(["pay:pay-today", "pay:pay-session"]);
    expect(filterProfileEvents(events, "notes").map((event) => event.key)).toEqual(["note:v-session"]);
    expect(filterProfileEvents(events, "all")).toHaveLength(9);
  });
});

describe("day groups", () => {
  const startDays = planStartDays([plan]);

  it("heads today with its full date, and earlier days with how long ago", () => {
    expect(profileDayHeading(TODAY, TODAY, new Set())).toBe("النهارده · 14 أكتوبر 2026");
    expect(profileDayHeading("2026-10-01", TODAY, new Set())).toBe("1 أكتوبر · قبل 13 يوم");
    expect(profileDayHeading("2026-10-13", TODAY, new Set())).toBe("13 أكتوبر · قبل يوم");
    expect(profileDayHeading("2026-09-30", TODAY, new Set())).toBe("30 سبتمبر · قبل أسبوعين");
  });

  it("marks the day a plan started", () => {
    expect(startDays).toEqual(new Set(["2026-09-09"]));
    expect(profileDayHeading("2026-09-09", TODAY, startDays)).toBe("9 سبتمبر · قبل 5 أسابيع · بداية خطة الرعاية");
  });

  it("groups events by day in order", () => {
    const days = groupProfileEvents(buildProfileEvents(source()), TODAY, startDays);
    expect(days.map((day) => [day.day, day.events.length])).toEqual([
      [TODAY, 3],
      ["2026-10-01", 1],
      ["2026-09-30", 1],
      ["2026-09-09", 4],
    ]);
    expect(days[0].heading).toBe("النهارده · 14 أكتوبر 2026");
  });
});

describe("paging", () => {
  const many = Array.from({ length: 230 }, (_, index) => ({ key: `e${index}` }) as ProfileEvent);

  it("shows the newest page, then 100 more per page, until nothing is older", () => {
    expect(PROFILE_PAGE_SIZE).toBe(100);
    expect(pageProfileEvents(many, 1)).toMatchObject({ hasOlder: true });
    expect(pageProfileEvents(many, 1).events).toHaveLength(100);
    expect(pageProfileEvents(many, 2).events).toHaveLength(200);
    expect(pageProfileEvents(many, 3)).toMatchObject({ hasOlder: false });
    expect(pageProfileEvents(many, 3).events).toHaveLength(230);
    expect(pageProfileEvents(many.slice(0, 100), 1).hasOlder).toBe(false);
  });
});

describe("lastVisitLine", () => {
  it("reads the last visit's date, or that there is none", () => {
    expect(lastVisitLine("2026-09-09")).toEqual({ label: "آخر زيارة", date: "9 / 9 / 2026" });
    expect(lastVisitLine(null)).toEqual({ label: "مفيش زيارات", date: null });
  });
});
