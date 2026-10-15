import { AuditAction, CarePlanItemStatus, CarePlanStatus, InvoiceStatus, MessageChannel, type AuditLog } from "../db/types";
import { findMessageTemplate } from "./messageTemplates";
import { VisitStatus } from "./visitStatus";

export type AuditVerbRow = Pick<AuditLog, "entity" | "action" | "before" | "after">;

function fieldOf(value: unknown, field: string): unknown {
  if (value && typeof value === "object" && field in value) {
    return (value as Record<string, unknown>)[field];
  }
  return undefined;
}

function statusOf(value: unknown): string | undefined {
  const status = fieldOf(value, "status");
  return typeof status === "string" ? status : undefined;
}

function positionOf(value: unknown): number | undefined {
  const position = fieldOf(value, "position");
  return typeof position === "number" ? position : undefined;
}

function dataFieldOf(value: unknown, field: string): string {
  const data = fieldOf(value, "data");
  const raw = fieldOf(data, field);
  return typeof raw === "string" ? raw : "";
}

interface VisitFormFieldConfig {
  key: "complaint" | "diagnosis";
  createVerb: string;
  updateVerb: string;
}

// Checked in this order so a save that touches both fields at once (not
// something the autosave-on-blur UI produces, since it saves one field per
// blur, but not excluded by the write path either) still reports something
// specific rather than falling through to the generic verb.
const VISIT_FORM_FIELDS: readonly VisitFormFieldConfig[] = [
  { key: "complaint", createVerb: "سجّل شكوى", updateVerb: "عدّل شكوى" },
  { key: "diagnosis", createVerb: "سجّل تشخيص", updateVerb: "عدّل تشخيص" },
];

const VISIT_FORM_EXCERPT_MAX_LENGTH = 40;

function excerptOf(value: string): string {
  return value.length > VISIT_FORM_EXCERPT_MAX_LENGTH
    ? `${value.slice(0, VISIT_FORM_EXCERPT_MAX_LENGTH)}…`
    : value;
}

export interface VisitFormChange {
  verb: string;
  /** The changed field's new value, truncated to 40 characters — never the full before/after diff (that stays in audit_log itself). */
  excerpt: string;
}

/**
 * Which of the general form's two fields a visit_form_data save changed, for
 * both the audit verb (describeAuditVerb) and the audit sheet's excerpt — one
 * source of truth so the two never disagree. "Registered" (سجّل) vs "edited"
 * (عدّل) is decided by whether the field was empty before this save, not by
 * the mutation's own create/update action: the row's first-ever save is
 * always a create, but a field saved for the first time on an already-
 * existing row (the other field having been saved earlier) still reads as
 * "registered," not "edited," since nothing was there to edit.
 */
export function describeVisitFormChange(row: AuditVerbRow): VisitFormChange | undefined {
  for (const field of VISIT_FORM_FIELDS) {
    const before = dataFieldOf(row.before, field.key);
    const after = dataFieldOf(row.after, field.key);
    if (after !== before) {
      return { verb: before === "" ? field.createVerb : field.updateVerb, excerpt: excerptOf(after) };
    }
  }
  return undefined;
}

const VISIT_FORM_FALLBACK_VERB = "عدّل النموذج";

// Reachable from more than one starting status (see domain/transitions.ts's
// VISIT_TRANSITIONS) but always means the same thing regardless of where the
// visit was: an assistant can cancel, mark no-show, or move a visit from
// booked, confirmed, arrived or in_room alike.
const VISIT_TERMINAL_VERBS: Partial<Record<VisitStatus, string>> = {
  [VisitStatus.Cancelled]: "ألغى الحجز",
  [VisitStatus.NoShow]: "علّم لم يحضر",
  [VisitStatus.Rescheduled]: "نقل الميعاد",
};

// Every other reachable (from, to) pair in VISIT_TRANSITIONS — the plain
// forward progression a visit makes through one working day.
const VISIT_PROGRESSION_VERBS: Partial<Record<string, string>> = {
  [`${VisitStatus.Booked}->${VisitStatus.Confirmed}`]: "أكّد الحجز",
  [`${VisitStatus.Booked}->${VisitStatus.Arrived}`]: "علّم وصول",
  [`${VisitStatus.Confirmed}->${VisitStatus.Arrived}`]: "علّم وصول",
  [`${VisitStatus.Arrived}->${VisitStatus.InRoom}`]: "حوّل للكشف",
  [`${VisitStatus.InRoom}->${VisitStatus.Completed}`]: "قفل الزيارة",
};

