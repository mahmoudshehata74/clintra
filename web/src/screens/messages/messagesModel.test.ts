import { describe, expect, it } from "vitest";
import { InvoiceStatus, MessageChannel, type Message, type PrescriptionItem } from "../../db/types";
import { findMessageTemplate, MESSAGE_TEMPLATES, renderTemplate } from "../../domain/messageTemplates";
import type { Piastres } from "../../domain/money";
import { LocationScope } from "../../domain/scope";
import {
  initialMessageText,
  isMessageVisible,
  messageRecipientLine,
  messageSnippet,
  missingValuesWarning,
  placeholderToken,
  prescriptionMessageText,
  recentMessages,
  segmentTemplateBody,
  templateBadgeTone,
  templateChipLabel,
  templateIcon,
  templateValuesForVisit,
} from "./messagesModel";

describe("segmentTemplateBody", () => {
  it("cuts a body into text runs and one labelled chip per known placeholder", () => {
    expect(segmentTemplateBody("مرحباً {{patient_name}}،\nفي {{clinic_name}} الساعة {{time}}")).toEqual([
      { kind: "text", text: "مرحباً " },
      { kind: "var", placeholder: "patient_name", label: "اسم المريض" },
      { kind: "text", text: "،\nفي " },
      { kind: "var", placeholder: "clinic_name", label: "اسم العيادة" },
      { kind: "text", text: " الساعة " },
      { kind: "var", placeholder: "time", label: "الوقت" },
    ]);
  });

  it("labels all eight placeholders in Arabic", () => {
    const body = ["patient_name", "clinic_name", "clinic_phone", "date", "time", "doctor_name", "session_label", "balance"]
      .map((name) => `{{${name}}}`)
      .join(" ");
    expect(segmentTemplateBody(body).filter((segment) => segment.kind === "var").map((segment) => segment.kind === "var" && segment.label)).toEqual([
      "اسم المريض",
      "اسم العيادة",
      "هاتف العيادة",
      "التاريخ",
      "الوقت",
      "اسم الطبيب",
      "الجلسة",
      "المبلغ المتبقي",
    ]);
  });

  it("keeps an unknown token as text, merged with its neighbours, and never yields an empty run", () => {
    expect(segmentTemplateBody("أهلاً {{nickname}} و{{patient_name}}")).toEqual([
      { kind: "text", text: "أهلاً {{nickname}} و" },
      { kind: "var", placeholder: "patient_name", label: "اسم المريض" },
    ]);
    expect(segmentTemplateBody("{{date}}{{time}}")).toEqual([
      { kind: "var", placeholder: "date", label: "التاريخ" },
      { kind: "var", placeholder: "time", label: "الوقت" },
    ]);
    expect(segmentTemplateBody("")).toEqual([]);
  });

  it("round-trips with the insert chip's token", () => {
    expect(segmentTemplateBody(placeholderToken("balance"))).toEqual([{ kind: "var", placeholder: "balance", label: "المبلغ المتبقي" }]);
  });
});

describe("the template list", () => {
  it("gives every template its prototype glyph and badge tone, in the defined order", () => {
    expect(MESSAGE_TEMPLATES.map((template) => [templateIcon(template.key), templateBadgeTone(template)])).toEqual([
      ["✓", "copper"],
      ["⏰", "copper"],
      ["♥", "eligible"],
      ["◔", "copper"],
      ["₤", "eligible"],
      ["✎", "neutral"],
    ]);
  });

  it("reads معدّل with an override, قابل للتعديل for the owner otherwise, and nothing for others or custom", () => {
    const editable = findMessageTemplate("booking_confirmation")!;
    const custom = findMessageTemplate("custom")!;
    expect(templateChipLabel(editable, true, false)).toBe("معدّل");
    expect(templateChipLabel(editable, true, true)).toBe("معدّل");
    expect(templateChipLabel(editable, false, true)).toBe("قابل للتعديل");
    expect(templateChipLabel(editable, false, false)).toBeNull();
    expect(templateChipLabel(custom, false, true)).toBeNull();
  });
});

describe("templateValuesForVisit", () => {
  const base = {
    visit: { visit_date: "2026-10-12", scheduled_at: "2026-10-12T07:30:00.000Z" },
    patient: { full_name: "كريم فتحي" },
    practitioner: { full_name: "أحمد المصري" },
    organization: { name: "عيادة النور" },
    location: { phone: "+20221234567" },
    invoice: { total: 30000 as Piastres, paid: 10000 as Piastres, status: InvoiceStatus.Partial },
  };

  it("fills every value the visit has, the time in Cairo and the balance as total less paid", () => {
    expect(templateValuesForVisit(base)).toEqual({
      patient_name: "كريم فتحي",
      clinic_name: "عيادة النور",
      clinic_phone: "+20221234567",
      date: "2026-10-12",
      time: "10:30",
      doctor_name: "أحمد المصري",
      session_label: null,
      balance: 20000,
    });
  });

  it("leaves the balance missing when paid in full, void or not invoiced, and the time missing in the queue", () => {
    expect(templateValuesForVisit({ ...base, invoice: { ...base.invoice, paid: 30000 as Piastres, status: InvoiceStatus.Paid } }).balance).toBeNull();
    expect(templateValuesForVisit({ ...base, invoice: { ...base.invoice, status: InvoiceStatus.Void } }).balance).toBeNull();
    expect(templateValuesForVisit({ ...base, invoice: undefined }).balance).toBeNull();
    expect(templateValuesForVisit({ ...base, visit: { visit_date: "2026-10-12", scheduled_at: null } }).time).toBeNull();
  });

  it("renders a template with them, reporting only what is missing", () => {
    const values = templateValuesForVisit({ ...base, practitioner: undefined });
    const text = initialMessageText("booking_confirmation", findMessageTemplate("booking_confirmation")!.defaultBody, values);
    expect(text).toContain("مرحباً كريم فتحي،");
    expect(text).toContain("اتصل: 02 2123 4567");
    expect(text).toContain("[اسم الطبيب]");
    expect(text).not.toContain("{{");
    expect(missingValuesWarning(text)).toBe("فيه بيانات ناقصة: اسم الطبيب — كمّلها في النص بدل [اسم الطبيب] قبل الإرسال");
    expect(missingValuesWarning(renderTemplate("{{session_label}} {{time}}", {}).text)).toBe(
      "فيه بيانات ناقصة: الجلسة، الوقت — كمّلها في النص بدل [الجلسة]، [الوقت] قبل الإرسال",
    );
    expect(missingValuesWarning("مفيش حاجة ناقصة")).toBeNull();
    expect(initialMessageText("custom", "", values)).toBe("");
  });

  it("warns in the order the markers appear, and drops a marker once it is filled in", () => {
    expect(missingValuesWarning("[الوقت] ثم [الجلسة] و[الوقت]")).toBe(
      "فيه بيانات ناقصة: الوقت، الجلسة — كمّلها في النص بدل [الوقت]، [الجلسة] قبل الإرسال",
    );
    expect(missingValuesWarning("الجلسة 2 · [الوقت]")).toBe("فيه بيانات ناقصة: الوقت — كمّلها في النص بدل [الوقت] قبل الإرسال");
    expect(missingValuesWarning("الجلسة 2 · 10:30")).toBeNull();
  });
});

