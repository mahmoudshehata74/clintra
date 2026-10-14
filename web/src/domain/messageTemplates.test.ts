import { describe, expect, it } from "vitest";
import type { Piastres } from "./money";
import {
  effectiveBody,
  isEditableTemplateKey,
  isMessageTemplateKey,
  MESSAGE_TEMPLATES,
  missingValueMarker,
  PLACEHOLDER_LABELS,
  renderTemplate,
  templateBodyLength,
  TemplatePlaceholder,
  type TemplateValues,
} from "./messageTemplates";

const ALL_VALUES: TemplateValues = {
  patient_name: "كريم فتحي",
  clinic_name: "عيادة د. أحمد المصري",
  clinic_phone: "+20221234567",
  date: "2026-10-18",
  time: "10:30",
  doctor_name: "د. أحمد المصري",
  session_label: "الجلسة 3",
  balance: 25050 as Piastres,
};

describe("the template definitions", () => {
  it("are the six keys, in display order, with their names, descriptions and kinds", () => {
    expect(MESSAGE_TEMPLATES.map((t) => [t.key, t.name, t.description, t.kind, t.editable])).toEqual([
      ["booking_confirmation", "تأكيد الحجز", "بعد الحجز", "مقترح", true],
      ["appointment_reminder", "تذكير بالموعد", "قبل الموعد بيوم", "مقترح", true],
      ["post_visit_followup", "متابعة بعد الزيارة", "بعد الزيارة بيومين", "اختياري", true],
      ["care_plan_session_reminder", "تذكير جلسة خطة", "للمرضى في خطط رعاية", "مقترح", true],
      ["balance_reminder", "تذكير برصيد متبقي", "بعد الفاتورة بأسبوع", "اختياري", true],
      ["custom", "رسالة مخصصة", "تُكتب يدوياً", "يدوي", false],
    ]);
  });

  it("ship the default bodies exactly", () => {
    const bodies = Object.fromEntries(MESSAGE_TEMPLATES.map((t) => [t.key, t.defaultBody]));
    expect(bodies).toEqual({
      booking_confirmation:
        "مرحباً {{patient_name}}،\nاتأكد حجزك في {{clinic_name}}:\n📅 {{date}} · {{time}}\n👨‍⚕️ {{doctor_name}}\n\nلو محتاج تعدّل أو تلغي، اتصل: {{clinic_phone}}\nشكراً لثقتك.",
      appointment_reminder:
        "مرحباً {{patient_name}}،\nبنفكّرك بموعدك بكرة في {{clinic_name}}:\n📅 {{date}} · {{time}}\n👨‍⚕️ {{doctor_name}}\n\nلو مش هتقدر تيجي، كلّمنا: {{clinic_phone}}",
      post_visit_followup:
        "مرحباً {{patient_name}}،\nشكراً لزيارتك {{clinic_name}}. إزاي حالتك دلوقتي؟\nلو محتاج أي حاجة، كلّمنا: {{clinic_phone}}",
      care_plan_session_reminder:
        "مرحباً {{patient_name}}،\nبنفكّرك بـ{{session_label}} في {{clinic_name}}:\n📅 {{date}} · {{time}}\nلو محتاج تغيّر الميعاد، كلّمنا: {{clinic_phone}}",
      balance_reminder:
        "مرحباً {{patient_name}}،\nفيه مبلغ متبقي {{balance}} على زيارتك في {{clinic_name}}.\nلأي استفسار: {{clinic_phone}}",
      custom: "",
    });
  });

  it.each([
    ["booking_confirmation", true, true],
    ["balance_reminder", true, true],
    ["custom", true, false],
    ["promo", false, false],
    ["", false, false],
  ])("%s: a known key %s, editable %s", (key, known, editable) => {
    expect(isMessageTemplateKey(key)).toBe(known);
    expect(isEditableTemplateKey(key)).toBe(editable);
  });
});

describe("effectiveBody", () => {
  it.each([
    ["the override when there is one", "appointment_reminder", { body: "نص المالك" }, "نص المالك"],
    ["the default without an override", "post_visit_followup", null, MESSAGE_TEMPLATES[2].defaultBody],
    ["the default with an undefined override", "balance_reminder", undefined, MESSAGE_TEMPLATES[4].defaultBody],
    ["an empty body for custom", "custom", null, ""],
    ["an empty body for an unknown key", "promo", null, ""],
  ])("returns %s", (_label, key, override, expected) => {
    expect(effectiveBody(key, override)).toBe(expected);
  });
});

describe("templateBodyLength", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["مرحباً", 6],
    ["📅", 1],
    ["👨‍⚕️", 4],
  ])("counts %j as %i characters", (body, length) => {
    expect(templateBodyLength(body)).toBe(length);
  });
});

