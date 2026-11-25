import { useState, type FormEvent } from "react";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Field, { TextArea } from "../../components/ui/Field";
import { db } from "../../db/database";
import { correctVisitForm } from "../../db/visitCorrections";
import type { VisitFormFieldKey, VisitFormFieldValues } from "../../db/visitForm";
import { dayScreenStrings } from "../day/strings";
import CorrectionHistorySheet from "./CorrectionHistorySheet";
import { correctionErrorMessage, correctionHistoryLabel } from "./correctionModel";
import { visitCorrectionStrings as T } from "./strings";

const FIELDS: readonly { key: VisitFormFieldKey; label: string; placeholder: string }[] = [
  { key: "complaint", label: dayScreenStrings.visitFormComplaintLabel, placeholder: dayScreenStrings.visitFormComplaintPlaceholder },
  { key: "diagnosis", label: dayScreenStrings.visitFormDiagnosisLabel, placeholder: dayScreenStrings.visitFormDiagnosisPlaceholder },
];

interface CompletedVisitFieldsProps {
  visitId: string;
  /** The stored values, live. */
  stored: VisitFormFieldValues;
  /** How many corrections the form has had. */
  revisionCount: number;
  /** The acting membership may correct (db/visitCorrections.ts's canCorrectVisit). */
  canCorrect: boolean;
  /** The acting membership reads clinical text: only then the chip and the history show. */
  showsHistory: boolean;
}

/**
 * A completed visit's complaint and diagnosis (docs/design-clinical-corrections.md
 * section 9): read only — the autosave stops at completion — with "تعديل"
 * for the visit's doctor and the owner, which opens "تعديل نموذج الزيارة":
 * both fields, "سبب التعديل" (required, 3 to 500 characters), "حفظ التعديل"
 * and "إلغاء"; a refusal shows as one line under the form
 * (correctionErrorMessage). With at least one correction, "تم التعديل" and
 * "سجل التعديلات ({n})" show to whoever reads clinical text.
 */
export default function CompletedVisitFields({ visitId, stored, revisionCount, canCorrect, showsHistory }: CompletedVisitFieldsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return (
    <>
      {isEditing ? (
        <CorrectionForm visitId={visitId} stored={stored} onDone={() => setIsEditing(false)} />
      ) : (
        FIELDS.map((field) => (
          <Field key={field.key} id={`visit-form-${field.key}`} label={field.label}>
            <TextArea value={stored[field.key]} placeholder={field.placeholder} readOnly />
          </Field>
        ))
      )}

      {((showsHistory && revisionCount > 0) || (canCorrect && !isEditing)) && (
        <div className="flex flex-wrap items-center gap-2">
          {showsHistory && revisionCount > 0 && (
            <>
              <Badge appearance="soft" tone="copper">
                {T.correctedChip}
              </Badge>
              <Button variant="secondary" size="sm" onClick={() => setIsHistoryOpen(true)}>
                {correctionHistoryLabel(revisionCount)}
              </Button>
            </>
          )}
          {canCorrect && !isEditing && (
            <Button variant="secondary" size="sm" className="ms-auto" onClick={() => setIsEditing(true)}>
              {T.correctAction}
            </Button>
          )}
        </div>
      )}

      {isHistoryOpen && <CorrectionHistorySheet visitId={visitId} onDismiss={() => setIsHistoryOpen(false)} />}
    </>
  );
}

/** "تعديل نموذج الزيارة": the two fields from the stored text, the reason, save and cancel. */
function CorrectionForm({ visitId, stored, onDone }: { visitId: string; stored: VisitFormFieldValues; onDone: () => void }) {
  const [values, setValues] = useState<VisitFormFieldValues>(stored);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await correctVisitForm(db, visitId, values, reason);
      onDone();
    } catch (caught) {
      setError(correctionErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      data-support-write
      aria-label={T.formTitle}
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-control border border-copper-line bg-card p-3"
      noValidate
    >
      <p className="text-xs font-bold text-copper-ink">{T.formTitle}</p>
      {FIELDS.map((field) => (
        <Field key={field.key} id={`visit-correction-${field.key}`} label={field.label}>
          <TextArea
            value={values[field.key]}
            placeholder={field.placeholder}
            onChange={(event) => {
              const value = event.target.value;
              setValues((prev) => ({ ...prev, [field.key]: value }));
            }}
          />
        </Field>
      ))}
      <Field id="visit-correction-reason" label={T.reasonLabel}>
        <TextArea
          value={reason}
          placeholder={T.reasonPlaceholder}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" className="flex-1" disabled={isSaving}>
          {T.save}
        </Button>
        <Button variant="secondary" size="sm" disabled={isSaving} onClick={onDone}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}
