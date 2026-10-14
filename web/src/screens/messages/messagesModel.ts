import type { Invoice, Location, Membership, Message, Organization, Patient, Practitioner, Prescription, PrescriptionItem, Visit } from "../../db/types";
import { InvoiceStatus } from "../../db/types";
import {
  findMessageTemplate,
  MessageTemplateKind,
  renderTemplate,
  TemplatePlaceholder,
  type MessageTemplateDefinition,
  type TemplateValues,
} from "../../domain/messageTemplates";
import type { Piastres } from "../../domain/money";
import { formatPrescriptionNumber } from "../../domain/numberSeries";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import { LocationScope } from "../../domain/scope";
import { clockTimeInCairo } from "../../domain/time";
import { rxDoseLine, sortRxItems } from "../visit/workspace";
import { messagesStrings as T } from "./strings";

// Pure derivations behind the messages screen (reference screen 19) and the
// send sheet. None reads the database or the clock on its own.

/** `.msg-body .var`'s Arabic label for each known placeholder. */
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

/** Every known placeholder, in the order the editor offers its insert chips. */
export const PLACEHOLDERS: readonly TemplatePlaceholder[] = Object.values(TemplatePlaceholder);

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "var"; placeholder: TemplatePlaceholder; label: string };

const KNOWN = new Set<string>(PLACEHOLDERS);
const TOKEN = /\{\{([a-z_]+)\}\}/g;

/**
 * A template body cut into `.msg-preview`'s runs: plain text, and one
 * `.var` chip per known placeholder, labelled in Arabic. An unknown
 * {{token}} stays part of the text, as renderTemplate leaves it. Adjacent
 * text is merged, so no segment is ever an empty string.
 */
export function segmentTemplateBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const pushText = (text: string) => {
    if (text === "") {
      return;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === "text") {
      last.text += text;
    } else {
      segments.push({ kind: "text", text });
    }
  };

  let index = 0;
  for (const match of body.matchAll(TOKEN)) {
    const name = match[1];
    pushText(body.slice(index, match.index));
    if (KNOWN.has(name)) {
      const placeholder = name as TemplatePlaceholder;
      segments.push({ kind: "var", placeholder, label: PLACEHOLDER_LABELS[placeholder] });
    } else {
      pushText(match[0]);
    }
    index = match.index + match[0].length;
  }
  pushText(body.slice(index));
  return segments;
}

/** The token the editor's insert chip puts at the cursor, e.g. "{{patient_name}}". */
export function placeholderToken(placeholder: TemplatePlaceholder): string {
  return `{{${placeholder}}}`;
}

/** `.msg-tpl .icn` per template, in the prototype's own glyphs. */
const TEMPLATE_ICONS: Record<string, string> = {
  booking_confirmation: "✓",
  appointment_reminder: "⏰",
  post_visit_followup: "♥",
  care_plan_session_reminder: "◔",
  balance_reminder: "₤",
  custom: "✎",
};

export function templateIcon(key: string): string {
  return TEMPLATE_ICONS[key] ?? "✉";
}

/** `.msg-tpl .badge`'s variant: `.badge.auto` (copper) for مقترح, plain (eligible) for اختياري, `.badge.manual` (muted) for يدوي. */
export function templateBadgeTone(definition: Pick<MessageTemplateDefinition, "kind">): "copper" | "eligible" | "neutral" {
  switch (definition.kind) {
    case MessageTemplateKind.Suggested:
      return "copper";
    case MessageTemplateKind.Manual:
      return "neutral";
    default:
      return "eligible";
  }
}

/**
 * `.msg-preview .ch`: "معدّل" when the organization overrides the body (for
 * anyone), otherwise "قابل للتعديل" for the owner on an editable template;
 * null — no chip — for everyone else and for custom.
 */
export function templateChipLabel(definition: Pick<MessageTemplateDefinition, "editable">, hasOverride: boolean, isOwner: boolean): string | null {
  if (hasOverride) {
    return T.chipOverridden;
  }
  return isOwner && definition.editable ? T.chipEditable : null;
}

export interface VisitMessageSources {
  visit: Pick<Visit, "visit_date" | "scheduled_at">;
  patient: Pick<Patient, "full_name"> | undefined;
  practitioner: Pick<Practitioner, "full_name"> | undefined;
  organization: Pick<Organization, "name"> | undefined;
  location: Pick<Location, "phone"> | undefined;
  invoice: Pick<Invoice, "total" | "paid" | "status"> | undefined;
}

/**
 * What a template is filled with for one visit: the patient's name; the
 * clinic's name and phone from the same rows every printed page's clinic
 * block reads (the organization and the visit's location); the visit's day
 * and, for a booked time, its Cairo clock time; the visit's practitioner;
 * the balance — the invoice's total less what was paid, only while that is
 * above zero (a void invoice has none). The session label stays missing
 * until care plans (screen 17) exist. Anything missing is null, so
 * renderTemplate reports it.
 */
