import { useEffect, useMemo, useRef, useState } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import { SheetPanelBody, SheetPanelFoot } from "../../components/ui/SheetPanel";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { searchPatients } from "../../db/patientSearch";
import type { Patient, Practitioner, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { addToQueue } from "../../db/visitQueue";
import { bookExistingPatientVisit } from "../../db/visitBooking";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import { resolveServicePrice } from "../../domain/pricing";
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
import { formatServicePriceWholePounds, resolveSelectedService } from "./bookingServiceSelection";
import { buildBookingSheetTitle } from "./bookingSheetTitle";
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

// `.rr`/`.rr.new` reproduced on a <button>: full-width, flush against the
// list's own divide-y separators (see the results list below) rather than
// each row drawing its own border-bottom, which is equivalent except on the
// last row.
const RESULT_ROW_CLASS =
  "flex w-full flex-col px-[13px] py-[10px] text-start transition-colors duration-150 hover:bg-green-wash";
const NEW_PATIENT_ROW_CLASS =
  "flex w-full items-center px-[13px] py-[10px] text-start text-green transition-colors duration-150 " +
  "hover:bg-[color-mix(in_srgb,var(--color-green-wash)_60%,transparent)]";

// This task's own chip for a pickable time (slots, overbook): there is no
// dedicated reference class for it (screen 4's only mockup shows the search
// step, not this one), so it borrows the `.svc-row .svc` chip metrics for a
// visually consistent "wrapping row of pickable pills" look, minus the
// pressed/unpressed state ToggleChip's real "service" variant carries —
// picking a time here is a one-shot navigation, not a toggle.
const TIME_CHIP_CLASS =
  "rounded-control border-[1.5px] border-rule bg-field px-[14px] py-[7px] text-[12.5px] font-semibold text-muted " +
  "transition-colors duration-150 hover:border-green hover:bg-green-wash hover:text-green " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2";

const BACK_BUTTON_CLASS = "self-start text-[12.5px] font-semibold text-muted hover:text-green";

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
  /** More than one practitioner is visible today — the head names this one only then. */
  showPractitionerName: boolean;
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

/** `.svc-row .svc`'s own price text, e.g. "كشف عام · 400ج" — the caller supplies the resolved price. */
function serviceOptionLabel(service: Service, priceInPiastres: ReturnType<typeof resolveServicePrice>): string {
  return `${service.name} · ${formatServicePriceWholePounds(priceInPiastres)}${dayScreenStrings.shortCurrencySuffix}`;
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
  showPractitionerName,
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
  const overrides = useLiveQuery(() => db.service_price_overrides.toArray(), []) ?? [];

  function priceFor(candidate: Service): ReturnType<typeof resolveServicePrice> {
    return resolveServicePrice(candidate, overrides, { practitionerId: practitioner.id, locationId });
  }

  const chosenTime = step.kind === "confirm" ? step.time : null;
  const sheetTitle =
    mode === "walk_in"
      ? dayScreenStrings.walkInButtonLabel
      : isQueueMode
        ? dayScreenStrings.addToQueueButtonLabel
        : buildBookingSheetTitle(chosenTime, showPractitionerName ? practitioner.full_name : null);

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

  const serviceOptions = services.map((candidate) => ({
    value: candidate.id,
    label: serviceOptionLabel(candidate, priceFor(candidate)),
  }));

  return (
    <Sheet onDismiss={onDismiss}>
      <SheetHeader title={sheetTitle} onDismiss={onDismiss} />

      <SheetPanelBody>
        {step.kind === "search" && (
          <>
            <Field label={dayScreenStrings.bookingSearchLabel} id="booking-search">
              <TextInput
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={dayScreenStrings.bookingSearchPlaceholder}
              />
            </Field>
            {noScheduleMessage && <p className="text-[12.5px] text-muted">{noScheduleMessage}</p>}
            {(results.length > 0 || debouncedQuery.trim().length > 0) && (
              <div className="flex flex-col divide-y divide-hair overflow-hidden rounded-card border border-rule bg-card">
                {debouncedQuery.trim().length > 0 && results.length === 0 && (
                  <p className="p-3 text-center text-[12.5px] text-muted">{dayScreenStrings.bookingNoResults}</p>
                )}
                {results.map(({ patient, lastVisitDate }) => (
                  <button key={patient.id} type="button" onClick={() => goToSlotsOrAutoConfirm(patient)} className={RESULT_ROW_CLASS}>
                    <span className="text-[13.5px] font-semibold text-text">{patient.full_name}</span>
                    <span className="mt-px text-[11px] text-muted">
                      {lastVisitDate ? <Ltr>{formatCairoDisplayDate(lastVisitDate)}</Ltr> : dayScreenStrings.bookingFirstVisit}
                      {patient.phone && (
                        <>
                          {" · "}
                          <Ltr className="font-mono">{formatEgyptianPhoneForDisplay(patient.phone)}</Ltr>
                        </>
                      )}
                    </span>
                  </button>
                ))}
                {debouncedQuery.trim().length > 0 && (
                  <button type="button" onClick={handleOpenNewPatientForm} className={NEW_PATIENT_ROW_CLASS}>
                    {dayScreenStrings.newPatientButtonPrefix} «{query}»
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {step.kind === "new_patient" && (
          <>
            <button type="button" onClick={() => setStep({ kind: "search" })} className={BACK_BUTTON_CLASS}>
              {dayScreenStrings.bookingBackAction}
            </button>
            <Field label={dayScreenStrings.newPatientNamePlaceholder} id="booking-new-patient-name" error={newPatientSubmitted ? (nameError ?? undefined) : undefined}>
              <TextInput
                ref={nameInputRef}
                type="text"
                value={newPatientForm.fullName}
                onChange={(event) => setNewPatientForm((prev) => ({ ...prev, fullName: event.target.value }))}
                placeholder={dayScreenStrings.newPatientNamePlaceholder}
              />
            </Field>
            <Field
              label={dayScreenStrings.newPatientPhonePlaceholder}
              id="booking-new-patient-phone"
              error={newPatientSubmitted ? (phoneError ?? undefined) : undefined}
              hint={dayScreenStrings.newPatientOnlyNameRequiredHint}
            >
              <TextInput
                type="tel"
                inputMode="tel"
                value={newPatientForm.phone}
                disabled={newPatientForm.phoneOmitted}
                onChange={(event) => setNewPatientForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder={dayScreenStrings.newPatientPhonePlaceholder}
              />
            </Field>
          </>
        )}

        {step.kind === "slots" && (
          <>
            <button type="button" onClick={() => setStep({ kind: "search" })} className={BACK_BUTTON_CLASS}>
              {dayScreenStrings.bookingBackAction}
            </button>
            <p className="text-[13.5px] font-semibold text-text">{step.patient.full_name}</p>
            {emptySlots.length === 0 ? (
              <p className="p-3 text-center text-[12.5px] text-muted">
                {noScheduleMessage ?? dayScreenStrings.bookingNoEmptySlots}
              </p>
            ) : (
              <div className="flex flex-wrap gap-[6px]">
                {emptySlots.map((slot) => (
                  <button
                    key={slot.time}
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
                    className={TIME_CHIP_CLASS}
                  >
                    <Ltr>{slot.time}</Ltr>
                  </button>
                ))}
              </div>
            )}
            {schedule && emptySlots.length === 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  setStep({
                    kind: "overbook_time",
                    patient: step.patient,
                    newPatientAuditLogId: step.newPatientAuditLogId,
                  })
                }
              >
                {dayScreenStrings.overbookButtonLabel}
              </Button>
            )}
          </>
        )}

        {step.kind === "overbook_time" && (
          <>
            <button
              type="button"
              onClick={() => setStep({ kind: "slots", patient: step.patient, newPatientAuditLogId: step.newPatientAuditLogId })}
              className={BACK_BUTTON_CLASS}
            >
              {dayScreenStrings.bookingBackAction}
            </button>
            <p className="text-[13.5px] font-semibold text-text">{dayScreenStrings.overbookPickerHeading}</p>
            <div className="flex flex-wrap gap-[6px]">
              {overbookTimeChoices.map((time) => (
                <button
                  key={time}
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
                  className={TIME_CHIP_CLASS}
                >
                  <Ltr>{time}</Ltr>
                </button>
              ))}
            </div>
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
              className={BACK_BUTTON_CLASS}
            >
              {dayScreenStrings.bookingBackAction}
            </button>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold text-text">{step.patient.full_name}</span>
              <span className="text-[12px] text-muted">
                <Ltr>{step.time}</Ltr>
              </span>
            </div>
            {services.length >= 2 && (
              <Field label={dayScreenStrings.bookingServiceFieldLabel} id="booking-service-confirm">
                <ToggleGroup
                  variant="service"
                  label={dayScreenStrings.bookingServiceFieldLabel}
                  value={service.id}
                  onChange={setSelectedServiceId}
                  options={serviceOptions}
                />
              </Field>
            )}
          </>
        )}

        {step.kind === "confirm_queue" && service && (
          <>
            <button type="button" onClick={() => setStep({ kind: "search" })} className={BACK_BUTTON_CLASS}>
              {dayScreenStrings.bookingBackAction}
            </button>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold text-text">{step.patient.full_name}</span>
              <span className="text-[12px] text-muted">
                {dayScreenStrings.addToQueueConfirmPrefix} <Ltr>{step.position}</Ltr>
              </span>
            </div>
            {services.length >= 2 && (
              <Field label={dayScreenStrings.bookingServiceFieldLabel} id="booking-service-confirm-queue">
                <ToggleGroup
                  variant="service"
                  label={dayScreenStrings.bookingServiceFieldLabel}
                  value={service.id}
                  onChange={setSelectedServiceId}
                  options={serviceOptions}
                />
              </Field>
            )}
          </>
        )}
      </SheetPanelBody>

      {step.kind === "new_patient" && (
        <SheetPanelFoot>
          <Button variant="primary" className="flex-1" disabled={isCreatingPatient} onClick={handleCreatePatient}>
            {dayScreenStrings.newPatientSubmitButton}
          </Button>
          <Button
            type="button"
            variant={newPatientForm.phoneOmitted ? "secondary" : "outline"}
            aria-pressed={newPatientForm.phoneOmitted}
            onClick={handleTogglePhoneOmitted}
          >
            {dayScreenStrings.newPatientNoPhoneToggle}
          </Button>
        </SheetPanelFoot>
      )}

      {step.kind === "confirm" && service && (
        <SheetPanelFoot>
          <Button
            variant="primary"
            className="flex-1"
            disabled={isConfirming}
            onClick={() => handleConfirm(step.patient, step.time, step.isOverbooked, step.newPatientAuditLogId)}
          >
            {dayScreenStrings.bookingConfirmButton}
          </Button>
        </SheetPanelFoot>
      )}

      {step.kind === "confirm_queue" && service && (
        <SheetPanelFoot>
          <Button
            variant="primary"
            className="flex-1"
            disabled={isConfirming}
            onClick={() => handleConfirmQueue(step.patient, step.newPatientAuditLogId)}
          >
            {dayScreenStrings.addToQueueConfirmButton}
          </Button>
        </SheetPanelFoot>
      )}
    </Sheet>
  );
}