describe("renderTemplate", () => {
  it.each<[string, string, TemplateValues, string, string[]]>([
    ["a plain name", "مرحباً {{patient_name}}", ALL_VALUES, "مرحباً كريم فتحي", []],
    ["the date as the app shows a clinic day, Latin digits", "{{date}}", ALL_VALUES, "الأحد، 18 أكتوبر", []],
    ["the time as HH:MM", "{{time}}", ALL_VALUES, "10:30", []],
    ["money through the money formatter", "{{balance}}", ALL_VALUES, "250.50 ج.م", []],
    ["a zero balance, which is a value", "{{balance}}", { balance: 0 as Piastres }, "0.00 ج.م", []],
    ["a landline in the local display format", "{{clinic_phone}}", ALL_VALUES, "02 2123 4567", []],
    ["a mobile in the local display format", "{{clinic_phone}}", { clinic_phone: "+201001234567" }, "0100 123 4567", []],
    ["every use of a placeholder", "{{patient_name}} / {{patient_name}}", ALL_VALUES, "كريم فتحي / كريم فتحي", []],
    ["a value trimmed", "[{{doctor_name}}]", { doctor_name: "  د. سلمى  " }, "[د. سلمى]", []],
    ["an unknown token untouched and unreported", "{{nickname}} {{patient_name}}", ALL_VALUES, "{{nickname}} كريم فتحي", []],
    ["a malformed token untouched", "{{ patient_name }} {patient_name}", ALL_VALUES, "{{ patient_name }} {patient_name}", []],
    ["a missing value as its label in brackets, and reported", "مرحباً {{patient_name}}", {}, "مرحباً [اسم المريض]", ["patient_name"]],
    ["a null or blank value as its label, and reported", "{{session_label}}{{doctor_name}}", { session_label: null, doctor_name: "  " }, "[الجلسة][اسم الطبيب]", ["session_label", "doctor_name"]],
    ["a missing balance as its label", "متبقي {{balance}}", { balance: null }, "متبقي [المبلغ المتبقي]", ["balance"]],
    ["a missing date, time, clinic name and phone as their labels", "{{date}} {{time}} {{clinic_name}} {{clinic_phone}}", {}, "[التاريخ] [الوقت] [اسم العيادة] [هاتف العيادة]", ["date", "time", "clinic_name", "clinic_phone"]],
    ["each missing placeholder once, in order of first use", "{{date}} {{time}} {{date}}", { time: null }, "[التاريخ] [الوقت] [التاريخ]", ["date", "time"]],
    ["a missing known value next to an unknown token", "{{nickname}} {{session_label}}", {}, "{{nickname}} [الجلسة]", ["session_label"]],
    ["no placeholders at all", "شكراً", {}, "شكراً", []],
  ])("renders %s", (_label, body, values, text, missing) => {
    expect(renderTemplate(body, values)).toEqual({ text, missing });
  });

  it("fills a whole default body with Latin digits only", () => {
    const { text, missing } = renderTemplate(MESSAGE_TEMPLATES[0].defaultBody, ALL_VALUES);
    expect(missing).toEqual([]);
    expect(text).toBe(
      "مرحباً كريم فتحي،\nاتأكد حجزك في عيادة د. أحمد المصري:\n📅 الأحد، 18 أكتوبر · 10:30\n👨‍⚕️ د. أحمد المصري\n\nلو محتاج تعدّل أو تلغي، اتصل: 02 2123 4567\nشكراً لثقتك.",
    );
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
  });

  it("reports what a default body is missing so a screen can warn before sending", () => {
    const { missing } = renderTemplate(MESSAGE_TEMPLATES[3].defaultBody, { patient_name: "عمر" });
    expect(missing).toEqual(["session_label", "clinic_name", "date", "time", "clinic_phone"]);
  });

  it.each(MESSAGE_TEMPLATES.map((template) => [template.key, template.defaultBody] as const))(
    "never leaves a raw known token in %s rendered with no values",
    (_key, body) => {
      const { text, missing } = renderTemplate(body, {});
      expect(text).not.toContain("{{");
      for (const placeholder of missing) {
        expect(text).toContain(missingValueMarker(placeholder));
      }
    },
  );

  it("labels every known placeholder", () => {
    for (const placeholder of Object.values(TemplatePlaceholder)) {
      expect(missingValueMarker(placeholder)).toBe(`[${PLACEHOLDER_LABELS[placeholder]}]`);
      expect(PLACEHOLDER_LABELS[placeholder]).not.toBe("");
    }
  });
});