export function templateValuesForVisit(sources: VisitMessageSources): TemplateValues {
  const { visit, invoice } = sources;
  const remaining = invoice && invoice.status !== InvoiceStatus.Void ? invoice.total - invoice.paid : 0;
  return {
    patient_name: sources.patient?.full_name ?? null,
    clinic_name: sources.organization?.name ?? null,
    clinic_phone: sources.location?.phone ?? null,
    date: visit.visit_date,
    time: visit.scheduled_at ? clockTimeInCairo(visit.scheduled_at) : null,
    doctor_name: sources.practitioner?.full_name ?? null,
    session_label: null,
    balance: remaining > 0 ? (remaining as Piastres) : null,
  };
}

/** The send sheet's warning for placeholders the text still holds unfilled ("فيه بيانات ناقصة: اسم الطبيب، الوقت"); null when none. */
export function missingValuesWarning(text: string): string | null {
  const { missing } = renderTemplate(text, {});
  if (missing.length === 0) {
    return null;
  }
  return `${T.missingValuesPrefix} ${missing.map((placeholder) => PLACEHOLDER_LABELS[placeholder]).join("، ")}`;
}

/** The send sheet's starting text for a template: its effective body, filled for the visit. */
export function initialMessageText(templateKey: string, effectiveBody: string, values: TemplateValues): string {
  if (findMessageTemplate(templateKey) === undefined) {
    return "";
  }
  return renderTemplate(effectiveBody, values).text;
}

export interface PrescriptionMessageSources {
  prescription: Pick<Prescription, "number" | "issued_year" | "series">;
  items: readonly PrescriptionItem[];
  patientName: string | null;
  doctorName: string | null;
}

/**
 * A printed prescription as a message (the custom template's text): its
 * number, the patient, one numbered line per drug in position order —
 * "name — form: instructions · duration", the form part left out when
 * empty — with the drug's note on its own line under it, then "د. {name}".
 */
export function prescriptionMessageText({ prescription, items, patientName, doctorName }: PrescriptionMessageSources): string {
  const lines = [`${T.rxMessageTitle} ${formatPrescriptionNumber(prescription)}`];
  if (patientName) {
    lines.push(`${T.rxMessagePatient} ${patientName}`);
  }
  sortRxItems(items).forEach((item, index) => {
    const form = item.form?.trim();
    const { dose, note } = rxDoseLine(item);
    lines.push(`${index + 1}. ${form ? `${item.name} — ${form}` : item.name}: ${dose}`);
    if (note) {
      lines.push(`   ${note}`);
    }
  });
  if (doctorName) {
    lines.push(`د. ${doctorName}`);
  }
  return lines.join("\n");
}

const SNIPPET_LENGTH = 60;

/** `.msg-item .snip`: the body's first line, cut to 60 characters (code points) with "…" when longer. */
export function messageSnippet(body: string): string {
  const firstLine = body.split("\n")[0].trim();
  const characters = [...firstLine];
  return characters.length > SNIPPET_LENGTH ? `${characters.slice(0, SNIPPET_LENGTH).join("")}…` : firstLine;
}

/** `.msg-item .to`: "name · 010 1234 5678" — the name, then the number in the local display form. */
export function messageRecipientLine(patientName: string | undefined, phone: string): string {
  const display = formatEgyptianPhoneForDisplay(phone);
  return patientName ? `${patientName} · ${display}` : display;
}

export interface MessageAccess {
  membership: Pick<Membership, "org_id" | "location_scope">;
  /** The membership's own locations; read only when its scope is "listed". */
  listedLocationIds: ReadonlySet<string>;
}

/** Messages are scoped like invoices: the membership's organization, and its locations unless it covers all. */
export function isMessageVisible(message: Pick<Message, "org_id" | "location_id">, access: MessageAccess): boolean {
  if (message.org_id !== access.membership.org_id) {
    return false;
  }
  return access.membership.location_scope === LocationScope.All || access.listedLocationIds.has(message.location_id);
}

export const RECENT_MESSAGES_LIMIT = 20;

/** `.msg-sent`: the most recent messages the membership can see, newest attempt first, at most 20. */
export function recentMessages<M extends Message>(messages: readonly M[], access: MessageAccess, limit = RECENT_MESSAGES_LIMIT): M[] {
  return messages
    .filter((message) => isMessageVisible(message, access))
    .sort((a, b) => b.attempted_at.localeCompare(a.attempted_at) || b.id.localeCompare(a.id))
    .slice(0, limit);
}
