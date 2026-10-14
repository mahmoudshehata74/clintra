import type { Piastres } from "./money";
import { formatPiastresForDisplay } from "./money";
import { formatEgyptianPhoneForDisplay } from "./phone";
import { formatCairoDisplayDate, type ClinicDay, type ClockTime } from "./time";

/**
 * The message templates (docs/schema.md's v19 additions). The six keys, their
 * names, descriptions, kinds and default bodies ship with the app, here — not
 * in the database: a default seeded by a migration would only reach the
 * organizations that existed when it ran. message_templates stores only an
 * organization's edited body for a key (an override); "reset to default"
 * deletes it, and effectiveBody falls back to the default below.
 */
export const MessageTemplateKey = {
  BookingConfirmation: "booking_confirmation",
  AppointmentReminder: "appointment_reminder",
  PostVisitFollowup: "post_visit_followup",
  CarePlanSessionReminder: "care_plan_session_reminder",
  BalanceReminder: "balance_reminder",
  Custom: "custom",
} as const;

export type MessageTemplateKey = (typeof MessageTemplateKey)[keyof typeof MessageTemplateKey];

/** The badge a template carries on the messages screen. */
export const MessageTemplateKind = {
  Suggested: "مقترح",
  Optional: "اختياري",
  Manual: "يدوي",
} as const;

export type MessageTemplateKind = (typeof MessageTemplateKind)[keyof typeof MessageTemplateKind];

export interface MessageTemplateDefinition {
  key: MessageTemplateKey;
  name: string;
  /** When it is sent, as the screen's second line reads it. */
  description: string;
  kind: MessageTemplateKind;
  /** The body used when the organization has no override; "" for custom, which is written per message. */
  defaultBody: string;
  /** Whether an organization may override the body; custom has nothing to override. */
  editable: boolean;
}

/** Every template, in display order. */
export const MESSAGE_TEMPLATES: readonly MessageTemplateDefinition[] = [
  {
    key: MessageTemplateKey.BookingConfirmation,
    name: "تأكيد الحجز",
    description: "بعد الحجز",
    kind: MessageTemplateKind.Suggested,
    defaultBody:
      "مرحباً {{patient_name}}،\nاتأكد حجزك في {{clinic_name}}:\n📅 {{date}} · {{time}}\n👨‍⚕️ {{doctor_name}}\n\nلو محتاج تعدّل أو تلغي، اتصل: {{clinic_phone}}\nشكراً لثقتك.",
    editable: true,
  },
  {
    key: MessageTemplateKey.AppointmentReminder,
    name: "تذكير بالموعد",
    description: "قبل الموعد بيوم",
    kind: MessageTemplateKind.Suggested,
    defaultBody:
      "مرحباً {{patient_name}}،\nبنفكّرك بموعدك بكرة في {{clinic_name}}:\n📅 {{date}} · {{time}}\n👨‍⚕️ {{doctor_name}}\n\nلو مش هتقدر تيجي، كلّمنا: {{clinic_phone}}",
    editable: true,
  },
  {
    key: MessageTemplateKey.PostVisitFollowup,
    name: "متابعة بعد الزيارة",
    description: "بعد الزيارة بيومين",
    kind: MessageTemplateKind.Optional,
    defaultBody:
      "مرحباً {{patient_name}}،\nشكراً لزيارتك {{clinic_name}}. إزاي حالتك دلوقتي؟\nلو محتاج أي حاجة، كلّمنا: {{clinic_phone}}",
    editable: true,
  },
  {
    key: MessageTemplateKey.CarePlanSessionReminder,
    name: "تذكير جلسة خطة",
    description: "للمرضى في خطط رعاية",
    kind: MessageTemplateKind.Suggested,
    defaultBody:
      "مرحباً {{patient_name}}،\nبنفكّرك بـ{{session_label}} في {{clinic_name}}:\n📅 {{date}} · {{time}}\nلو محتاج تغيّر الميعاد، كلّمنا: {{clinic_phone}}",
    editable: true,
  },
  {
    key: MessageTemplateKey.BalanceReminder,
    name: "تذكير برصيد متبقي",
    description: "بعد الفاتورة بأسبوع",
    kind: MessageTemplateKind.Optional,
    defaultBody:
      "مرحباً {{patient_name}}،\nفيه مبلغ متبقي {{balance}} على زيارتك في {{clinic_name}}.\nلأي استفسار: {{clinic_phone}}",
    editable: true,
  },
  {
    key: MessageTemplateKey.Custom,
    name: "رسالة مخصصة",
    description: "تُكتب يدوياً",
    kind: MessageTemplateKind.Manual,
    defaultBody: "",
    editable: false,
  },
];

/** The longest template body an override may hold, in characters (the server's limit too). */
export const TEMPLATE_BODY_MAX_LENGTH = 4000;

/** A body's length in characters (code points), as the server counts it — an emoji is one, not two. */
export function templateBodyLength(body: string): number {
  return [...body].length;
}

