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
