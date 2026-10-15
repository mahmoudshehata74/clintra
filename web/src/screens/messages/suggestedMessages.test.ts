import { describe, expect, it } from "vitest";
import { InvoiceStatus, type Invoice, type Message, type Patient, type Visit } from "../../db/types";
import type { Piastres } from "../../domain/money";
import { LocationScope } from "../../domain/scope";
import { cairoInstant, type ClinicDay } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import { suggestedMessages, weeksAgoPhrase, type SuggestionSources } from "./suggestedMessages";

// Thursday 2026-10-15, 08:30 in Cairo.
const TODAY: ClinicDay = "2026-10-15";
const NOW = new Date(cairoInstant(TODAY, "08:30"));
const TOMORROW: ClinicDay = "2026-10-16";
const TWO_DAYS_AGO: ClinicDay = "2026-10-13";

function patient(id: string, name: string, phone: string | null = "+201001234567"): Patient {
  return { id, org_id: "org-1", full_name: name, phone, gender: null, birth_year: null, note: null, created_at: NOW.toISOString(), rev: 1 };
}

function visit(id: string, patientId: string, day: ClinicDay, time: string | null, status: Visit["status"], overrides: Partial<Visit> = {}): Visit {
  const scheduledAt = time === null ? null : cairoInstant(day, time);
  return {
    id,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: patientId,
    service_id: null,
    care_plan_item_id: null,
    visit_date: day,
    position: 1,
    scheduled_at: scheduledAt,
    ...(scheduledAt ? { unique_scheduled_at: scheduledAt } : {}),
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: NOW.toISOString(),
    note: null,
    rev: 1,
    ...overrides,
  };
}

function invoice(id: string, patientId: string, visitId: string | null, issuedDay: ClinicDay, total: number, paid: number, status: Invoice["status"] = InvoiceStatus.Partial, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    org_id: "org-1",
    location_id: "location-1",
    number: 1,
    issued_year: 2026,
    series: 1,
    patient_id: patientId,
    practitioner_id: "practitioner-1",
    visit_id: visitId,
    total: total as Piastres,
    paid: paid as Piastres,
    status,
    issued_at: cairoInstant(issuedDay, "10:00"),
    rev: 1,
    ...overrides,
  } as Invoice;
}

function message(templateKey: string, patientId: string, visitId: string | null, attemptedDay: ClinicDay) {
  return { template_key: templateKey, patient_id: patientId, visit_id: visitId, attempted_at: cairoInstant(attemptedDay, "09:00") };
}

const PATIENTS = [patient("p-mona", "منى"), patient("p-karim", "كريم"), patient("p-yasmin", "ياسمين"), patient("p-omar", "عمر", null)];

function sources(overrides: Partial<SuggestionSources> = {}): SuggestionSources {
  return {
    visits: [],
    patients: PATIENTS,
    invoices: [],
    carePlanItems: [],
    messages: [],
    access: { membership: { org_id: "org-1", location_scope: LocationScope.All }, listedLocationIds: new Set() },
    now: NOW,
    ...overrides,
  };
}

const rowsOf = (input: SuggestionSources) =>
  suggestedMessages(input).map((row) => [row.templateKey, row.patientName, row.reason, row.hasPhone, row.visitId]);