// Reachable invoice transitions only — partial -> void is not reachable at
// all (voiding is refused once any payment exists, and partial only exists
// once one has), so it is deliberately absent rather than dead code.
const INVOICE_TRANSITION_VERBS: Partial<Record<string, string>> = {
  [`${InvoiceStatus.Unpaid}->${InvoiceStatus.Partial}`]: "سجّل دفعة جزئية",
  [`${InvoiceStatus.Unpaid}->${InvoiceStatus.Paid}`]: "سجّل السداد الكامل",
  [`${InvoiceStatus.Partial}->${InvoiceStatus.Paid}`]: "سجّل السداد الكامل",
  [`${InvoiceStatus.Unpaid}->${InvoiceStatus.Void}`]: "ألغى الفاتورة",
};

const VISIT_NOTE_VERB = "عدّل ملاحظة الزيارة";

// The first print of a prescription (db/prescriptions.ts's
// markPrescriptionPrinted): the one update that sets printed_at.
const PRESCRIPTION_PRINT_VERB = "طبع الوصفة";

// Messages and template overrides (db/messages.ts). Verb only: a message's
// body and phone, and a template's body, never appear in the audit line.
const MESSAGE_OPENED_VERBS: Record<MessageChannel, string> = {
  [MessageChannel.WhatsApp]: "فتح رسالة واتساب",
  [MessageChannel.Sms]: "فتح رسالة SMS",
};
const MESSAGE_MARKED_SENT_VERB = "علّم الرسالة إنها اتبعتت";
const MESSAGE_UNMARKED_SENT_VERB = "شال علامة الإرسال";
const MESSAGE_FALLBACK_VERB = "عدّل الرسالة";

function templateNameOf(row: AuditVerbRow): string {
  const key = fieldOf(row.after ?? row.before, "key");
  const name = typeof key === "string" ? findMessageTemplate(key)?.name : undefined;
  return name ?? "رسالة";
}

function describeMessageVerb(row: AuditVerbRow): string {
  if (row.action === AuditAction.Create) {
    const channel = fieldOf(row.after, "channel");
    return MESSAGE_OPENED_VERBS[channel as MessageChannel] ?? MESSAGE_OPENED_VERBS[MessageChannel.WhatsApp];
  }
  const before = fieldOf(row.before, "marked_sent_at") ?? null;
  const after = fieldOf(row.after, "marked_sent_at") ?? null;
  if (before === null && after !== null) {
    return MESSAGE_MARKED_SENT_VERB;
  }
  if (before !== null && after === null) {
    return MESSAGE_UNMARKED_SENT_VERB;
  }
  return MESSAGE_FALLBACK_VERB;
}

/** An override's create or update reads as an edit of that template; its delete as a reset to the default. */
function describeTemplateVerb(row: AuditVerbRow): string {
  const name = templateNameOf(row);
  return row.action === AuditAction.Delete ? `رجّع قالب «${name}» للأصل` : `عدّل قالب «${name}»`;
}

// Care plans (db/carePlans.ts). Verb only: a plan's goal and diagnosis
// never appear in the audit line. Creating a plan writes the plan
// ("بدأ خطة رعاية") and its sessions ("أضاف جلسات للخطة"); every other plan
// write that changes neither status reads as an edit, including the
// recomputed totals that ride along with a skip or an added session.
const CARE_PLAN_STATUS_VERBS: Partial<Record<string, string>> = {
  [`${CarePlanStatus.Active}->${CarePlanStatus.Stopped}`]: "وقّف الخطة",
  [`${CarePlanStatus.Stopped}->${CarePlanStatus.Active}`]: "رجّع الخطة",
};
const CARE_PLAN_ITEM_STATUS_VERBS: Partial<Record<string, string>> = {
  [`${CarePlanItemStatus.Planned}->${CarePlanItemStatus.Skipped}`]: "أجّل جلسة",
  [`${CarePlanItemStatus.Skipped}->${CarePlanItemStatus.Planned}`]: "رجّع جلسة",
};
// A session's link to the visit that books it changes only with that
// visit's own write. Booked and moved read as the visit's own verbs; a link
// cleared by a cancel or a no-show (the session row alone cannot tell
// which) reads as the plan's plain edit, beside the visit's own line.
const CARE_PLAN_SESSION_BOOKED_VERB = "أنشأ حجز";
const CARE_PLAN_SESSION_MOVED_VERB = "نقل الميعاد";
const CARE_PLAN_EDIT_VERB = "عدّل خطة رعاية";