export function findMessageTemplate(key: string): MessageTemplateDefinition | undefined {
  return MESSAGE_TEMPLATES.find((template) => template.key === key);
}

export function isMessageTemplateKey(key: string): key is MessageTemplateKey {
  return findMessageTemplate(key) !== undefined;
}

/** Whether an organization may override this key's body (every key but custom). */
export function isEditableTemplateKey(key: string): boolean {
  return findMessageTemplate(key)?.editable ?? false;
}

/**
 * The body a message starts from: the organization's override when it has
 * one, otherwise the default that ships with the app ("" for custom, and for
 * an unknown key).
 */
export function effectiveBody(key: string, override: { body: string } | null | undefined): string {
  return override?.body ?? findMessageTemplate(key)?.defaultBody ?? "";
}

export const TemplatePlaceholder = {
  PatientName: "patient_name",
  ClinicName: "clinic_name",
  ClinicPhone: "clinic_phone",
  Date: "date",
  Time: "time",
  DoctorName: "doctor_name",
  SessionLabel: "session_label",
  Balance: "balance",
} as const;

export type TemplatePlaceholder = (typeof TemplatePlaceholder)[keyof typeof TemplatePlaceholder];

const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set(Object.values(TemplatePlaceholder));

/** Each known placeholder's Arabic label: the editor's `.var` chip, and the marker a missing value renders as. */
export const PLACEHOLDER_LABELS: Record<TemplatePlaceholder, string> = {
  [TemplatePlaceholder.PatientName]: "اسم المريض",
  [TemplatePlaceholder.ClinicName]: "اسم العيادة",
  [TemplatePlaceholder.ClinicPhone]: "هاتف العيادة",
  [TemplatePlaceholder.Date]: "التاريخ",
  [TemplatePlaceholder.Time]: "الوقت",
  [TemplatePlaceholder.DoctorName]: "اسم الطبيب",
  [TemplatePlaceholder.SessionLabel]: "الجلسة",
  [TemplatePlaceholder.Balance]: "المبلغ المتبقي",
};

/** What a known placeholder with no value renders as: its label in square brackets, e.g. "[الجلسة]". */
export function missingValueMarker(placeholder: TemplatePlaceholder): string {
  return `[${PLACEHOLDER_LABELS[placeholder]}]`;
}

/** The values a template is rendered with. Raw values: each one goes through its domain formatter. */
export interface TemplateValues {
  patient_name?: string | null;
  clinic_name?: string | null;
  /** E.164; shown in the local display format. */
  clinic_phone?: string | null;
  date?: ClinicDay | null;
  time?: ClockTime | null;
  doctor_name?: string | null;
  session_label?: string | null;
  balance?: Piastres | null;
}

export interface RenderedTemplate {
  text: string;
  /** Known placeholders the body uses that had no value, in order of first use; each renders as its missingValueMarker. */
  missing: TemplatePlaceholder[];
}

function textValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function formattedValue(placeholder: TemplatePlaceholder, values: TemplateValues): string | null {
  switch (placeholder) {
    case TemplatePlaceholder.ClinicPhone: {
      const phone = textValue(values.clinic_phone);
      return phone === null ? null : formatEgyptianPhoneForDisplay(phone);
    }
    case TemplatePlaceholder.Date: {
      const date = textValue(values.date);
      return date === null ? null : formatCairoDisplayDate(date);
    }
    case TemplatePlaceholder.Balance:
      return values.balance == null ? null : formatPiastresForDisplay(values.balance);
    default:
      return textValue(values[placeholder]);
  }
}

const PLACEHOLDER_PATTERN = /\{\{([a-z_]+)\}\}/g;

/**
 * Fills a template body. Each known placeholder is replaced by its value
 * through the existing domain formatters — the date as the app shows a clinic
 * day (Arabic weekday and month, Latin digits), the time as "HH:MM", money as
 * "12.50 ج.م", the clinic phone in the local display format. A known
 * placeholder with no value (missing, null or blank) renders as its Arabic
 * label in square brackets ("[الجلسة]") — never as a raw {{token}} a patient
 * would receive — and is reported in `missing`, so a screen can warn before
 * sending; an unknown {{token}} is left untouched and is not reported.
 */
export function renderTemplate(body: string, values: TemplateValues): RenderedTemplate {
  const missing: TemplatePlaceholder[] = [];
  const text = body.replace(PLACEHOLDER_PATTERN, (token, name: string) => {
    if (!KNOWN_PLACEHOLDERS.has(name)) {
      return token;
    }
    const placeholder = name as TemplatePlaceholder;
    const value = formattedValue(placeholder, values);
    if (value === null) {
      if (!missing.includes(placeholder)) {
        missing.push(placeholder);
      }
      return missingValueMarker(placeholder);
    }
    return value;
  });
  return { text, missing };
}
