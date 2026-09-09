import { useEffect, useMemo, useRef, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { searchPatients } from "../../db/patientSearch";
import type { Patient, Practitioner, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { addToQueue } from "../../db/visitQueue";
import { bookExistingPatientVisit } from "../../db/visitBooking";
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
import { resolveSelectedService } from "./bookingServiceSelection";
import {
  seedNewPatientFormFromQuery,
  validateNewPatientForm,
  type NewPatientFormState,
} from "./newPatientForm";
import { submitNewPatientForm } from "./newPatientSubmission";
import type { DayScheduleState } from "./scheduleState";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
import { dayScreenStrings } from "./strings";
import type { UndoAction } from "./undoAction";

const SEARCH_DEBOUNCE_MS = 120;
const OVERBOOK_STEP_MINUTES = 15;

// The reference's .fld.on focus treatment: a pine border plus a soft
// green-tinted glow, applied to every text input in this sheet.
const FIELD_CLASS = "w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start focus:border-green focus:outline-none focus:ring-[3px] focus:ring-green-soft";
// The reference's disabled-field appearance: a filled, muted-looking field
// that reads as "intentionally skipped," not merely empty.
const FIELD_DISABLED_CLASS = "disabled:border-line disabled:bg-line-soft disabled:text-muted";

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
  /** Every active service on offer; the first is pre-selected, and any can be tapped before confirming. */
  services: readonly Service[];
  visitDate: ClinicDay;
  /** "walk_in" books already-arrived, source walkin, and defaults to the next empty slot from now. */
  mode: BookingSheetMode;
  /**
   * Set when the sheet was opened by tapping a specific empty slot on the
   * day grid: skips straight to the confirm step with this time once a
   * patient is chosen, rather than showing the full slot list — a shortcut,
   * not a different flow. Ignored in queue mode (no times to preset) and
   * superseded by walk-in's own "next slot from now" logic if both were
   * somehow set at once. Re-verified against the live empty-slot list at
   * the moment of use, since it may have gone stale while the sheet was
   * open searching for a patient.
   */
  presetTime?: ClockTime;
  onDismiss: () => void;
  onBooked: (undo: UndoAction) => void;
  onCollision: () => void;
}

const EMPTY_NEW_PATIENT_FORM: NewPatientFormState = { fullName: "", phone: "", phoneOmitted: false };

/** A compact tile matching the day grid's own empty-slot tile: time at the leading edge, a plus glyph, dashed border. */
function SlotTile({ time, onClick }: { time: ClockTime; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[--radius-el] border border-dashed border-line bg-paper p-3 text-start"
    >
      <span className="w-16 shrink-0 text-muted">
        <Ltr>{time}</Ltr>
      </span>
      <span className="flex flex-1 items-center justify-center text-xl text-muted" aria-hidden="true">
        +
      </span>
    </button>
  );
}

/** The reference's .bt.g pill: pine border and text when selected, plain otherwise. */
function servicePillClassName(isSelected: boolean): string {
  return isSelected
    ? "flex-1 rounded-[--radius-el] border border-green px-3 py-2 text-center text-sm text-green"
    : "flex-1 rounded-[--radius-el] border border-line px-3 py-2 text-center text-sm text-ink";
}

function ServicePicker({
  services,
  selectedServiceId,
  onSelect,
}: {
  services: readonly Service[];
  selectedServiceId: string;
  onSelect: (serviceId: string) => void;
}) {
  if (services.length < 2) {
    return null;
  }
  return (
    <div className="mt-3 flex gap-2">
      {services.map((service) => (
        <button
          key={service.id}
          type="button"
          onClick={() => onSelect(service.id)}
          className={servicePillClassName(service.id === selectedServiceId)}
        >
          {service.name}
        </button>
      ))}
    </div>
  );
}

export default function BookingSheet({
  practitioner,
  scheduleState,
  visitsForPractitioner,
  locationId,
  orgId,
  services,
  visitDate,
  mode,
  presetTime,
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
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
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
  const isQueueMode = schedule?.mode === ScheduleMode.Queue;
  const noScheduleMessage = resolveBookingScheduleNote(scheduleState);
  const service = resolveSelectedService(services, selectedServiceId);

  const sheetTitle =
    mode === "walk_in"
      ? dayScreenStrings.walkInButtonLabel
      : isQueueMode
        ? dayScreenStrings.addToQueueButtonLabel
        : dayScreenStrings.bookingButtonLabel;

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
    if (isQueueMode) {
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
    // The slot tapped to open this sheet, if it's still actually empty —
    // re-checked against the live list rather than trusted blindly, since
    // it may have been taken while the assistant was searching for a patient.
    if (presetTime && emptySlots.some((slot) => slot.time === presetTime)) {
      setStep({ kind: "confirm", patient, time: presetTime, isOverbooked: false, newPatientAuditLogId });
      return;
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
    // choices, and the service picker itself, are only ever shown when
    // schedule and service are both set.
    if (!schedule || !service) {
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
    if (!service) {
      return;
    }
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
      <SheetHeader title={sheetTitle} onDismiss={onDismiss} />

      {step.kind === "search" && (
        <>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={dayScreenStrings.bookingSearchPlaceholder}
            className={`mt-3 ${FIELD_CLASS}`}
          />
          {noScheduleMessage && <p className="mt-2 text-sm text-muted">{noScheduleMessage}</p>}
          <ul className="mt-3 flex flex-col divide-y divide-line-soft overflow-hidden overflow-y-auto rounded-[--radius-el] border border-line">
            {debouncedQuery.trim().length > 0 && results.length === 0 && (
              <li className="p-3 text-center text-sm text-muted">{dayScreenStrings.bookingNoResults}</li>
            )}
            {results.map(({ patient, lastVisitDate }) => (
              <li key={patient.id}>
                <button
                  type="button"
                  onClick={() => goToSlotsOrAutoConfirm(patient)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-start hover:bg-green-soft"
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
            {debouncedQuery.trim().length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={handleOpenNewPatientForm}
                  className="flex w-full items-center px-3 py-2.5 text-start text-green hover:bg-green-soft"
                >
                  {dayScreenStrings.newPatientButtonPrefix} «{query}»
                </button>
              </li>
            )}
          </ul>
        </>
      )}

      {step.kind === "new_patient" && (
        <>
          <button
            type="button"
            onClick={() => setStep({ kind: "search" })}
            className="mt-3 self-start text-sm text-muted"
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
                className={FIELD_CLASS}
              />
              {newPatientSubmitted && nameError && <p className="mt-1 text-sm text-red">{nameError}</p>}
            </div>

            <div>
              <input
                type="tel"
                inputMode="tel"
                value={newPatientForm.phone}
                disabled={newPatientForm.phoneOmitted}
                onChange={(event) =>
                  setNewPatientForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                placeholder={dayScreenStrings.newPatientPhonePlaceholder}
                className={`${FIELD_CLASS} ${FIELD_DISABLED_CLASS}`}
              />
              {newPatientSubmitted && phoneError && <p className="mt-1 text-sm text-red">{phoneError}</p>}
            </div>

            <p className="text-sm text-muted">{dayScreenStrings.newPatientOnlyNameRequiredHint}</p>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={isCreatingPatient}
              onClick={handleCreatePatient}
              className="flex-1 rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
            >
              {dayScreenStrings.newPatientSubmitButton}
            </button>
            <button
              type="button"
              onClick={handleTogglePhoneOmitted}
              aria-pressed={newPatientForm.phoneOmitted}
              className={
                newPatientForm.phoneOmitted
                  ? "shrink-0 rounded-[--radius-el] border border-green bg-green-soft px-3 py-2 text-sm font-semibold text-green"
                  : "shrink-0 rounded-[--radius-el] border border-line px-3 py-2 text-sm text-ink"
              }
            >
              {dayScreenStrings.newPatientNoPhoneToggle}
            </button>
          </div>
        </>
      )}

      {step.kind === "slots" && (
        <>
          <button
            type="button"
            onClick={() => setStep({ kind: "search" })}
            className="mt-3 self-start text-sm text-muted"
          >
            {dayScreenStrings.bookingBackAction}
          </button>
          <p className="mt-1 font-medium">{step.patient.full_name}</p>
          <ul className="mt-3 flex flex-col gap-2 overflow-y-auto">
            {emptySlots.length === 0 && (
              <li className="p-3 text-center text-muted">
                {noScheduleMessage ?? dayScreenStrings.bookingNoEmptySlots}
              </li>
            )}
            {emptySlots.map((slot) => (
              <li key={slot.time}>
                <SlotTile
                  time={slot.time}
                  onClick={() =>
                    setStep({
                      kind: "confirm",
                      patient: step.patient,
                      time: slot.time,
                      isOverbooked: false,
                      newPatientAuditLogId: step.newPatientAuditLogId,
                    })
                  }
                />
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
              className="mt-2 rounded-[--radius-el] border border-line bg-paper px-4 py-3 text-center text-ink"
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
            className="mt-3 self-start text-sm text-muted"
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

      {step.kind === "confirm" && service && (
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
            className="mt-3 self-start text-sm text-muted"
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
          <ServicePicker services={services} selectedServiceId={service.id} onSelect={setSelectedServiceId} />
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

      {step.kind === "confirm_queue" && service && (
        <>
          <button
            type="button"
            onClick={() => setStep({ kind: "search" })}
            className="mt-3 self-start text-sm text-muted"
          >
            {dayScreenStrings.bookingBackAction}
          </button>
          <div className="mt-2 flex flex-col gap-1">
            <span className="text-lg">{step.patient.full_name}</span>
            <span className="text-muted">{service.name}</span>
            <span className="text-muted">
              {dayScreenStrings.addToQueueConfirmPrefix} <Ltr>{step.position}</Ltr>
            </span>
          </div>
          <ServicePicker services={services} selectedServiceId={service.id} onSelect={setSelectedServiceId} />
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