function describeCarePlanItemUpdate(row: AuditVerbRow): string | undefined {
  const statusVerb = CARE_PLAN_ITEM_STATUS_VERBS[`${statusOf(row.before)}->${statusOf(row.after)}`];
  if (statusVerb) {
    return statusVerb;
  }
  const before = fieldOf(row.before, "visit_id") ?? null;
  const after = fieldOf(row.after, "visit_id") ?? null;
  if (before === after) {
    return undefined;
  }
  if (before === null) {
    return CARE_PLAN_SESSION_BOOKED_VERB;
  }
  return after === null ? CARE_PLAN_EDIT_VERB : CARE_PLAN_SESSION_MOVED_VERB;
}

// Settings (the audit sheet's "إعدادات"): verb only — a service's price, a
// staff member's PIN or scopes never appear in the audit line. A service or
// a staff membership switched off or on reads as that, not as an edit.
function describeSettingsUpdate(row: AuditVerbRow): string | undefined {
  const wasActive = fieldOf(row.before, "is_active");
  const isActive = fieldOf(row.after, "is_active");
  const toggled = typeof wasActive === "boolean" && typeof isActive === "boolean" && wasActive !== isActive;
  if (row.entity === "services" && toggled) {
    return isActive ? "شغّل خدمة" : "وقّف خدمة";
  }
  if (row.entity === "memberships") {
    if (toggled) {
      return isActive ? "شغّل موظف" : "وقّف موظف";
    }
    if (fieldOf(row.before, "pin_hash") !== fieldOf(row.after, "pin_hash")) {
      return "غيّر الرقم السري";
    }
    // A rename (memberships.display_name, docs/schema.md's v21 additions);
    // a row stored before the column existed has none, the same as null.
    if ((fieldOf(row.before, "display_name") ?? null) !== (fieldOf(row.after, "display_name") ?? null)) {
      return "غيّر اسم موظف";
    }
  }
  return undefined;
}

const CREATE_VERBS: Partial<Record<string, string>> = {
  visits: "أنشأ حجز",
  patients: "أضاف مريض",
  invoices: "أنشأ فاتورة",
  payments: "سجّل دفعة",
  cash_close: "قفل اليوم",
  prescriptions: "كتب وصفة",
  prescription_items: "أضاف دواء",
  care_plans: "بدأ خطة رعاية",
  care_plan_items: "أضاف جلسات للخطة",
  services: "أضاف خدمة",
  service_price_overrides: "أضاف سعر خاص",
  schedules: "أضاف مواعيد العمل",
  // A staff member added before the server took over adding staff wrote a
  // users row and its membership; one added since writes the membership
  // alone (db/staffSettings.ts's addStaffMember) — either reads as the add.
  users: "أضاف موظف",
  memberships: "أضاف موظف",
  membership_locations: "حدّد فروع الموظف",
  membership_practitioners: "حدّد أطباء الموظف",
};

const DELETE_VERBS: Partial<Record<string, string>> = {
  visits: "حذف الحجز",
  patients: "حذف المريض",
  invoices: "حذف الفاتورة",
  payments: "حذف الدفعة",
  prescription_items: "شال دواء",
  services: "حذف خدمة",
  service_price_overrides: "شال سعر خاص",
  schedules: "شال مواعيد العمل",
  membership_locations: "شال فرع من نطاق الموظف",
  membership_practitioners: "شال طبيب من نطاق الموظف",
};

const FALLBACK_UPDATE_VERBS: Partial<Record<string, string>> = {
  visits: "عدّل الزيارة",
  patients: "عدّل بيانات المريض",
  invoices: "عدّل الفاتورة",
  payments: "عدّل الدفعة",
  cash_close: "عدّل إغلاق اليوم",
  prescriptions: "عدّل الوصفة",
  prescription_items: "عدّل دواء",
  // Verb only: a practitioner's name, title or syndicate number never
  // appears in the audit line (db/practitioners.ts).
  practitioners: "عدّل بيانات الطبيب",
  care_plans: CARE_PLAN_EDIT_VERB,
  care_plan_items: CARE_PLAN_EDIT_VERB,
  services: "عدّل خدمة",
  service_price_overrides: "عدّل سعر خاص",
  schedules: "عدّل مواعيد العمل",
  users: "عدّل بيانات موظف",
  memberships: "عدّل صلاحية موظف",
};

