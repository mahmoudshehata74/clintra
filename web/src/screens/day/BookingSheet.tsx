import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { searchPatients } from "../../db/patientSearch";
import type { Patient, Practitioner, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { bookExistingPatientVisit } from "../../db/visitBooking";
import type { ClinicDay } from "../../domain/time";
import { formatCairoDisplayDate } from "../../domain/time";
import { computeBookableSlots, resolveBookingScheduleNote } from "./bookingAvailability";
import type { EmptySlot } from "./emptySlots";
import {
  seedNewPatientFormFromQuery,
  validateNewPatientForm,
  type NewPatientFormState,
} from "./newPatientForm";
import { submitNewPatientForm } from "./newPatientSubmission";
import type { DayScheduleState } from "./scheduleState";
import { dayScreenStrings } from "./strings";
import type { UndoAction } from "./undoAction";

const SEARCH_DEBOUNCE_MS = 120;
const DRAG_DISMISS_THRESHOLD_PX = 80;

type Step =
  | { kind: "search" }
  | { kind: "new_patient" }
  | { kind: "slots"; patient: Patient; newPatientAuditLogId?: string }
  | { kind: "confirm"; patient: Patient; slot: EmptySlot; newPatientAuditLogId?: string };

interface BookingSheetProps {
  practitioner: Practitioner;
  scheduleState: DayScheduleState;
  visitsForPractitioner: readonly Visit[];
  locationId: string;
  orgId: string;
  service: Service;
  visitDate: ClinicDay;
  onDismiss: () => void;
  onBooked: (undo: UndoAction) => void;
  onCollision: () => void;
}

const EMPTY_NEW_PATIENT_FORM: NewPatientFormState = { fullName: "", phone: "", phoneOmitted: false };

export default function BookingSheet({
  practitioner,
  scheduleState,
  visitsForPractitioner,
  locationId,
  orgId,
  service,
  visitDate,
  onDismiss,
  onBooked,
  onCollision,
}: BookingSheetProps) {
  const [step, setStep] = useState<Step>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState<NewPatientFormState>(EMPTY_NEW_PATIENT_FORM);
  const [newPatientSubmitted, setNewPatientSubmitted] = useState(false);
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const dragStartYRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (step.kind === "new_patient") {
      nameInputRef.current?.focus();
    }
  }, [step.kind]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  const schedule = scheduleState.kind === "scheduled" ? scheduleState.schedule : null;
  const noScheduleMessage = resolveBookingScheduleNote(scheduleState);

  const results = useLiveQuery(() => searchPatients(db, debouncedQuery), [debouncedQuery]) ?? [];
  const emptySlots = useMemo(
    () => computeBookableSlots(scheduleState, visitsForPractitioner),
    [scheduleState, visitsForPractitioner],
  );

  const newPatientValidation = validateNewPatientForm(newPatientForm);
  const nameError = !newPatientValidation.ok ? newPatientValidation.nameError : null;
  const phoneError = !newPatientValidation.ok ? newPatientValidation.phoneError : null;

  function handleHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    setIsDragging(true);
    dragStartYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleHandlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging || dragStartYRef.current === null) {
      return;
    }
    setDragY(Math.max(0, event.clientY - dragStartYRef.current));
  }

  function handleHandlePointerUp() {
    if (!isDragging) {
      return;
    }
    setIsDragging(false);
    dragStartYRef.current = null;
    if (dragY > DRAG_DISMISS_THRESHOLD_PX) {
      onDismiss();
    } else {
      setDragY(0);
    }
  }

  function handleOpenNewPatientForm() {
    setNewPatientForm({ ...seedNewPatientFormFromQuery(query), phoneOmitted: false });
    setNewPatientSubmitted(false);
    setStep({ kind: "new_patient" });
  }

  function handleTogglePhoneOmitted() {
    setNewPatientForm((prev) => {
      const phoneOmitted = !prev.phoneOmitted;
      return { ...prev, phoneOmitted, phone: phoneOmitted ? "" : prev.phone };
    });
  }

  async function handleCreatePatient() {
    setNewPatientSubmitted(true);
    setIsCreatingPatient(true);
    try {
      const result = await submitNewPatientForm(db, orgId, newPatientForm);
      if (!result.ok) {
        return;
      }
      setStep({ kind: "slots", patient: result.patient, newPatientAuditLogId: result.auditLogId });
    } finally {
      setIsCreatingPatient(false);
    }
  }

  async function handleConfirm(patient: Patient, slot: EmptySlot, newPatientAuditLogId: string | undefined) {
    // Unreachable in practice: emptySlots is only ever non-empty when
    // schedule is set, and this is only called with a slot drawn from it.
    if (!schedule) {
      return;
    }
    setIsConfirming(true);
    try {
      const result = await bookExistingPatientVisit(db, {
        practitionerId: practitioner.id,
        locationId,
        orgId,
        patientId: patient.id,
        serviceId: service.id,
        visitDate,
        time: slot.time,
        schedule,
      });

      if (result.ok) {
        onBooked(
          newPatientAuditLogId
            ? { kind: "new_patient_visit", visitAuditLogId: result.auditLogId, patientAuditLogId: newPatientAuditLogId }
            : { kind: "visit", auditLogId: result.auditLogId },
        );
        onDismiss();
        return;
      }

      onCollision();
      setStep({ kind: "slots", patient, newPatientAuditLogId });
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-40 z-20">
      <div className="absolute inset-0 bg-ink/40" onClick={onDismiss} aria-hidden="true" />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-t-[--radius-frame] border border-line bg-paper px-4 pb-6 pt-2 shadow-lg"
        style={{
          transform: `translateY(${dragY}px)`,
          transition: isDragging ? "none" : "transform 150ms ease-out",
        }}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="mx-auto mb-2 h-1.5 w-12 shrink-0 touch-none rounded-full bg-line"
          onPointerDown={handleHandlePointerDown}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={handleHandlePointerUp}
          onPointerCancel={handleHandlePointerUp}
        />

        {step.kind === "search" && (
          <>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dayScreenStrings.bookingSearchPlaceholder}
              className="w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
            />
            {noScheduleMessage && <p className="mt-2 text-sm text-muted">{noScheduleMessage}</p>}
            <ul className="mt-3 flex flex-col gap-1 overflow-y-auto">
              {debouncedQuery.trim().length > 0 && results.length === 0 && (
                <li className="flex flex-col gap-3 p-3">
                  <span className="text-center text-muted">{dayScreenStrings.bookingNoResults}</span>
                  <button
                    type="button"
                    onClick={handleOpenNewPatientForm}
                    className="rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper"
                  >
                    {dayScreenStrings.newPatientButtonLabel}
                  </button>
                </li>
              )}
              {results.map(({ patient, lastVisitDate }) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    onClick={() => setStep({ kind: "slots", patient })}
                    className="flex w-full flex-col items-start rounded-[--radius-el] border border-line p-3 text-start"
                  >
                    <span>{patient.full_name}</span>
                    <span className="text-sm text-muted">
                      {lastVisitDate ? (
                        <Ltr>{formatCairoDisplayDate(lastVisitDate)}</Ltr>
                      ) : (
                        dayScreenStrings.bookingFirstVisit
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step.kind === "new_patient" && (
          <>
            <button
              type="button"
              onClick={() => setStep({ kind: "search" })}
              className="self-start text-sm text-muted"
            >
              {dayScreenStrings.bookingBackAction}
            </button>
            <div className="mt-2 flex flex-col gap-3">
              <div>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={newPatientForm.fullName}
                  onChange={(event) =>
                    setNewPatientForm((prev) => ({ ...prev, fullName: event.target.value }))
                  }
                  placeholder={dayScreenStrings.newPatientNamePlaceholder}
                  className="w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
                />
                {newPatientSubmitted && nameError && (
                  <p className="mt-1 text-sm text-red">{nameError}</p>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <input
                    type="tel"
                    inputMode="tel"
                    value={newPatientForm.phone}
                    disabled={newPatientForm.phoneOmitted}
                    onChange={(event) =>
                      setNewPatientForm((prev) => ({ ...prev, phone: event.target.value }))
                    }
                    placeholder={dayScreenStrings.newPatientPhonePlaceholder}
                    className="flex-1 rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start disabled:bg-line disabled:text-muted"
                  />
                  <button
                    type="button"
                    onClick={handleTogglePhoneOmitted}
                    aria-pressed={newPatientForm.phoneOmitted}
                    className={
                      newPatientForm.phoneOmitted
                        ? "shrink-0 rounded-[--radius-el] border border-green bg-green-soft px-3 py-2 text-sm font-semibold text-green"
                        : "shrink-0 rounded-[--radius-el] border border-line px-3 py-2 text-sm text-muted"
                    }
                  >
                    {dayScreenStrings.newPatientNoPhoneToggle}
                  </button>
                </div>
                {newPatientSubmitted && phoneError && (
                  <p className="mt-1 text-sm text-red">{phoneError}</p>
                )}
              </div>

              <p className="text-sm text-muted">{dayScreenStrings.newPatientOnlyNameRequiredHint}</p>
            </div>

            <button
              type="button"
              disabled={isCreatingPatient}
              onClick={handleCreatePatient}
              className="mt-4 rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
            >
              {dayScreenStrings.newPatientSubmitButton}
            </button>
          </>
        )}

        {step.kind === "slots" && (
          <>
            <button
              type="button"
              onClick={() => setStep({ kind: "search" })}
              className="self-start text-sm text-muted"
            >
              {dayScreenStrings.bookingBackAction}
            </button>
            <p className="mt-1 font-medium">{step.patient.full_name}</p>
            <ul className="mt-3 flex flex-col gap-1 overflow-y-auto">
              {emptySlots.length === 0 && (
                <li className="p-3 text-center text-muted">
                  {noScheduleMessage ?? dayScreenStrings.bookingNoEmptySlots}
                </li>
              )}
              {emptySlots.map((slot) => (
                <li key={slot.time}>
                  <button
                    type="button"
                    onClick={() =>
                      setStep({
                        kind: "confirm",
                        patient: step.patient,
                        slot,
                        newPatientAuditLogId: step.newPatientAuditLogId,
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-[--radius-el] border border-line p-3 text-start"
                  >
                    <span className="text-muted">
                      <Ltr>{slot.time}</Ltr>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step.kind === "confirm" && (
          <>
            <button
              type="button"
              onClick={() =>
                setStep({ kind: "slots", patient: step.patient, newPatientAuditLogId: step.newPatientAuditLogId })
              }
              className="self-start text-sm text-muted"
            >
              {dayScreenStrings.bookingBackAction}
            </button>
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-lg">{step.patient.full_name}</span>
              <span className="text-muted">{service.name}</span>
              <span className="text-muted">
                <Ltr>{step.slot.time}</Ltr>
              </span>
            </div>
            <button
              type="button"
              disabled={isConfirming}
              onClick={() => handleConfirm(step.patient, step.slot, step.newPatientAuditLogId)}
              className="mt-4 rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
            >
              {dayScreenStrings.bookingConfirmButton}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
