/**
 * What a toast's undo button should reverse. Most writes are a single visit
 * mutation; booking a brand-new patient is two writes (the patient row, then
 * the visit row), so undoing it must reverse both, in reverse order.
 */
export type UndoAction =
  | { kind: "visit"; auditLogId: string }
  | { kind: "new_patient_visit"; visitAuditLogId: string; patientAuditLogId: string };
