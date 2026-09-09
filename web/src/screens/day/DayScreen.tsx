import { useEffect, useMemo, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { setDayDelay } from "../../db/dayState";
import {
  undoMostRecentDayStateMutation,
  undoMostRecentInvoiceItemMutation,
  undoMostRecentInvoiceMutation,
  undoMostRecentPatientMutation,
  undoMostRecentPaymentMutation,
  undoMostRecentVisitMutation,
} from "../../db/mutate";
import { seedDatabase, seededVisitsDate } from "../../db/seed";
import type { ClinicDay, Location, Patient, Practitioner, Schedule, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitArrived, markVisitCompleted, markVisitInRoom } from "../../db/visitAttendance";
import { cancelVisit, markVisitNoShow, type VisitCancelReason } from "../../db/visitCancel";
import { ScheduleMode } from "../../domain/scheduleMode";
import { formatCairoDisplayDateParts, todayInCairo, weekdayOf } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import BookingSheet, { type BookingSheetMode } from "./BookingSheet";
import CancelVisitSheet from "./CancelVisitSheet";
import CashCloseSheet from "./CashCloseSheet";
import Counters from "./Counters";
import { computeDayCounters } from "./dayCounters";
import DelayControl from "./DelayControl";
import InvoiceSheet from "./InvoiceSheet";
import MoveVisitSheet from "./MoveVisitSheet";
import PaymentSheet from "./PaymentSheet";
import PractitionerColumn from "./PractitionerColumn";
import { resolveDayScheduleState } from "./scheduleState";
import { dayScreenStrings } from "./strings";
import SyncStatusChip from "./SyncStatusChip";
import type { UndoAction } from "./undoAction";
import UndoToast from "./UndoToast";

// Development-only: appending ?seedDay=1 to the URL pins the screen to the
// seed's fixed demo date instead of today, so the seeded visits (which no
// longer sit on "today" — see seed.ts) are reachable without a real date
// navigation screen. Remove this once one exists. No other query param, no
// UI, no persisted state: absence of the param leaves behaviour unchanged.
const SEED_DAY_QUERY_PARAM = "seedDay";

interface StaticData {
  locations: Location[];
  practitioners: Practitioner[];
  schedules: Schedule[];
  services: Service[];
  /** Only populated when ?seedDay=1 is present; see SEED_DAY_QUERY_PARAM. */
  seededDay: ClinicDay | null;
}

interface DynamicData {
  visits: Visit[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
  /** Which of today's visits have an invoice, and which — see db/visitCompletion.ts. */
  invoiceIdByVisitId: Map<string, string>;
}

const EMPTY_DYNAMIC_DATA: DynamicData = {
  visits: [],
  patientsById: new Map(),
  servicesById: new Map(),
  invoiceIdByVisitId: new Map(),
};

// The undo action stays available for five minutes after any of the writes
// below, per the specification. This is a UI-side mirror of the real
// enforcement inside the constrained undo mechanism; the toast disappearing
// here is a convenience, not the guarantee.
const UNDO_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_TOAST_MS = 4 * 1000;

interface ToastState {
  message: string;
  /** Present only when this message's mutation(s) can still be undone. */
  undo: UndoAction | null;
}

type RowActionSheetState = { kind: "cancel"; visit: Visit } | { kind: "move"; visit: Visit } | null;

function toggleButtonClass(isSelected: boolean): string {
  return isSelected
    ? "rounded-[--radius-el] border border-green bg-green-soft px-3 py-1 text-sm"
    : "rounded-[--radius-el] border border-line px-3 py-1 text-sm";
}

export default function DayScreen() {
  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [bookingSheetMode, setBookingSheetMode] = useState<BookingSheetMode | null>(null);
  const [openMenuVisitId, setOpenMenuVisitId] = useState<string | null>(null);
  const [rowActionSheet, setRowActionSheet] = useState<RowActionSheetState>(null);
  const [invoiceSheetInvoiceId, setInvoiceSheetInvoiceId] = useState<string | null>(null);
  const [paymentSheetInvoiceId, setPaymentSheetInvoiceId] = useState<string | null>(null);
  const [isCashCloseOpen, setIsCashCloseOpen] = useState(false);

  const isSeedDayPinned = new URLSearchParams(window.location.search).get(SEED_DAY_QUERY_PARAM) === "1";
  const today = isSeedDayPinned && staticData?.seededDay ? staticData.seededDay : todayInCairo();
  const weekday = weekdayOf(today);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await seedDatabase(db);
      const [locations, practitioners, schedules, services] = await Promise.all([
        db.locations.toArray(),
        db.practitioners.toArray(),
        db.schedules.toArray(),
        db.services.toArray(),
      ]);

      if (cancelled) {
        return;
      }

      const activeLocations = locations.filter((location) => location.is_active);
      const activePractitioners = practitioners.filter((practitioner) => practitioner.is_active);
      const activeServices = services.filter((service) => service.is_active);

      // Only read back the actual seeded date when the dev affordance is in
      // use: reading it from a real seeded visit rather than recomputing it
      // fresh, since recomputing "the most recent Monday" against a later
      // today would drift away from the date the seed actually wrote once
      // enough real time has passed.
      let seededDay: ClinicDay | null = null;
      if (isSeedDayPinned) {
        const anyVisit = await db.visits.toArray();
        seededDay = anyVisit[0]?.visit_date ?? seededVisitsDate();
      }

      setStaticData({
        locations: activeLocations,
        practitioners: activePractitioners,
        schedules,
        services: activeServices,
        seededDay,
      });
      setSelectedLocationId(activeLocations[0]?.id ?? null);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [isSeedDayPinned]);

  const practitionersToShow = useMemo(() => {
    if (!staticData) {
      return [];
    }
    if (selectedPractitionerId) {
      return staticData.practitioners.filter((practitioner) => practitioner.id === selectedPractitionerId);
    }
    return staticData.practitioners;
  }, [staticData, selectedPractitionerId]);

  // Live query: re-emits automatically whenever any write touches the visits
  // table (attendance, booking, cancel, no-show, move, or an undo of any of
  // them), so the row and the counters update without a manual refetch.
  const dynamicData =
    useLiveQuery<DynamicData>(async () => {
      if (!staticData || practitionersToShow.length === 0) {
        return EMPTY_DYNAMIC_DATA;
      }

      const visitsPerPractitioner = await Promise.all(
        practitionersToShow.map((practitioner) =>
          db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, today]).toArray(),
        ),
      );
      const visits = visitsPerPractitioner
        .flat()
        .filter((visit) => visit.location_id === selectedLocationId);

      const patientIds = [...new Set(visits.map((visit) => visit.patient_id))];
      const serviceIds = [
        ...new Set(
          visits
            .map((visit) => visit.service_id)
            .filter((serviceId): serviceId is string => serviceId != null),
        ),
      ];

      const visitIds = visits.map((visit) => visit.id);
      const [patients, services, invoicesForVisits] = await Promise.all([
        db.patients.bulkGet(patientIds),
        db.services.bulkGet(serviceIds),
        visitIds.length > 0 ? db.invoices.where("visit_id").anyOf(visitIds).toArray() : Promise.resolve([]),
      ]);

      const patientsById = new Map(
        patients.filter((patient): patient is Patient => patient != null).map((patient) => [patient.id, patient]),
      );
      const servicesById = new Map(
        services.filter((service): service is Service => service != null).map((service) => [service.id, service]),
      );
      const invoiceIdByVisitId = new Map<string, string>();
      for (const invoice of invoicesForVisits) {
        if (invoice.visit_id) {
          invoiceIdByVisitId.set(invoice.visit_id, invoice.id);
        }
      }

      return { visits, patientsById, servicesById, invoiceIdByVisitId };
    }, [staticData, practitionersToShow, today, selectedLocationId]) ?? EMPTY_DYNAMIC_DATA;

  // Resolved unconditionally (optional-chained) so it's stable for the
  // day_state live query below, which must run before any early return.
  const currentPractitionerId = selectedPractitionerId ?? staticData?.practitioners[0]?.id ?? null;

  const dayStateRow = useLiveQuery(async () => {
    if (!currentPractitionerId || !selectedLocationId) {
      return undefined;
    }
    return db.day_state
      .where("[practitioner_id+location_id+date]")
      .equals([currentPractitionerId, selectedLocationId, today])
      .first();
  }, [currentPractitionerId, selectedLocationId, today]);
  const delayMinutes = dayStateRow?.delay_minutes ?? 0;

  useEffect(() => {
    if (!toastState) {
      return;
    }
    const timeoutMs = toastState.undo ? UNDO_WINDOW_MS : MESSAGE_TOAST_MS;
    const timeout = setTimeout(() => setToastState(null), timeoutMs);
    return () => clearTimeout(timeout);
  }, [toastState]);

  async function handleAdvance(visit: Visit, toStatus: VisitStatus) {
    try {
      if (toStatus === VisitStatus.Arrived) {
        const auditLogId = await markVisitArrived(db, visit.id);
        setToastState({ message: dayScreenStrings.attendanceMarked, undo: { kind: "visit", auditLogId } });
        return;
      }
      if (toStatus === VisitStatus.InRoom) {
        const auditLogId = await markVisitInRoom(db, visit.id);
        setToastState({ message: dayScreenStrings.inRoomToastMessage, undo: { kind: "visit", auditLogId } });
        return;
      }
      // Completing also creates the visit's invoice in the same write (see
      // db/visitCompletion.ts) — the one-tap contract itself does not change.
      const result = await markVisitCompleted(db, visit.id);
      setToastState({
        message: dayScreenStrings.completedToastMessage,
        undo: {
          kind: "visit_completed",
          visitAuditLogId: result.visitAuditLogId,
          invoiceAuditLogId: result.invoiceAuditLogId,
          invoiceItemAuditLogId: result.invoiceItemAuditLogId,
        },
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function handleUndo() {
    const undo = toastState?.undo;
    if (!undo) {
      return;
    }
    try {
      if (undo.kind === "visit") {
        const outcome = await undoMostRecentVisitMutation(db, undo.auditLogId);
        setToastState(outcome.ok ? null : { message: dayScreenStrings.undoRefused, undo: null });
        return;
      }

      if (undo.kind === "day_state") {
        const outcome = await undoMostRecentDayStateMutation(db, undo.auditLogId);
        setToastState(outcome.ok ? null : { message: dayScreenStrings.undoRefused, undo: null });
        return;
      }

      if (undo.kind === "new_patient_visit") {
        // Two writes; undo reverses them in reverse order. The visit
        // references the patient, so removing the visit first avoids ever
        // leaving a dangling reference mid-undo.
        const visitOutcome = await undoMostRecentVisitMutation(db, undo.visitAuditLogId);
        if (!visitOutcome.ok) {
          setToastState({ message: dayScreenStrings.undoRefused, undo: null });
          return;
        }
        const patientOutcome = await undoMostRecentPatientMutation(db, undo.patientAuditLogId);
        if (!patientOutcome.ok) {
          // The visit is gone but the patient reversal failed: report this
          // plainly rather than silently leaving one of the two in place.
          setToastState({ message: dayScreenStrings.newPatientUndoPartialFailure, undo: null });
          return;
        }
        setToastState(null);
        return;
      }

      if (undo.kind === "visit_move") {
        // Reverse the new slot first, then the original visit.
        const newOutcome = await undoMostRecentVisitMutation(db, undo.newVisitAuditLogId);
        if (!newOutcome.ok) {
          setToastState({ message: dayScreenStrings.undoRefused, undo: null });
          return;
        }
        const oldOutcome = await undoMostRecentVisitMutation(db, undo.oldVisitAuditLogId);
        if (!oldOutcome.ok) {
          setToastState({ message: dayScreenStrings.moveUndoPartialFailure, undo: null });
          return;
        }
        setToastState(null);
        return;
      }

      if (undo.kind === "visit_completed") {
        // The invoice first: if it is stale (e.g. a payment has since been
        // recorded against it), refuse the whole undo rather than reverse
        // only part of it. Then the item, then the visit status itself.
        const invoiceOutcome = await undoMostRecentInvoiceMutation(db, undo.invoiceAuditLogId);
        if (!invoiceOutcome.ok) {
          setToastState({ message: dayScreenStrings.undoRefused, undo: null });
          return;
        }
        if (undo.invoiceItemAuditLogId) {
          const itemOutcome = await undoMostRecentInvoiceItemMutation(db, undo.invoiceItemAuditLogId);
          if (!itemOutcome.ok) {
            setToastState({ message: dayScreenStrings.visitCompletionUndoPartialFailure, undo: null });
            return;
          }
        }
        const visitOutcome = await undoMostRecentVisitMutation(db, undo.visitAuditLogId);
        if (!visitOutcome.ok) {
          setToastState({ message: dayScreenStrings.visitCompletionUndoPartialFailure, undo: null });
          return;
        }
        setToastState(null);
        return;
      }

      // payment: the invoice's paid/status update first (refuses cleanly if
      // a later payment has already changed it further), then the payment
      // row itself.
      const invoiceOutcome = await undoMostRecentInvoiceMutation(db, undo.invoiceAuditLogId);
      if (!invoiceOutcome.ok) {
        setToastState({ message: dayScreenStrings.undoRefused, undo: null });
        return;
      }
      const paymentOutcome = await undoMostRecentPaymentMutation(db, undo.paymentAuditLogId);
      if (!paymentOutcome.ok) {
        setToastState({ message: dayScreenStrings.paymentUndoPartialFailure, undo: null });
        return;
      }
      setToastState(null);
    } catch (error) {
      console.error(error);
    }
  }

  function handleBooked(undo: UndoAction) {
    setToastState({ message: dayScreenStrings.visitBooked, undo });
  }

  function handleBookingCollision() {
    setToastState({ message: dayScreenStrings.bookingSlotTakenError, undo: null });
  }

  function handleRequestMove(visit: Visit) {
    setOpenMenuVisitId(null);
    setRowActionSheet({ kind: "move", visit });
  }

  function handleRequestCancel(visit: Visit) {
    setOpenMenuVisitId(null);
    setRowActionSheet({ kind: "cancel", visit });
  }

  async function handleMarkNoShow(visit: Visit) {
    setOpenMenuVisitId(null);
    try {
      const auditLogId = await markVisitNoShow(db, visit.id);
      setToastState({ message: dayScreenStrings.noShowToastMessage, undo: { kind: "visit", auditLogId } });
    } catch (error) {
      console.error(error);
    }
  }

  async function handleSelectCancelReason(reason: VisitCancelReason) {
    if (rowActionSheet?.kind !== "cancel") {
      return;
    }
    try {
      const auditLogId = await cancelVisit(db, rowActionSheet.visit.id, reason);
      setToastState({ message: dayScreenStrings.cancelToastMessage, undo: { kind: "visit", auditLogId } });
    } catch (error) {
      console.error(error);
    } finally {
      setRowActionSheet(null);
    }
  }

  function handleMoved(undo: UndoAction) {
    setRowActionSheet(null);
    setToastState({ message: dayScreenStrings.moveToastMessage, undo });
  }

  function handleMoveCollision() {
    setToastState({ message: dayScreenStrings.bookingSlotTakenError, undo: null });
  }

  function handleOpenInvoice(invoiceId: string) {
    setOpenMenuVisitId(null);
    setInvoiceSheetInvoiceId(invoiceId);
  }

  function handleRequestPayment(invoiceId: string) {
    setInvoiceSheetInvoiceId(null);
    setPaymentSheetInvoiceId(invoiceId);
  }

  function handlePaymentRecorded(undo: UndoAction) {
    const invoiceId = paymentSheetInvoiceId;
    setPaymentSheetInvoiceId(null);
    // Back to the invoice sheet so the assistant sees the updated totals,
    // not just a toast claiming something changed.
    setInvoiceSheetInvoiceId(invoiceId);
    setToastState({ message: dayScreenStrings.paymentToastMessage, undo });
  }

  function handleInvoiceVoided() {
    setInvoiceSheetInvoiceId(null);
    setToastState({ message: dayScreenStrings.voidInvoiceToastMessage, undo: null });
  }

  function handleCashClosed() {
    setIsCashCloseOpen(false);
    setToastState({ message: dayScreenStrings.cashCloseToastMessage, undo: null });
  }

  async function handleSetDelay(minutes: number) {
    if (!currentPractitionerId || !selectedLocationId || !staticData) {
      return;
    }
    const practitioner = staticData.practitioners.find((p) => p.id === currentPractitionerId);
    if (!practitioner) {
      return;
    }
    try {
      const auditLogId = await setDayDelay(db, {
        practitionerId: currentPractitionerId,
        locationId: selectedLocationId,
        orgId: practitioner.org_id,
        date: today,
        delayMinutes: minutes,
      });
      setToastState({
        message: dayScreenStrings.delayChangedToastMessage,
        undo: { kind: "day_state", auditLogId },
      });
    } catch (error) {
      console.error(error);
    }
  }

  if (!staticData) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-muted">جارٍ التحميل...</p>
      </main>
    );
  }

  const showLocationSwitcher = staticData.locations.length > 1;
  const showPractitionerFilter = staticData.practitioners.length > 1;
  const showPractitionerLabel = staticData.practitioners.length > 1;

  const counters = computeDayCounters(dynamicData.visits);
  const schedulesForSelectedLocation = staticData.schedules.filter(
    (schedule) => schedule.location_id === selectedLocationId,
  );

  // The booking sheet, walk-in and delay control all target one
  // practitioner: whichever the filter has selected, or the first one when
  // "all" is active.
  const currentPractitioner =
    staticData.practitioners.find((practitioner) => practitioner.id === currentPractitionerId) ?? null;
  const currentPractitionerSchedule = schedulesForSelectedLocation.find(
    (schedule) =>
      schedule.practitioner_id === currentPractitionerId &&
      schedule.weekday === weekday &&
      schedule.mode === ScheduleMode.Slots,
  );
  const currentPractitionerHasAnySchedule = staticData.schedules.some(
    (schedule) => schedule.practitioner_id === currentPractitionerId,
  );
  const currentPractitionerScheduleState = resolveDayScheduleState(
    currentPractitionerSchedule,
    currentPractitionerHasAnySchedule,
  );
  const currentPractitionerVisits = dynamicData.visits.filter(
    (visit) => visit.practitioner_id === currentPractitionerId,
  );
  const defaultService = staticData.services[0] ?? null;

  // Booking (and walk-in) do not require today's schedule to exist: they
  // must stay reachable on a day off and even before any schedule is
  // configured (BookingSheet itself explains that case and offers no slots).
  const canBook = Boolean(currentPractitioner && selectedLocationId && defaultService);

  return (
    <main className={`mx-auto max-w-3xl px-6 pt-16 ${toastState ? "pb-28" : "pb-16"}`}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-semibold text-green">Clintra</h1>
        <SyncStatusChip />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-muted">
          {formatCairoDisplayDateParts(today).map((part, index) =>
            part.type === "day" ? (
              <Ltr key={index}>{part.value}</Ltr>
            ) : (
              <span key={index}>{part.value}</span>
            ),
          )}
        </p>
        {selectedLocationId && currentPractitioner && (
          <button
            type="button"
            onClick={() => setIsCashCloseOpen(true)}
            className="shrink-0 text-sm text-muted underline"
          >
            {dayScreenStrings.cashCloseButtonLabel}
          </button>
        )}
      </div>

      {currentPractitioner && (
        <div className="mt-3">
          <DelayControl
            delayMinutes={delayMinutes}
            scheduleStartTime={currentPractitionerSchedule?.start_time ?? null}
            onSetDelay={handleSetDelay}
          />
        </div>
      )}

      {showLocationSwitcher && (
        <div className="mt-4 flex gap-2">
          {staticData.locations.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => setSelectedLocationId(location.id)}
              className={toggleButtonClass(location.id === selectedLocationId)}
            >
              {location.name}
            </button>
          ))}
        </div>
      )}

      {showPractitionerFilter && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setSelectedPractitionerId(null)}
            className={toggleButtonClass(selectedPractitionerId === null)}
          >
            {dayScreenStrings.allPractitioners}
          </button>
          {staticData.practitioners.map((practitioner) => (
            <button
              key={practitioner.id}
              type="button"
              onClick={() => setSelectedPractitionerId(practitioner.id)}
              className={toggleButtonClass(practitioner.id === selectedPractitionerId)}
            >
              {practitioner.full_name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        <Counters counters={counters} />
      </div>

      <div className="mt-8 flex flex-col gap-8">
        {practitionersToShow.map((practitioner) => {
          const practitionerSchedules = schedulesForSelectedLocation.filter(
            (schedule) => schedule.practitioner_id === practitioner.id,
          );
          const hasAnySchedule = staticData.schedules.some(
            (schedule) => schedule.practitioner_id === practitioner.id,
          );
          const todaysSchedule = practitionerSchedules.find(
            (schedule) => schedule.weekday === weekday && schedule.mode === ScheduleMode.Slots,
          );
          const visitsForPractitioner = dynamicData.visits.filter(
            (visit) => visit.practitioner_id === practitioner.id,
          );

          return (
            <PractitionerColumn
              key={practitioner.id}
              practitionerName={practitioner.full_name}
              showLabel={showPractitionerLabel}
              todaysSchedule={todaysSchedule}
              hasAnySchedule={hasAnySchedule}
              visits={visitsForPractitioner}
              patientsById={dynamicData.patientsById}
              servicesById={dynamicData.servicesById}
              invoiceIdByVisitId={dynamicData.invoiceIdByVisitId}
              onAdvance={handleAdvance}
              openMenuVisitId={openMenuVisitId}
              onOpenMenu={setOpenMenuVisitId}
              onCloseMenu={() => setOpenMenuVisitId(null)}
              onRequestMove={handleRequestMove}
              onRequestCancel={handleRequestCancel}
              onMarkNoShow={handleMarkNoShow}
              onOpenInvoice={handleOpenInvoice}
            />
          );
        })}
      </div>

      {!bookingSheetMode && canBook && (
        <div className="fixed inset-x-6 bottom-24 z-10 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setBookingSheetMode("walk_in")}
            className="rounded-full border border-green bg-paper px-4 py-3 text-sm font-semibold text-green shadow-lg"
          >
            {dayScreenStrings.walkInButtonLabel}
          </button>
          <button
            type="button"
            onClick={() => setBookingSheetMode("booking")}
            className="rounded-full bg-green px-6 py-3 font-semibold text-paper shadow-lg"
          >
            {dayScreenStrings.bookingButtonLabel}
          </button>
        </div>
      )}

      {bookingSheetMode && currentPractitioner && selectedLocationId && defaultService && (
        <BookingSheet
          practitioner={currentPractitioner}
          scheduleState={currentPractitionerScheduleState}
          visitsForPractitioner={currentPractitionerVisits}
          locationId={selectedLocationId}
          orgId={currentPractitioner.org_id}
          service={defaultService}
          visitDate={today}
          mode={bookingSheetMode}
          onDismiss={() => setBookingSheetMode(null)}
          onBooked={handleBooked}
          onCollision={handleBookingCollision}
        />
      )}

      {rowActionSheet?.kind === "cancel" && (
        <CancelVisitSheet
          patientName={dynamicData.patientsById.get(rowActionSheet.visit.patient_id)?.full_name ?? ""}
          onDismiss={() => setRowActionSheet(null)}
          onSelectReason={handleSelectCancelReason}
        />
      )}

      {rowActionSheet?.kind === "move" && selectedLocationId && (
        <MoveVisitSheet
          visit={rowActionSheet.visit}
          patientName={dynamicData.patientsById.get(rowActionSheet.visit.patient_id)?.full_name ?? ""}
          locationId={selectedLocationId}
          schedules={staticData.schedules}
          startDate={today}
          onDismiss={() => setRowActionSheet(null)}
          onMoved={handleMoved}
          onCollision={handleMoveCollision}
        />
      )}

      {invoiceSheetInvoiceId && (
        <InvoiceSheet
          invoiceId={invoiceSheetInvoiceId}
          onDismiss={() => setInvoiceSheetInvoiceId(null)}
          onRequestPayment={handleRequestPayment}
          onVoided={handleInvoiceVoided}
        />
      )}

      {paymentSheetInvoiceId && (
        <PaymentSheet
          invoiceId={paymentSheetInvoiceId}
          onDismiss={() => setPaymentSheetInvoiceId(null)}
          onRecorded={handlePaymentRecorded}
        />
      )}

      {isCashCloseOpen && selectedLocationId && currentPractitioner && (
        <CashCloseSheet
          locationId={selectedLocationId}
          orgId={currentPractitioner.org_id}
          date={today}
          onDismiss={() => setIsCashCloseOpen(false)}
          onClosed={handleCashClosed}
        />
      )}

      {toastState && (
        <UndoToast message={toastState.message} onUndo={toastState.undo ? handleUndo : undefined} />
      )}
    </main>
  );
}
