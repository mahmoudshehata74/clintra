import { useEffect, useMemo, useRef, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { searchPatients } from "../../db/patientSearch";
import type { Patient, Practitioner, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { addToQueue } from "../../db/visitQueue";
import { bookExistingPatientVisit } from "../../db/visitBooking";
import { toArabicIndicDigits } from "../../domain/arabicNumerals";
import { generateTimeChoices } from "../../domain/schedule";
import { ScheduleMode } from "../../domain/scheduleMode";
import type { ClinicDay, ClockTime } from "../../domain/time";
import { clockTimeInCairo, formatCairoDisplayDate } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import {
  computeBookableSlots,
  findNextSlotAtOrAfter,
  resolveBookingScheduleNote,
} from "./bookingAvailability";
import {
  seedNewPatientFormFromQuery,
  validateNewPatientForm,
  type NewPatientFormState,
} from "./newPatientForm";
import { submitNewPatientForm } from "./newPatientSubmission";
import type { DayScheduleState } from "./scheduleState";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";
import type { UndoAction } from "./undoAction";

const SEARCH_DEBOUNCE_MS = 120;
const OVERBOOK_STEP_MINUTES = 15;

type Step =
  | { kind: "search" }
  | { kind: "new_patient" }
  | { kind: "slots"; patient: Patient; newPatientAuditLogId?: string }
  | { kind: "overbook_time"; patient: Patient; newPatientAuditLogId?: string }
  | {
      kind: "confirm";
      patient: Patient;
      time: ClockTime;
      isOverbooked: boolean;
      newPatientAuditLogId?: string;
    }
  | { kind: "confirm_queue"; patient: Patient; position: number; newPatientAuditLogId?: string };

export type BookingSheetMode = "booking" | "walk_in";

interface BookingSheetProps {
  practitioner: Practitioner;
  scheduleState: DayScheduleState;
  visitsForPractitioner: readonly Visit[];
  locationId: string;
  orgId: string;
  service: Service;
  visitDate: ClinicDay;
  /** "walk_in" books already-arrived, source walkin, and defaults to the next empty slot from now. */
  mode: BookingSheetMode;
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
  mode,
  onDismiss,
  onBooked,
  onCollision,
}: BookingSheetProps) {
  const [step, setStep] = useState<Step>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [newPatientForm, setNewPatientForm] = useState<NewPatientFormState>(EMPTY_NEW_PATIENT_FORM);
  const [newPatientSubmitted, setNewPatientSubmitted] = useState(false);
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
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

  const schedule = scheduleState.kind === "scheduled" ? scheduleState.schedule : null;
  const noScheduleMessage = resolveBookingScheduleNote(scheduleState);

  const results = useLiveQuery(() => searchPatients(db, debouncedQuery), [debouncedQuery]) ?? [];
  const emptySlots = useMemo(
    () => computeBookableSlots(scheduleState, visitsForPractitioner),
    [scheduleState, visitsForPractitioner],
  );
  const overbookTimeChoices = useMemo(() => (schedule ? generateTimeChoices(schedule, OVERBOOK_STEP_MINUTES) : []), [
    schedule,
  ]);

  const newPatientValidation = validateNewPatientForm(newPatientForm);
  const nameError = !newPatientValidation.ok ? newPatientValidation.nameError : null;
  const phoneError = !newPatientValidation.ok ? newPatientValidation.phoneError : null;

  function goToSlotsOrAutoConfirm(patient: Patient, newPatientAuditLogId?: string) {
    if (schedule?.mode === ScheduleMode.Queue) {
      const position = visitsForPractitioner.reduce((max, visit) => Math.max(max, visit.position), 0) + 1;
      setStep({ kind: "confirm_queue", patient, position, newPatientAuditLogId });
      return;
    }
    if (mode === "walk_in") {
      const nowTime = clockTimeInCairo(new Date().toISOString());
      const nextSlot = findNextSlotAtOrAfter(emptySlots, nowTime);
      if (nextSlot) {
        setStep({ kind: "confirm", patient, time: nextSlot, isOverbooked: false, newPatientAuditLogId });
        return;
      }
    }
    setStep({ kind: "slots", patient, newPatientAuditLogId });
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
      goToSlotsOrAutoConfirm(result.patient, result.auditLogId);
    } finally {
      setIsCreatingPatient(false);
    }
  }

  async function handleConfirm(
    patient: Patient,
    time: ClockTime,
    isOverbooked: boolean,
    newPatientAuditLogId: string | undefined,
  ) {
    // Unreachable in practice: both the slots list and the overbook time
    // choices are only ever non-empty when schedule is set.
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
        time,
        schedule,
        status: mode === "walk_in" ? VisitStatus.Arrived : undefined,
        source: mode === "walk_in" ? VisitSource.Walkin : undefined,
        isOverbooked,
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
      setStep(
        isOverbooked
          ? { kind: "overbook_time", patient, newPatientAuditLogId }
          : { kind: "slots", patient, newPatientAuditLogId },
      );
    } finally {
      setIsConfirming(false);
    }
  }

  async function handleConfirmQueue(patient: Patient, newPatientAuditLogId: string | undefined) {
    setIsConfirming(true);
    try {
      const result = await addToQueue(db, {
        practitionerId: practitioner.id,
        locationId,
        orgId,
        patientId: patient.id,
        serviceId: service.id,
        visitDate,
        status: mode === "walk_in" ? VisitStatus.Arrived : undefined,
        source: mode === "walk_in" ? VisitSource.Walkin : undefined,
      });

      onBooked(
        newPatientAuditLogId
          ? { kind: "new_patient_visit", visitAuditLogId: result.auditLogId, patientAuditLogId: newPatientAuditLogId }
          : { kind: "visit", auditLogId: result.auditLogId },
      );
      onDismiss();
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <Sheet onDismiss={onDismiss}>
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
                  onClick={() => goToSlotsOrAutoConfirm(patient)}
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
              {newPatientSubmitted && nameError && <p className="mt-1 text-sm text-red">{nameError}</p>}
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
              {newPatientSubmitted && phoneError && <p className="mt-1 text-sm text-red">{phoneError}</p>}
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
                      time: slot.time,
                      isOverbooked: false,
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
          {schedule && emptySlots.length === 0 && (
            <button
              type="button"
              onClick={() =>
                setStep({
                  kind: "overbook_time",
                  patient: step.patient,
                  newPatientAuditLogId: step.newPatientAuditLogId,
                })
              }
              className="mt-2 rounded-[--radius-el] border border-dashed border-line px-4 py-3 text-center text-muted"
            >
              {dayScreenStrings.overbookButtonLabel}
            </button>
          )}
        </>
      )}

      {step.kind === "overbook_time" && (
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
          <p className="mt-1 font-medium">{dayScreenStrings.overbookPickerHeading}</p>
          <ul className="mt-3 flex flex-col gap-1 overflow-y-auto">
            {overbookTimeChoices.map((time) => (
              <li key={time}>
                <button
                  type="button"
                  onClick={() =>
                    setStep({
                      kind: "confirm",
                      patient: step.patient,
                      time,
                      isOverbooked: true,
                      newPatientAuditLogId: step.newPatientAuditLogId,
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-[--radius-el] border border-line p-3 text-start"
                >
                  <span className="text-muted">
                    <Ltr>{time}</Ltr>
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
              setStep(
                step.isOverbooked
                  ? { kind: "overbook_time", patient: step.patient, newPatientAuditLogId: step.newPatientAuditLogId }
                  : { kind: "slots", patient: step.patient, newPatientAuditLogId: step.newPatientAuditLogId },
              )
            }
            className="self-start text-sm text-muted"
          >
            {dayScreenStrings.bookingBackAction}
          </button>
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-lg">{step.patient.full_name}</span>
            <span className="text-muted">{service.name}</span>
            <span className="text-muted">
              <Ltr>{step.time}</Ltr>
            </span>
          </div>
          <button
            type="button"
            disabled={isConfirming}
            onClick={() => handleConfirm(step.patient, step.time, step.isOverbooked, step.newPatientAuditLogId)}
            className="mt-4 rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
          >
            {dayScreenStrings.bookingConfirmButton}
          </button>
        </>
      )}

      {step.kind === "confirm_queue" && (
        <>
          <button
            type="button"
            onClick={() => setStep({ kind: "search" })}
            className="self-start text-sm text-muted"
          >
            {dayScreenStrings.bookingBackAction}
          </button>
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-lg">{step.patient.full_name}</span>
            <span className="text-muted">{service.name}</span>
            <span className="text-muted">
              {dayScreenStrings.addToQueueConfirmPrefix} {toArabicIndicDigits(step.position)}
            </span>
          </div>
          <button
            type="button"
            disabled={isConfirming}
            onClick={() => handleConfirmQueue(step.patient, step.newPatientAuditLogId)}
            className="mt-4 rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
          >
            {dayScreenStrings.addToQueueConfirmButton}
          </button>
        </>
      )}
    </Sheet>
  );
}