describe("prescriptionMessageText", () => {
  const item = (overrides: Partial<PrescriptionItem>): PrescriptionItem => ({
    id: "item",
    prescription_id: "rx-1",
    name: "Augmentin 1g",
    form: "Tablet",
    instructions: "قرص كل 12 ساعة",
    duration: "7 أيام",
    note: null,
    position: 1,
    rev: 1,
    ...overrides,
  });

  it("lists the number, the patient, each drug in position order with its note, then the doctor", () => {
    expect(
      prescriptionMessageText({
        prescription: { number: 12, issued_year: 2026, series: 2 },
        items: [
          item({ id: "b", name: "Panadol 500mg", form: null, instructions: "قرص عند الحاجة", duration: null, position: 2, note: "مش أكتر من 4 في اليوم" }),
          item({ id: "a" }),
        ],
        patientName: "كريم فتحي",
        doctorName: "أحمد المصري",
      }),
    ).toBe(
      [
        "الوصفة RX-2026-B-0012",
        "المريض: كريم فتحي",
        "1. Augmentin 1g — Tablet: قرص كل 12 ساعة · 7 أيام",
        "2. Panadol 500mg: قرص عند الحاجة",
        "   مش أكتر من 4 في اليوم",
        "د. أحمد المصري",
      ].join("\n"),
    );
  });
});

describe("the recent messages list", () => {
  const message = (overrides: Partial<Message>): Message => ({
    id: "m",
    org_id: "org-1",
    location_id: "loc-1",
    patient_id: "p",
    visit_id: null,
    template_key: "custom",
    channel: MessageChannel.WhatsApp,
    phone: "+201001234567",
    body: "نص",
    attempted_at: "2026-10-12T08:00:00.000Z",
    marked_sent_at: null,
    created_by: "membership-1",
    created_at: "2026-10-12T08:00:00.000Z",
    rev: 1,
    ...overrides,
  });

  it("snips the first line to 60 characters with an ellipsis", () => {
    expect(messageSnippet("مرحباً كريم،\nاتأكد حجزك")).toBe("مرحباً كريم،");
    const long = "ا".repeat(61);
    expect(messageSnippet(long)).toBe(`${"ا".repeat(60)}…`);
    expect(messageSnippet("ا".repeat(60))).toBe("ا".repeat(60));
    // Characters, not UTF-16 units: an emoji counts once.
    expect(messageSnippet(`${"📅".repeat(60)}x`)).toBe(`${"📅".repeat(60)}…`);
  });

  it("names the recipient with the number in its local display form", () => {
    expect(messageRecipientLine("كريم فتحي", "+201001234567")).toBe("كريم فتحي · 010 0123 4567");
    expect(messageRecipientLine(undefined, "+201001234567")).toBe("010 0123 4567");
  });

  it("shows the membership's organization and locations only, newest first, at most 20", () => {
    const all = { membership: { org_id: "org-1", location_scope: LocationScope.All }, listedLocationIds: new Set<string>() };
    const listed = { membership: { org_id: "org-1", location_scope: LocationScope.Listed }, listedLocationIds: new Set(["loc-1"]) };
    expect(isMessageVisible(message({ org_id: "org-2" }), all)).toBe(false);
    expect(isMessageVisible(message({ location_id: "loc-2" }), all)).toBe(true);
    expect(isMessageVisible(message({ location_id: "loc-2" }), listed)).toBe(false);
    expect(isMessageVisible(message({ location_id: "loc-1" }), listed)).toBe(true);

    const many = Array.from({ length: 25 }, (_, index) =>
      message({ id: `m-${String(index).padStart(2, "0")}`, attempted_at: `2026-10-12T08:${String(index).padStart(2, "0")}:00.000Z` }),
    );
    const hidden = message({ id: "hidden", location_id: "loc-2", attempted_at: "2026-10-13T00:00:00.000Z" });
    const recent = recentMessages([...many, hidden], listed);
    expect(recent).toHaveLength(20);
    expect(recent[0].id).toBe("m-24");
    expect(recent[19].id).toBe("m-05");
  });
});