/**
 * The short Arabic verb an audit-log row reads as, built from the entity,
 * the action, and — for an update — the actual before/after diff, not just
 * the entity name: a visit update where status went from booked to arrived
 * reads "علّم وصول", never a generic "عدّل زيارة", because that genuinely is
 * a different, more specific thing than an arbitrary field edit. Falls back
 * to a plain per-entity edit verb only when no known, more specific pattern
 * matches — for a genuine field edit (e.g. a service change), or for an entity this
 * table has no specific verbs for at all.
 */
export function describeAuditVerb(row: AuditVerbRow): string {
  // Checked ahead of the action-based branches below: a visit_form_data
  // save's verb depends on which of its two fields changed, not on whether
  // the row itself was created or updated (see describeVisitFormChange).
  if (row.entity === "visit_form_data") {
    return describeVisitFormChange(row)?.verb ?? VISIT_FORM_FALLBACK_VERB;
  }

  // A message's verb depends on its channel or on its sent mark, a
  // template's on which template it is — not on the action alone.
  if (row.entity === "messages") {
    return describeMessageVerb(row);
  }
  if (row.entity === "message_templates") {
    return describeTemplateVerb(row);
  }

  if (row.action === AuditAction.Delete) {
    return DELETE_VERBS[row.entity] ?? `حذف (${row.entity})`;
  }

  if (row.action === AuditAction.Create) {
    return CREATE_VERBS[row.entity] ?? `أنشأ (${row.entity})`;
  }

  const beforeStatus = statusOf(row.before);
  const afterStatus = statusOf(row.after);
  const statusChanged = beforeStatus !== undefined && afterStatus !== undefined && beforeStatus !== afterStatus;

  if (row.entity === "visits" && statusChanged) {
    const terminal = VISIT_TERMINAL_VERBS[afterStatus as VisitStatus];
    if (terminal) {
      return terminal;
    }
    const progression = VISIT_PROGRESSION_VERBS[`${beforeStatus}->${afterStatus}`];
    if (progression) {
      return progression;
    }
  }

  if (row.entity === "invoices" && statusChanged) {
    const invoiceVerb = INVOICE_TRANSITION_VERBS[`${beforeStatus}->${afterStatus}`];
    if (invoiceVerb) {
      return invoiceVerb;
    }
  }

  if (row.entity === "care_plans" && statusChanged) {
    const planVerb = CARE_PLAN_STATUS_VERBS[`${beforeStatus}->${afterStatus}`];
    if (planVerb) {
      return planVerb;
    }
  }

  const settingsVerb = describeSettingsUpdate(row);
  if (settingsVerb) {
    return settingsVerb;
  }

  if (row.entity === "care_plan_items") {
    const sessionVerb = describeCarePlanItemUpdate(row);
    if (sessionVerb) {
      return sessionVerb;
    }
  }

  // Verb only, as for a note: a prescription's audit line never carries a
  // drug's name or instructions, or the diagnosis it snapshots.
  if (row.entity === "prescriptions" && fieldOf(row.before, "printed_at") == null && fieldOf(row.after, "printed_at") != null) {
    return PRESCRIPTION_PRINT_VERB;
  }

  // A visit whose status did not change but whose position did: a queue
  // reorder (send-to-end, its undo, or a slots<->queue translation), not a
  // status transition at all, but still more specific than "edited."
  if (row.entity === "visits" && !statusChanged) {
    const beforePosition = positionOf(row.before);
    const afterPosition = positionOf(row.after);
    if (beforePosition !== undefined && afterPosition !== undefined && beforePosition !== afterPosition) {
      return "غيّر ترتيب الدور";
    }

    // The doctor's quick note (db/visitNote.ts). Verb only — the note's own
    // text never appears in the audit line. A missing field (an audit row
    // written before visits.note existed) reads as null, so an older row
    // never misreports a note edit.
    if ((fieldOf(row.before, "note") ?? null) !== (fieldOf(row.after, "note") ?? null)) {
      return VISIT_NOTE_VERB;
    }
  }

  return FALLBACK_UPDATE_VERBS[row.entity] ?? `عدّل (${row.entity})`;
}
