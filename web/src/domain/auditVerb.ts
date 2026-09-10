import { AuditAction, InvoiceStatus, type AuditLog } from "../db/types";
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
  [VisitStatus.Cancelled]: "ألغى الزيارة",
  [VisitStatus.NoShow]: "سجّل غياب",
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

const CREATE_VERBS: Partial<Record<string, string>> = {
  visits: "سجّل حجز",
  patients: "أضاف مريض",
  invoices: "أنشأ فاتورة",
  payments: "سجّل دفعة",
  cash_close: "قفل اليوم",
};

const DELETE_VERBS: Partial<Record<string, string>> = {
  visits: "حذف الزيارة",
  patients: "حذف المريض",
  invoices: "حذف الفاتورة",
  payments: "حذف الدفعة",
};

const FALLBACK_UPDATE_VERBS: Partial<Record<string, string>> = {
  visits: "عدّل الزيارة",
  patients: "عدّل بيانات المريض",
  invoices: "عدّل الفاتورة",
  payments: "عدّل الدفعة",
  cash_close: "عدّل إغلاق اليوم",
};

/**
 * The short Arabic verb an audit-log row reads as, built from the entity,
 * the action, and — for an update — the actual before/after diff, not just
 * the entity name: a visit update where status went from booked to arrived
 * reads "علّم وصول", never a generic "عدّل زيارة", because that genuinely is
 * a different, more specific thing than an arbitrary field edit. Falls back
 * to a plain per-entity edit verb only when no known, more specific pattern
 * matches — for a genuine field edit (e.g. a note), or for an entity this
 * table has no specific verbs for at all.
 */
export function describeAuditVerb(row: AuditVerbRow): string {
  // Checked ahead of the action-based branches below: a visit_form_data
  // save's verb depends on which of its two fields changed, not on whether
  // the row itself was created or updated (see describeVisitFormChange).
  if (row.entity === "visit_form_data") {
    return describeVisitFormChange(row)?.verb ?? VISIT_FORM_FALLBACK_VERB;
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

  // A visit whose status did not change but whose position did: a queue
  // reorder (send-to-end, its undo, or a slots<->queue translation), not a
  // status transition at all, but still more specific than "edited."
  if (row.entity === "visits" && !statusChanged) {
    const beforePosition = positionOf(row.before);
    const afterPosition = positionOf(row.after);
    if (beforePosition !== undefined && afterPosition !== undefined && beforePosition !== afterPosition) {
      return "غيّر ترتيب الدور";
    }
  }

  return FALLBACK_UPDATE_VERBS[row.entity] ?? `عدّل (${row.entity})`;
}
