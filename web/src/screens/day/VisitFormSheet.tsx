import { useEffect, useRef, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import type { Patient, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import {
  EMPTY_VISIT_FORM_VALUES,
  findGeneralFormDefinition,
  findVisitFormData,
  saveVisitFormField,
  type VisitFormFieldKey,
  type VisitFormFieldValues,
} from "../../db/visitForm";
import { clockTimeInCairo } from "../../domain/time";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
import { dayScreenStrings } from "./strings";

interface VisitFormSheetProps {
  visitId: string;
  onDismiss: () => void;
}

interface VisitFormSheetData {
  visit: Visit;
  patient: Patient | undefined;
  formDefinitionId: string;
  values: VisitFormFieldValues;
}

/** How long the muted "اتحفظ" indicator stays next to a field after its autosave commits. */
const SAVED_INDICATOR_MS = 2000;

const FIELD_CONFIG: readonly { key: VisitFormFieldKey; label: string; placeholder: string }[] = [
  {
    key: "complaint",
    label: dayScreenStrings.visitFormComplaintLabel,
    placeholder: dayScreenStrings.visitFormComplaintPlaceholder,
  },
  {
    key: "diagnosis",
    label: dayScreenStrings.visitFormDiagnosisLabel,
    placeholder: dayScreenStrings.visitFormDiagnosisPlaceholder,
  },
];

/**
 * The v1 general visit form (reference screen 10): two plain text fields,
 * autosaved on blur, no explicit save button. Opened deliberately from a
 * pill on an in_room or completed row — never automatically — and just as
 * writable after completion as before it, since filling this form is
 * decoupled from completing the visit (see db/visitForm.ts, db/visitCompletion.ts).
 *
 * Reads everything itself via liveQuery, matching InvoiceSheet's
 * self-contained pattern; the caller only needs to know which visit to show.
 */
export default function VisitFormSheet({ visitId, onDismiss }: VisitFormSheetProps) {
  const [values, setValues] = useState<VisitFormFieldValues>(EMPTY_VISIT_FORM_VALUES);
  const [justSaved, setJustSaved] = useState<Record<VisitFormFieldKey, boolean>>({
    complaint: false,
    diagnosis: false,
  });
  // Tracks which field is mid-edit as a ref, not state: the hydration effect
  // below must read it without itself re-running on every focus change (that
  // would refetch a value the field's own save had not committed yet,
  // visibly reverting what the doctor just typed for an instant).
  const focusedFieldRef = useRef<VisitFormFieldKey | null>(null);
  const savedTimeouts = useRef<Partial<Record<VisitFormFieldKey, ReturnType<typeof setTimeout>>>>({});

  const data = useLiveQuery<VisitFormSheetData | null>(async () => {
    const visit = await db.visits.get(visitId);
    if (!visit) {
      return null;
    }
    const [patient, formDefinition] = await Promise.all([
      db.patients.get(visit.patient_id),
      findGeneralFormDefinition(db),
    ]);
    const existing = await findVisitFormData(db, visitId, formDefinition.id);
    const rowValues = (existing?.data as VisitFormFieldValues | undefined) ?? EMPTY_VISIT_FORM_VALUES;
    return { visit, patient, formDefinitionId: formDefinition.id, values: rowValues };
  }, [visitId]);

  // Hydrates the working copy from the database whenever it changes —
  // including this sheet's own just-committed save, and another tab's write
  // — except for a field currently being typed into, which keeps the
  // doctor's in-progress text instead of being overwritten mid-keystroke.
  useEffect(() => {
    if (!data) {
      return;
    }
    setValues((prev) => ({
      complaint: focusedFieldRef.current === "complaint" ? prev.complaint : data.values.complaint,
      diagnosis: focusedFieldRef.current === "diagnosis" ? prev.diagnosis : data.values.diagnosis,
    }));
  }, [data]);

  useEffect(() => {
    const timeouts = savedTimeouts.current;
    return () => {
      for (const timeout of Object.values(timeouts)) {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    };
  }, []);

  function markJustSaved(field: VisitFormFieldKey) {
    setJustSaved((prev) => ({ ...prev, [field]: true }));
    const existingTimeout = savedTimeouts.current[field];
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    savedTimeouts.current[field] = setTimeout(() => {
      setJustSaved((prev) => ({ ...prev, [field]: false }));
    }, SAVED_INDICATOR_MS);
  }

  function handleChange(field: VisitFormFieldKey, value: string) {
    focusedFieldRef.current = field;
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleBlur(field: VisitFormFieldKey) {
    focusedFieldRef.current = null;
    const persisted = data?.values[field] ?? "";
    const value = values[field];
    if (value === persisted) {
      return;
    }
    await saveVisitFormField(db, visitId, field, value);
    markJustSaved(field);
  }

  if (!data) {
    return (
      <Sheet onDismiss={onDismiss}>
        <p className="text-muted">{dayScreenStrings.visitFormLoadingLabel}</p>
      </Sheet>
    );
  }

  const { visit, patient } = data;

  return (
    <Sheet onDismiss={onDismiss}>
      <SheetHeader
        title={patient?.full_name ?? ""}
        onDismiss={onDismiss}
        extra={
          visit.arrived_at && (
            <span className="text-sm text-muted">
              <Ltr>{clockTimeInCairo(visit.arrived_at)}</Ltr>
            </span>
          )
        }
      />

      <div className="mt-3 flex flex-col gap-4">
        {FIELD_CONFIG.map((field) => (
          <div key={field.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label htmlFor={`visit-form-${field.key}`} className="text-xs text-muted">
                {field.label}
              </label>
              {justSaved[field.key] && (
                <span className="text-xs text-muted">{dayScreenStrings.visitFormSavedIndicator}</span>
              )}
            </div>
            <textarea
              id={`visit-form-${field.key}`}
              value={values[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => handleChange(field.key, event.target.value)}
              onFocus={() => {
                focusedFieldRef.current = field.key;
              }}
              onBlur={() => void handleBlur(field.key)}
              rows={3}
              className="w-full resize-none rounded-[--radius-el] border border-line bg-paper p-3 text-sm text-ink focus:border-green focus:outline-none focus:ring-2 focus:ring-green-soft"
            />
          </div>
        ))}
      </div>
    </Sheet>
  );
}
