import type { QueueReorderMove } from "../../db/visitQueue";

/**
 * What a toast's undo button should reverse. Most writes are a single
 * mutation; booking a brand-new patient is two writes (the patient row, then
 * the visit row), and moving a visit is also two writes (the new visit row,
 * then the original marked rescheduled) — both need their two-step undo
 * reversed in a specific order, not just replayed as two independent calls.
 */
export type UndoAction =
  | { kind: "visit"; auditLogId: string }
  | { kind: "day_state"; auditLogId: string }
  | { kind: "new_patient_visit"; visitAuditLogId: string; patientAuditLogId: string }
  | { kind: "visit_move"; newVisitAuditLogId: string; oldVisitAuditLogId: string }
  | {
      kind: "visit_completed";
      visitAuditLogId: string;
      invoiceAuditLogId: string;
      /** Null only in the no-service_id fallback (see db/visitCompletion.ts), where no item row was written. */
      invoiceItemAuditLogId: string | null;
      dayStateAuditLogId: string;
    }
  | { kind: "payment"; paymentAuditLogId: string; invoiceAuditLogId: string }
  /** Reversed atomically as a whole — see db/visitQueue.ts's undoSendVisitToEndOfQueue. */
  | { kind: "queue_reorder"; moves: QueueReorderMove[] };
