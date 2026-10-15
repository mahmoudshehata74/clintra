import { useEffect, useRef, useState, type FormEvent } from "react";
import { useGuardedActingMembership } from "../../auth/useActingMembership";
import Ltr from "../../components/Ltr";
import RxDoseText from "./RxDoseText";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import { CardFooter } from "../../components/ui/Card";
import Field, { TextArea, TextInput } from "../../components/ui/Field";
import { db } from "../../db/database";
import {
  addPrescriptionItem,
  removePrescriptionItem,
  updatePrescriptionItem,
  type PrescriptionItemFields,
} from "../../db/prescriptions";
import type { Patient, Prescription, PrescriptionItem, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import {
  EMPTY_VISIT_FORM_VALUES,
  findGeneralFormDefinition,
  readVisitFormValues,
  saveVisitFormField,
  type VisitFormFieldKey,
  type VisitFormFieldValues,
} from "../../db/visitForm";
import { VisitStatus } from "../../domain/visitStatus";
import CarePlanEntry from "../carePlan/CarePlanEntry";
import { dayScreenStrings } from "../day/strings";
import PatientProfileSheet from "../patient/PatientProfileSheet";
import type { ProfileTab } from "../patient/profileModel";
import { patientProfileStrings } from "../patient/strings";
import PrescriptionPrintSheet from "../prescription/PrescriptionPrintSheet";
import { computeRxPrintState } from "../prescription/printModel";
import { visitWorkspaceStrings as T } from "./strings";
import {
  buildVisitHistory,
  computeRxAccess,
  countPhrase,
  priorCompletedVisits,
  RX_COUNT_FORMS,
  rxDoseLine,
  rxErrorMessage,
  sessionLengthPhrase,
  sessionMinutes,
  sortRxItems,
  summarizePatient,
  visitHistoryHeading,
  VISIT_HISTORY_LIMIT,
  type RxErrorMessage,
} from "./workspace";

/** How the caller closes the visit — its own write path and cooldown, unchanged. */
export interface VisitCompletion {
  onComplete: (visit: Visit) => void;
  isCoolingDown: (visitId: string) => boolean;
  /** The caller's own explained failure (device_series_unknown), shown in the run row. */
  error?: string | null;
}

interface VisitWorkspaceProps {
  visitId: string;
  /** "sheet" pins the run row to the bottom of the sheet's own scroll; "page" leaves it at the end of the card. */
  layout: "sheet" | "page";
  /** "حفظ ومتابعة لاحقًا", once the field being typed into has been saved. */
  onClose: () => void;
  completion: VisitCompletion;
}

interface WorkspaceData {
  visit: Visit;
  patient: Patient | undefined;
  values: VisitFormFieldValues;
  prior: Visit[];
  formValuesByVisitId: Map<string, VisitFormFieldValues>;
  drugNamesByVisitId: Map<string, string[]>;
  prescription: Prescription | undefined;
  items: PrescriptionItem[];
}

/** How long the muted "اتحفظ" hint stays under a field after its autosave commits. */
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
 * The visit workspace (reference screen 10, "الزيارة — النموذج المتكامل")
 * without its assistant panel (`.visit-aside` — no AI in v1, see
 * docs/design-rule.md): `.pt-summary` (its `.quick` buttons open the
 * patient profile, screen 18, on "زيارات" or "مدفوعات"), then the single
 * `.visit-main` column (`.plan-badge` or "ابدأ خطة رعاية" —
 * screens/carePlan/CarePlanEntry.tsx — `.visit-history`, the two `.field`s,
 * `.rx-section`), then `.runrow`.
 * Hosted by VisitFormSheet and by the "الزيارة الحالية" page.
 *
 * Reads everything itself via liveQuery; the host only names the visit and
 * how it closes. Complaint and diagnosis autosave per field on blur, as the
 * visit form always has; every prescription write goes through
 * db/prescriptions.ts, whose own rules the controls mirror (computeRxAccess,
 * and computeRxPrintState for the print button).
 */
export default function VisitWorkspace({ visitId, layout, onClose, completion }: VisitWorkspaceProps) {
  const actingPractitionerId = useGuardedActingMembership()?.practitioner_id ?? null;
  // Saves still in flight, so "حفظ ومتابعة لاحقًا" can wait for them; one
  // Set for the component's lifetime, mutated only from event handlers.
  const [pendingSaves] = useState(() => new Set<Promise<unknown>>());
  // The session length runs live while in the room; nothing else re-renders
  // it, so this ticks once a minute (the doctor's day's own pattern).
  const [, forceMinuteTick] = useState(0);
  const [profileTab, setProfileTab] = useState<ProfileTab | null>(null);

  useEffect(() => {
    const interval = setInterval(() => forceMinuteTick((tick) => tick + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const data = useLiveQuery<WorkspaceData | null>(async () => {
    const visit = await db.visits.get(visitId);
    if (!visit) {
      return null;
    }
    const [patient, formDefinition, allVisits, patientPrescriptions] = await Promise.all([
      db.patients.get(visit.patient_id),
      findGeneralFormDefinition(db),
      db.visits.toArray(),
      db.prescriptions.where("patient_id").equals(visit.patient_id).toArray(),
    ]);
    const prior = priorCompletedVisits(
      allVisits.filter((candidate) => candidate.patient_id === visit.patient_id),
      visit,
    );
    const shownVisitIds = [visit.id, ...prior.slice(0, VISIT_HISTORY_LIMIT).map((candidate) => candidate.id)];
    const shownPrescriptions = patientPrescriptions.filter((rx) => shownVisitIds.includes(rx.visit_id));
    const [formRows, itemRows] = await Promise.all([
      db.visit_form_data.where("visit_id").anyOf(shownVisitIds).toArray(),
      shownPrescriptions.length > 0
        ? db.prescription_items
            .where("prescription_id")
            .anyOf(shownPrescriptions.map((rx) => rx.id))
            .toArray()
        : Promise.resolve([]),
    ]);

    const formValuesByVisitId = new Map<string, VisitFormFieldValues>();
    for (const row of formRows) {
      if (row.form_definition_id === formDefinition.id) {
        formValuesByVisitId.set(row.visit_id, readVisitFormValues(row));
      }
    }
    const itemsByPrescriptionId = new Map<string, PrescriptionItem[]>();
    for (const item of itemRows) {
      itemsByPrescriptionId.set(item.prescription_id, [...(itemsByPrescriptionId.get(item.prescription_id) ?? []), item]);
    }
    const drugNamesByVisitId = new Map<string, string[]>();
    for (const rx of shownPrescriptions) {
      drugNamesByVisitId.set(
        rx.visit_id,
        sortRxItems(itemsByPrescriptionId.get(rx.id) ?? []).map((item) => item.name),
      );
    }
    const prescription = shownPrescriptions.find((rx) => rx.visit_id === visit.id);

    return {
      visit,
      patient,
      values: formValuesByVisitId.get(visit.id) ?? EMPTY_VISIT_FORM_VALUES,
      prior,
      formValuesByVisitId,
      drugNamesByVisitId,
      prescription,
      items: prescription ? sortRxItems(itemsByPrescriptionId.get(prescription.id) ?? []) : [],
    };
  }, [visitId]);

  if (!data) {
    return <p className="px-5 py-[18px] text-muted">{T.loadingLabel}</p>;
  }

  const { visit } = data;
  const now = new Date();
  const summary = summarizePatient(data.patient, data.prior, now);
  const history = buildVisitHistory(data.prior, data.formValuesByVisitId, data.drugNamesByVisitId);
  const access = computeRxAccess(actingPractitionerId, visit, data.prescription, data.items.length);
  const printState = data.prescription
    ? computeRxPrintState(actingPractitionerId, visit, data.prescription, data.items.length)
    : null;
  const print =
    data.prescription && printState?.isButtonShown
      ? { prescriptionId: data.prescription.id, label: printState.buttonLabel }
      : null;
  const minutes = sessionMinutes(visit, now);

  async function saveAndClose() {
    await Promise.all(pendingSaves);
    onClose();
  }

  const runRow = (
    <CardFooter
      count={
        minutes !== null && (
          <>
            {T.sessionLengthLabel} <b>{sessionLengthPhrase(minutes)}</b>
          </>
        )
      }
    >
      {visit.status === VisitStatus.InRoom && (
        <Button
          variant="primary"
          disabled={completion.isCoolingDown(visit.id)}
          onClick={() => completion.onComplete(visit)}
        >
          {T.closeVisit}
        </Button>
      )}
      <Button variant="secondary" onClick={() => void saveAndClose()}>
        {T.saveAndContinueLater}
      </Button>
      {completion.error && (
        <p role="alert" className="basis-full text-[12.5px] font-semibold text-danger">
          {completion.error}
        </p>
      )}
    </CardFooter>
  );

  return (
    <>
      {/* `.pt-summary` */}
      <div className="flex flex-wrap items-center gap-3.5 border-b border-copper-line bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-copper)_10%,var(--color-card))_0%,var(--color-card)_100%)] px-5 py-4">
        <div
          aria-hidden="true"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-card bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-[17px] font-bold text-on-copper"
        >
          {summary.initial}
        </div>
        <div className="min-w-[180px] flex-1">
          <div className="text-base font-bold tracking-[-0.01em] text-text">
            {summary.name}
            {summary.age !== null && (
              <>
                {" · "}
                <Ltr>{summary.age}</Ltr> {T.ageUnit}
              </>
            )}
          </div>
          <PatientMeta summary={summary} />
        </div>
        {data.patient && (
          // `.quick` — `.qbtn` × 2.
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setProfileTab("visits")} className={QUICK_BUTTON}>
              {patientProfileStrings.historyQuick}
            </button>
            <button type="button" onClick={() => setProfileTab("payments")} className={QUICK_BUTTON}>
              {patientProfileStrings.invoicesQuick}
            </button>
          </div>
        )}
      </div>
      {data.patient && profileTab && (
        <PatientProfileSheet patientId={data.patient.id} initialTab={profileTab} onDismiss={() => setProfileTab(null)} />
      )}

      {/* `.visit-main` */}
      <div className="flex flex-col gap-3.5 p-5">
        <CarePlanEntry visit={visit} />

        {history.length > 0 && (
          <section
            aria-label={visitHistoryHeading(history.length)}
            className="rounded-control border border-rule bg-field px-4 py-3"
          >
            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-muted">
              {visitHistoryHeading(history.length)}
            </div>
            <ul>
              {history.map((row) => (
                <li
                  key={row.visitId}
                  className="border-b border-dashed border-hair py-[5px] text-[12.5px] text-text last:border-b-0"
                >
                  <span className="me-2 font-mono text-[11px] text-muted tabular-nums">
                    <Ltr>{row.date}</Ltr>
                  </span>
                  <span className="font-semibold text-text">{row.title}</span>
                  {row.drugs && (
                    <>
                      {" — "}
                      <Ltr>{row.drugs}</Ltr>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <VisitFields key={visit.id} visitId={visit.id} stored={data.values} pendingSaves={pendingSaves} />

        {access.isShown && (
          <RxSection
            visitId={visit.id}
            items={data.items}
            canEdit={access.canEdit}
            readOnlyLine={access.readOnlyLine}
            print={print}
          />
        )}
      </div>

      {layout === "sheet" ? <div className="sticky bottom-0 z-10">{runRow}</div> : runRow}
    </>
  );
}

// `.pt-summary .qbtn` (its 8px radius on the control token).
const QUICK_BUTTON =
  "cursor-pointer appearance-none rounded-control border-[1.5px] border-rule bg-card px-2.5 py-[5px] font-[inherit] text-[11px] font-semibold text-muted transition-colors duration-150 hover:border-green-line hover:text-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green";

/** `.pt-summary .meta`: phone (mono, LTR) · visit count · last visit — each omitted without data. */
function PatientMeta({ summary }: { summary: ReturnType<typeof summarizePatient> }) {
  const parts = [
    summary.phone && (
      <span key="phone" className="font-mono text-muted">
        <Ltr>{summary.phone}</Ltr>
      </span>
    ),
    summary.visitCount && <span key="count">{summary.visitCount}</span>,
    summary.lastVisitRelative && (
      <span key="last">
        {T.lastVisitPrefix} {summary.lastVisitRelative}
      </span>
    ),
  ].filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return (
    <div className="mt-px text-[11.5px] text-muted">
      {parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}
    </div>
  );
}

// ── `.field` × 2 ──────────────────────────────────────────────────────────

interface VisitFieldsProps {
  visitId: string;
  /** The stored values, live. */
  stored: VisitFormFieldValues;
  /** Every save still in flight, so "حفظ ومتابعة لاحقًا" can wait for them. */
  pendingSaves: Set<Promise<unknown>>;
}

/**
 * Complaint and diagnosis (`.field` + `textarea.in`), autosaved on blur, no
 * save button — the visit form's behaviour, unchanged: a live update from
 * the database (this form's own committed save, another tab's write) never
 * overwrites the field being typed into.
 */
function VisitFields({ visitId, stored, pendingSaves }: VisitFieldsProps) {
  const [values, setValues] = useState<VisitFormFieldValues>(stored);
  const [justSaved, setJustSaved] = useState<Record<VisitFormFieldKey, boolean>>({
    complaint: false,
    diagnosis: false,
  });
  // Which field is mid-edit, as a ref: the hydration effect below must read
  // it without itself re-running on every focus change (that would refetch a
  // value the field's own save had not committed yet, visibly reverting what
  // the doctor just typed for an instant).
  const focusedFieldRef = useRef<VisitFormFieldKey | null>(null);
  const savedTimeouts = useRef<Partial<Record<VisitFormFieldKey, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    setValues((prev) => ({
      complaint: focusedFieldRef.current === "complaint" ? prev.complaint : stored.complaint,
      diagnosis: focusedFieldRef.current === "diagnosis" ? prev.diagnosis : stored.diagnosis,
    }));
  }, [stored]);

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

  async function handleBlur(field: VisitFormFieldKey) {
    focusedFieldRef.current = null;
    const value = values[field];
    if (value === stored[field]) {
      return;
    }
    const save = saveVisitFormField(db, visitId, field, value);
    pendingSaves.add(save);
    try {
      await save;
      markJustSaved(field);
    } finally {
      pendingSaves.delete(save);
    }
  }

  return (
    <>
      {FIELD_CONFIG.map((field) => (
        <Field
          key={field.key}
          id={`visit-form-${field.key}`}
          label={field.label}
          hint={justSaved[field.key] ? dayScreenStrings.visitFormSavedIndicator : undefined}
        >
          <TextArea
            value={values[field.key]}
            placeholder={field.placeholder}
            onChange={(event) => {
              focusedFieldRef.current = field.key;
              const value = event.target.value;
              setValues((prev) => ({ ...prev, [field.key]: value }));
            }}
            onFocus={() => {
              focusedFieldRef.current = field.key;
            }}
            onBlur={() => void handleBlur(field.key)}
          />
        </Field>
      ))}
    </>
  );
}

// ── `.rx-section` ────────────────────────────────────────────────────────

interface RxSectionProps {
  visitId: string;
  items: PrescriptionItem[];
  canEdit: boolean;
  readOnlyLine: string | null;
  /** "اطبع الوصفة" / "اطبع تاني" and what it opens; null when there is nothing to print. */
  print: { prescriptionId: string; label: string } | null;
}

/** Which inline form is open: one at a time. */
type RxEditor = { kind: "add" } | { kind: "edit"; itemId: string } | null;

/**
 * `.rx-section`: `.rx-head` with the count, `.rx-list` of `.rx-item`s, and
 * `.rx-add`. Tapping an item opens it for editing in place; "＋ أضف دواء"
 * opens the same form empty. Read-only (no add, edit or remove) whenever
 * computeRxAccess says a write would be refused. With a drug to print, its
 * print button opens the printed prescription (screen 16) for anyone who
 * sees the section; who may issue the first print is that sheet's to say.
 */
function RxSection({ visitId, items, canEdit, readOnlyLine, print }: RxSectionProps) {
  const [editor, setEditor] = useState<RxEditor>(null);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const openEditor = canEdit ? editor : null;

  async function remove(itemId: string) {
    setRemoveError(null);
    try {
      await removePrescriptionItem(db, itemId);
    } catch (error) {
      setRemoveError(rxErrorMessage(error).message);
    }
  }

  return (
    <section aria-label={T.rxHeading} className="mt-0.5 border-t border-dashed border-rule pt-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.05em] text-muted">{T.rxHeading}</span>
        {items.length > 0 && (
          <Badge appearance="soft" tone="copper" className="ms-auto">
            {countPhrase(items.length, RX_COUNT_FORMS)}
          </Badge>
        )}
      </div>

      {items.length > 0 && (
        <ul aria-label={T.rxHeading} className="flex flex-col gap-1.5">
          {items.map((item) =>
            openEditor?.kind === "edit" && openEditor.itemId === item.id ? (
              <li key={item.id}>
                <RxItemForm
                  initial={item}
                  confirmLabel={T.rxEditConfirm}
                  onSubmit={(fields) => updatePrescriptionItem(db, item.id, fields)}
                  onDone={() => setEditor(null)}
                />
              </li>
            ) : (
              <RxItemRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                onEdit={() => setEditor({ kind: "edit", itemId: item.id })}
                onRemove={() => void remove(item.id)}
              />
            ),
          )}
        </ul>
      )}

      {canEdit &&
        (openEditor?.kind === "add" ? (
          <div className="mt-2">
            <RxItemForm
              confirmLabel={T.rxAddConfirm}
              onSubmit={(fields) => addPrescriptionItem(db, visitId, fields)}
              onDone={() => setEditor(null)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditor({ kind: "add" })}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-control border-[1.5px] border-dashed border-copper-line bg-transparent px-3 py-[9px] font-[inherit] text-xs font-semibold text-copper-ink hover:border-solid hover:bg-copper-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            {T.rxAdd}
          </button>
        ))}

      {removeError && (
        <p role="alert" className="mt-2 text-[12.5px] text-danger">
          {removeError}
        </p>
      )}
      {readOnlyLine && <p className="mt-2 text-[11.5px] text-muted">{readOnlyLine}</p>}
      {print && (
        <div className="mt-2.5 flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => setIsPrintOpen(true)}>
            {print.label}
          </Button>
        </div>
      )}
      {print && isPrintOpen && (
        <PrescriptionPrintSheet prescriptionId={print.prescriptionId} onDismiss={() => setIsPrintOpen(false)} />
      )}
    </section>
  );
}

function RxItemRow({
  item,
  canEdit,
  onEdit,
  onRemove,
}: {
  item: PrescriptionItem;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const line = rxDoseLine(item);
  const content = (
    <>
      <div className="text-[13px] font-bold text-text">
        <Ltr>{item.name}</Ltr>
      </div>
      <div className="mt-0.5 text-[11px] text-muted tabular-nums">
        <RxDoseText line={line} strongClassName="font-semibold text-text" />
        {line.note && <span className="text-muted"> · {line.note}</span>}
      </div>
    </>
  );
  return (
    // `.rx-item`: the grid's default stretch, so `.rm` "حذف" spans the item's height.
    <li className="grid grid-cols-[1fr_auto] gap-2.5 rounded-control border border-rule bg-field px-3 py-2.5">
      {canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 cursor-pointer appearance-none bg-transparent p-0 text-start font-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green"
        >
          {content}
        </button>
      ) : (
        <div className="min-w-0">{content}</div>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer appearance-none rounded-control border border-danger-line bg-transparent px-2.5 py-1 font-[inherit] text-[11px] font-semibold text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          {T.rxRemove}
        </button>
      )}
    </li>
  );
}

interface RxItemFormProps {
  /** The item being edited; absent when adding. */
  initial?: PrescriptionItem;
  confirmLabel: string;
  onSubmit: (fields: PrescriptionItemFields) => Promise<unknown>;
  onDone: () => void;
}

type RxDraft = Record<"name" | "form" | "instructions" | "duration" | "note", string>;

/**
 * The inline add/edit form: name and instructions required, the rest
 * optional. The writer validates; its refusal shows under the field it is
 * about, or as one line under the form.
 */
function RxItemForm({ initial, confirmLabel, onSubmit, onDone }: RxItemFormProps) {
  const [draft, setDraft] = useState<RxDraft>({
    name: initial?.name ?? "",
    form: initial?.form ?? "",
    instructions: initial?.instructions ?? "",
    duration: initial?.duration ?? "",
    note: initial?.note ?? "",
  });
  const [error, setError] = useState<RxErrorMessage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const idPrefix = `rx-${initial?.id ?? "new"}`;

  function set(field: keyof RxDraft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    if (error?.field === field) {
      setError(null);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await onSubmit(draft);
      onDone();
    } catch (caught) {
      setError(rxErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  const fieldError = (field: "name" | "instructions") => (error?.field === field ? error.message : undefined);

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-control border border-copper-line bg-card p-3"
      noValidate
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={T.rxNameLabel} id={`${idPrefix}-name`} error={fieldError("name")}>
          <TextInput
            dir="ltr"
            value={draft.name}
            placeholder={T.rxNamePlaceholder}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <Field label={T.rxFormLabel} id={`${idPrefix}-form`}>
          <TextInput value={draft.form} placeholder={T.rxFormPlaceholder} onChange={(event) => set("form", event.target.value)} />
        </Field>
      </div>
      <Field label={T.rxInstructionsLabel} id={`${idPrefix}-instructions`} error={fieldError("instructions")}>
        <TextInput
          value={draft.instructions}
          placeholder={T.rxInstructionsPlaceholder}
          onChange={(event) => set("instructions", event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={T.rxDurationLabel} id={`${idPrefix}-duration`}>
          <TextInput
            value={draft.duration}
            placeholder={T.rxDurationPlaceholder}
            onChange={(event) => set("duration", event.target.value)}
          />
        </Field>
        <Field label={T.rxNoteLabel} id={`${idPrefix}-note`}>
          <TextInput value={draft.note} placeholder={T.rxNotePlaceholder} onChange={(event) => set("note", event.target.value)} />
        </Field>
      </div>
      {error && error.field === null && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" className="flex-1" disabled={isSaving}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="sm" onClick={onDone}>
          {T.rxCancel}
        </Button>
      </div>
    </form>
  );
}