describe("suggestedMessages", () => {
  it("lists one row of each kind, tomorrow first by time, then follow-ups, then balances", () => {
    const input = sources({
      visits: [
        visit("v-mona", "p-mona", TOMORROW, "10:30", VisitStatus.Booked),
        visit("v-karim", "p-karim", TOMORROW, "09:30", VisitStatus.Confirmed),
        visit("v-yasmin", "p-yasmin", TWO_DAYS_AGO, "11:00", VisitStatus.Completed),
        visit("v-omar", "p-omar", "2026-10-08", "12:00", VisitStatus.Completed),
      ],
      invoices: [invoice("i-omar", "p-omar", "v-omar", "2026-10-08", 300_00, 150_00)],
      carePlanItems: [{ visit_id: "v-karim" }],
    });
    expect(rowsOf(input)).toEqual([
      ["care_plan_session_reminder", "كريم", "جلسة خطة بكرة 9:30", true, "v-karim"],
      ["appointment_reminder", "منى", "موعد بكرة 10:30", true, "v-mona"],
      ["post_visit_followup", "ياسمين", "زيارة من يومين", true, "v-yasmin"],
      ["balance_reminder", "عمر", "عليه 150 ج.م من أسبوع", false, "v-omar"],
    ]);
  });

  it.each([
    ["booked tomorrow", VisitStatus.Booked, TOMORROW, true],
    ["confirmed tomorrow", VisitStatus.Confirmed, TOMORROW, true],
    ["arrived tomorrow (not a reminder any more)", VisitStatus.Arrived, TOMORROW, false],
    ["cancelled tomorrow", VisitStatus.Cancelled, TOMORROW, false],
    ["no-show tomorrow", VisitStatus.NoShow, TOMORROW, false],
    ["moved away tomorrow", VisitStatus.Rescheduled, TOMORROW, false],
    ["booked today", VisitStatus.Booked, TODAY, false],
    ["booked the day after tomorrow", VisitStatus.Booked, "2026-10-17", false],
  ])("appointment reminder: a visit %s → %s", (_label, status, day, listed) => {
    const rows = suggestedMessages(sources({ visits: [visit("v", "p-mona", day, "10:30", status)] }));
    expect(rows.some((row) => row.templateKey === "appointment_reminder")).toBe(listed);
  });

  it("reads a queue visit tomorrow without a time", () => {
    expect(rowsOf(sources({ visits: [visit("v", "p-mona", TOMORROW, null, VisitStatus.Booked)] }))).toEqual([
      ["appointment_reminder", "منى", "موعد بكرة", true, "v"],
    ]);
  });

  it.each([
    ["completed two days ago", VisitStatus.Completed, TWO_DAYS_AGO, true],
    ["completed yesterday", VisitStatus.Completed, "2026-10-14", false],
    ["completed three days ago", VisitStatus.Completed, "2026-10-12", false],
    ["a no-show two days ago", VisitStatus.NoShow, TWO_DAYS_AGO, false],
  ])("follow-up: a visit %s → %s", (_label, status, day, listed) => {
    const rows = suggestedMessages(sources({ visits: [visit("v", "p-mona", day, "10:30", status)] }));
    expect(rows.some((row) => row.templateKey === "post_visit_followup")).toBe(listed);
  });

  it.each([
    ["issued seven days ago, partly paid", "2026-10-08", 300_00, 150_00, InvoiceStatus.Partial, "عليه 150 ج.م من أسبوع"],
    ["issued six days ago", "2026-10-09", 300_00, 0, InvoiceStatus.Unpaid, null],
    ["issued fifteen days ago", "2026-09-30", 2_500_00, 0, InvoiceStatus.Unpaid, "عليه 2,500 ج.م من أسبوعين"],
    ["issued a month ago", "2026-09-15", 100_00, 0, InvoiceStatus.Unpaid, "عليه 100 ج.م من 4 أسابيع"],
    ["paid in full", "2026-10-01", 300_00, 300_00, InvoiceStatus.Paid, null],
    ["void", "2026-10-01", 300_00, 0, InvoiceStatus.Void, null],
  ])("balance: an invoice %s", (_label, issuedDay, total, paid, status, reason) => {
    const rows = suggestedMessages(sources({ invoices: [invoice("i", "p-mona", "v", issuedDay, total, paid, status)] }));
    expect(rows.find((row) => row.templateKey === "balance_reminder")?.reason ?? null).toBe(reason);
  });

  it("gives a patient one balance row, on the oldest invoice they still owe on", () => {
    const rows = suggestedMessages(
      sources({
        invoices: [
          invoice("i-new", "p-mona", "v-new", "2026-10-07", 200_00, 0, InvoiceStatus.Unpaid),
          invoice("i-old", "p-mona", "v-old", "2026-09-20", 80_00, 0, InvoiceStatus.Unpaid),
          invoice("i-karim", "p-karim", "v-karim", "2026-10-01", 50_00, 0, InvoiceStatus.Unpaid),
        ],
      }),
    );
    expect(rows.map((row) => [row.patientName, row.visitId, row.reason])).toEqual([
      ["كريم", "v-karim", "عليه 50 ج.م من أسبوعين"],
      ["منى", "v-old", "عليه 80 ج.م من 3 أسابيع"],
    ]);
  });

  it("drops a visit's row once its template was opened for that visit, and a balance row for a week after one was opened for the patient", () => {
    const visits = [
      visit("v-mona", "p-mona", TOMORROW, "10:30", VisitStatus.Booked),
      visit("v-karim", "p-karim", TOMORROW, "09:30", VisitStatus.Booked),
      visit("v-yasmin", "p-yasmin", TWO_DAYS_AGO, "11:00", VisitStatus.Completed),
    ];
    const invoices = [invoice("i-omar", "p-omar", "v-omar", "2026-10-01", 300_00, 0, InvoiceStatus.Unpaid)];
    const carePlanItems = [{ visit_id: "v-karim" }];

    const listed = (messages: Pick<Message, "patient_id" | "visit_id" | "template_key" | "attempted_at">[]) =>
      suggestedMessages(sources({ visits, invoices, carePlanItems, messages })).map((row) => row.patientName);

    expect(listed([])).toEqual(["كريم", "منى", "ياسمين", "عمر"]);
    // Another template for the visit does not count; the session's appointment reminder does not either.
    expect(listed([message("booking_confirmation", "p-mona", "v-mona", TODAY), message("appointment_reminder", "p-karim", "v-karim", TODAY)])).toEqual([
      "كريم",
      "منى",
      "ياسمين",
      "عمر",
    ]);
    expect(
      listed([
        message("appointment_reminder", "p-mona", "v-mona", TODAY),
        message("care_plan_session_reminder", "p-karim", "v-karim", TODAY),
        message("post_visit_followup", "p-yasmin", "v-yasmin", TODAY),
      ]),
    ).toEqual(["عمر"]);
    // A balance reminder six days ago still counts; seven days ago no longer does.
    expect(listed([message("balance_reminder", "p-omar", null, "2026-10-09")])).not.toContain("عمر");
    expect(listed([message("balance_reminder", "p-omar", null, "2026-10-08")])).toContain("عمر");
  });

  it("lists a patient with no usable number, without a phone", () => {
    const rows = suggestedMessages(
      sources({
        patients: [patient("p-a", "أ", null), patient("p-b", "ب", "123")],
        visits: [visit("v-a", "p-a", TOMORROW, "10:00", VisitStatus.Booked), visit("v-b", "p-b", TOMORROW, "11:00", VisitStatus.Booked)],
      }),
    );
    expect(rows.map((row) => row.hasPhone)).toEqual([false, false]);
  });

  it("counts only what the membership may see: its organization, and its listed locations", () => {
    const visits = [
      visit("v-here", "p-mona", TOMORROW, "10:00", VisitStatus.Booked),
      visit("v-there", "p-karim", TOMORROW, "11:00", VisitStatus.Booked, { location_id: "location-2" }),
      visit("v-other-org", "p-yasmin", TOMORROW, "12:00", VisitStatus.Booked, { org_id: "org-2" }),
    ];
    const listed = suggestedMessages(
      sources({
        visits,
        access: { membership: { org_id: "org-1", location_scope: LocationScope.Listed }, listedLocationIds: new Set(["location-1"]) },
      }),
    );
    expect(listed.map((row) => row.visitId)).toEqual(["v-here"]);
  });

  it("is empty when nothing is due", () => {
    expect(suggestedMessages(sources())).toEqual([]);
  });
});

describe("weeksAgoPhrase", () => {
  it.each([
    [7, "من أسبوع"],
    [13, "من أسبوع"],
    [14, "من أسبوعين"],
    [21, "من 3 أسابيع"],
    [70, "من 10 أسابيع"],
    [77, "من 11 أسبوع"],
  ])("%d days → %s", (days, phrase) => {
    expect(weeksAgoPhrase(days)).toBe(phrase);
  });
});
