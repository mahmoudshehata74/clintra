import { useEffect, useMemo, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { authStrings } from "../../auth/authStrings";
import { clearActiveSession } from "../../auth/session";
import { useActingMembership } from "../../auth/useActingMembership";
import { Role } from "../../domain/role";
import { setDayDelay } from "../../db/dayState";
import { ensureDeviceRegistration } from "../../db/deviceRegistration";
import {
  undoMostRecentDayStateMutation,
  undoMostRecentInvoiceItemMutation,
  undoMostRecentInvoiceMutation,
  undoMostRecentPatientMutation,
  undoMostRecentPaymentMutation,
  undoMostRecentVisitMutation,
} from "../../db/mutate";
import { seedDatabase, seededVisitsDate } from "../../db/seed";
import type {
  ClinicDay,
  DayState,
  Location,
  Membership,
  Patient,
  Practitioner,
  Schedule,
  Service,
  User,
  Visit,
} from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitArrived, markVisitCompleted, markVisitInRoom } from "../../db/visitAttendance";
import { cancelVisit, markVisitNoShow, type VisitCancelReason } from "../../db/visitCancel";
import { sendVisitToEndOfQueue, undoSendVisitToEndOfQueue } from "../../db/visitQueue";
import { ScheduleMode } from "../../domain/scheduleMode";
import {
  addDaysToClinicDay,
  formatCairoDisplayDateParts,
  todayInCairo,
  weekdayOf,
  type ClockTime,
} from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { formatActorLabel } from "./actorLabel";
import AuditSheet from "./AuditSheet";
import BookingSheet, { type BookingSheetMode } from "./BookingSheet";
import CancelVisitSheet from "./CancelVisitSheet";
import CashCloseSheet from "./CashCloseSheet";
import Counters from "./Counters";
import { computeDayCounters } from "./dayCounters";
import DaySheet from "./DaySheet";
import DelayControl from "./DelayControl";
import InvoiceSheet from "./InvoiceSheet";
import MoveVisitSheet from "./MoveVisitSheet";
import PaymentSheet from "./PaymentSheet";
import PractitionerColumn from "./PractitionerColumn";
import SettingsSheet from "./SettingsSheet";
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
  /** Each shown practitioner's day_state row for today at the selected location — queue mode's average, mainly. */
  dayStateByPractitionerId: Map<string, DayState>;
  /** Resolved "recorded by" label per visit id, from each visit's created_by — see actorLabel.ts. */
  actorLabelByVisitId: Map<string, string>;
}

const EMPTY_DYNAMIC_DATA: DynamicData = {
  visits: [],
  patientsById: new Map(),
  servicesById: new Map(),
  invoiceIdByVisitId: new Map(),
  dayStateByPractitionerId: new Map(),
  actorLabelByVisitId: new Map(),
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

// Persisted per device, not per org or user (there is no login yet): an
// assistant who last opened Dr X yesterday should still see Dr X today on
// the same device, not whichever practitioner happens to sort first.
// localStorage over sessionStorage specifically for that reason — it must
// survive the tab (and the browser) closing, not just the current session.
const SELECTED_PRACTITIONER_STORAGE_KEY = "clintra-selected-practitioner-id";

function readStoredPractitionerId(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage.getItem(SELECTED_PRACTITIONER_STORAGE_KEY);
}

function toggleButtonClass(isSelected: boolean): string {
  return isSelected
    ? "rounded-[--radius-el] border border-green bg-green-soft px-3 py-1 text-sm"
    : "rounded-[--radius-el] border border-line px-3 py-1 text-sm";
}

// Matches the reference's .tg.a (selected) / .tg.e (neutral) tag-pill
// language, the same treatment already used for the other header pills.
function practitionerPillClassName(isSelected: boolean): string {
  return isSelected
    ? "rounded-[5px] bg-green-soft px-2 py-0.5 text-xs text-green"
    : "rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted";
}

export default function DayScreen() {
  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerIdState] = useState<string | null>(readStoredPractitionerId);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [bookingSheetMode, setBookingSheetMode] = useState<BookingSheetMode | null>(null);
  const [presetBookingTime, setPresetBookingTime] = useState<ClockTime | null>(null);
  const [openMenuVisitId, setOpenMenuVisitId] = useState<string | null>(null);
  const [rowActionSheet, setRowActionSheet] = useState<RowActionSheetState>(null);
  const [invoiceSheetInvoiceId, setInvoiceSheetInvoiceId] = useState<string | null>(null);
  const [paymentSheetInvoiceId, setPaymentSheetInvoiceId] = useState<string | null>(null);
  const [isCashCloseOpen, setIsCashCloseOpen] = useState(false);
  const [isDaySheetOpen, setIsDaySheetOpen] = useState(false);
  const [isAuditSheetOpen, setIsAuditSheetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const actingMembership = useActingMembership();
  const isOwner = actingMembership?.role === Role.Owner;

  const isSeedDayPinned = new URLSearchParams(window.location.search).get(SEED_DAY_QUERY_PARAM) === "1";
  const today = isSeedDayPinned && staticData?.seededDay ? staticData.seededDay : todayInCairo();
  const weekday = weekdayOf(today);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await seedDatabase(db, { includeQueueDemo: true });
      // Registration is transparent (Layer 1): right after the seed, this
      // writes the device row (migrating any pre-v8 localStorage id) and primes
      // the synchronous device-id cache the write path reads. It also yields
      // the device's home location, used as the default selection below.
      const deviceBinding = await ensureDeviceRegistration(db);
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
      // Default to the device's bound location (getDeviceBinding is the source
      // of truth), falling back to the first active one if that binding's
      // location is not among the currently active set.
      const boundLocation = activeLocations.find((location) => location.id === deviceBinding.location_id);
      setSelectedLocationId(boundLocation?.id ?? activeLocations[0]?.id ?? null);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [isSeedDayPinned]);

  function handleSelectPractitioner(practitionerId: string) {
    setSelectedPractitionerIdState(practitionerId);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SELECTED_PRACTITIONER_STORAGE_KEY, practitionerId);
    }
  }

  // Adaptive-UI rule: more than one practitioner means a switcher and
  // exactly one practitioner's day rendered at a time — never more than one
  // column stacked on the same viewport. Always resolves to at most one
  // practitioner, never "every practitioner." A practitioner id persisted
  // from a previous visit may no longer be active (or may belong to a
  // different seed/org state entirely) — derived here, not synced back into
  // state, so a stale id falls back to the default (first) practitioner on
  // every render without ever needing a setState-in-effect.
  const practitionersToShow = useMemo(() => {
    if (!staticData) {
      return [];
    }
    const isStoredSelectionValid =
      selectedPractitionerId != null &&
      staticData.practitioners.some((practitioner) => practitioner.id === selectedPractitionerId);
    const targetId = isStoredSelectionValid ? selectedPractitionerId : (staticData.practitioners[0]?.id ?? null);
    return staticData.practitioners.filter((practitioner) => practitioner.id === targetId);
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
      const membershipIds = [...new Set(visits.map((visit) => visit.created_by))];
      const [patients, services, invoicesForVisits, dayStateRows, memberships] = await Promise.all([
        db.patients.bulkGet(patientIds),
        db.services.bulkGet(serviceIds),
        visitIds.length > 0 ? db.invoices.where("visit_id").anyOf(visitIds).toArray() : Promise.resolve([]),
        Promise.all(
          practitionersToShow.map((practitioner) =>
            db.day_state
              .where("[practitioner_id+location_id+date]")
              .equals([practitioner.id, selectedLocationId ?? "", today])
              .first(),
          ),
        ),
        db.memberships.bulkGet(membershipIds),
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

      const dayStateByPractitionerId = new Map<string, DayState>();
      dayStateRows.forEach((dayStateRow, index) => {
        if (dayStateRow) {
          dayStateByPractitionerId.set(practitionersToShow[index].id, dayStateRow);
        }
      });

      const membershipsById = new Map(
        memberships.filter((m): m is Membership => m != null).map((m) => [m.id, m]),
      );
      const userIds = [...new Set([...membershipsById.values()].map((m) => m.user_id))];
      const users = await db.users.bulkGet(userIds);
      const usersById = new Map(users.filter((u): u is User => u != null).map((u) => [u.id, u]));
      const actorLabelByVisitId = new Map<string, string>();
      for (const visit of visits) {
        const membership = membershipsById.get(visit.created_by);
        const user = membership ? usersById.get(membership.user_id) : undefined;
        actorLabelByVisitId.set(visit.id, formatActorLabel(membership, user));
      }

      return { visits, patientsById, servicesById, invoiceIdByVisitId, dayStateByPractitionerId, actorLabelByVisitId };
    }, [staticData, practitionersToShow, today, selectedLocationId]) ?? EMPTY_DYNAMIC_DATA;

  // Services, live: the booking sheet's service picker must reflect a service
  // the owner deactivates in settings on the next render, so this is a live
  // query rather than part of the one-time staticData load. Kept as the plain
  // toArray querier (the active filter is applied below in render) so Dexie's
  // dependency tracking reliably re-runs it on any services write.
  const allServices = useLiveQuery(() => db.services.toArray(), []) ?? [];

  // The same resolution practitionersToShow already applied — kept as its
  // own binding since it's read unconditionally below, before the early
  // return, for the day_state live query.
  const currentPractitionerId = practitionersToShow[0]?.id ?? null;

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
          dayStateAuditLogId: result.dayStateAuditLogId,
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
        // The average last: it is derived from every completed visit, so
        // reverting it after the visit itself is already gone is safe even
        // if this specific step is refused (stale — e.g. another completion
        // has already recomputed it since) — the visit and invoice are
        // still cleanly reversed either way, just the stat is left to
        // recompute on the next real completion.
        await undoMostRecentDayStateMutation(db, undo.dayStateAuditLogId);
        setToastState(null);
        return;
      }

      if (undo.kind === "queue_reorder") {
        const outcome = await undoSendVisitToEndOfQueue(db, undo.moves);
        setToastState(outcome.ok ? null : { message: dayScreenStrings.undoRefused, undo: null });
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

  function handleTapEmptySlot(time: ClockTime) {
    setPresetBookingTime(time);
    setBookingSheetMode("booking");
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

  async function handleSendToEnd(visit: Visit) {
    setOpenMenuVisitId(null);
    try {
      const result = await sendVisitToEndOfQueue(db, visit.id);
      if (!result.ok) {
        return;
      }
      setToastState({
        message: dayScreenStrings.sendToEndOfQueueToastMessage,
        undo: { kind: "queue_reorder", moves: result.moves },
      });
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
    (schedule) => schedule.practitioner_id === currentPractitionerId && schedule.weekday === weekday,
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
  const activeServices = allServices.filter((service) => service.is_active);
  const defaultService = activeServices[0] ?? null;

  // Booking (and walk-in) do not require today's schedule to exist: they
  // must stay reachable on a day off and even before any schedule is
  // configured (BookingSheet itself explains that case and offers no slots).
  const canBook = Boolean(currentPractitioner && selectedLocationId && defaultService);
  const isQueueMode = currentPractitionerScheduleState.kind === "scheduled" && currentPractitionerScheduleState.schedule.mode === ScheduleMode.Queue;

  return (
    <main className={`mx-auto max-w-3xl px-6 pt-16 ${toastState ? "pb-28" : "pb-16"}`}>
      {/* Row 1: brand + connection state — matching the design reference's
          composition of brand and status chip sharing one row. */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-semibold text-green">Clintra</h1>
        <SyncStatusChip />
      </div>

      {/* Row 2: the date, as the screen's real heading — the reference gives
          this position, not the brand, the primary heading treatment. */}
      <p className="mt-2 font-display text-2xl font-semibold text-ink">
        {formatCairoDisplayDateParts(today).map((part, index) =>
          part.type === "day" ? <Ltr key={index}>{part.value}</Ltr> : <span key={index}>{part.value}</span>,
        )}
      </p>

      {/* Row 3: a metadata row of tag-styled pills — delay state and the
          day-header actions, matching the reference's .tg tag language
          instead of underlined text links or a bordered chip. */}
      {currentPractitioner && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DelayControl
            delayMinutes={delayMinutes}
            scheduleStartTime={currentPractitionerSchedule?.start_time ?? null}
            onSetDelay={handleSetDelay}
          />
          {showPractitionerFilter &&
            staticData.practitioners.map((practitioner) => (
              <button
                key={practitioner.id}
                type="button"
                onClick={() => handleSelectPractitioner(practitioner.id)}
                className={practitionerPillClassName(practitioner.id === currentPractitionerId)}
              >
                {practitioner.full_name}
              </button>
            ))}
          {selectedLocationId && (
            <>
              <button
                type="button"
                onClick={() => setIsDaySheetOpen(true)}
                className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted"
              >
                {dayScreenStrings.daySheetButtonLabel}
              </button>
              <button
                type="button"
                onClick={() => setIsAuditSheetOpen(true)}
                className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted"
              >
                {dayScreenStrings.auditButtonLabel}
              </button>
              <button
                type="button"
                onClick={() => setIsCashCloseOpen(true)}
                className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted"
              >
                {dayScreenStrings.cashCloseButtonLabel}
              </button>
              {/* Owner-only: no disabled state, no route reachable otherwise. */}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted"
                >
                  {dayScreenStrings.settingsButtonLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => clearActiveSession()}
                className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted"
              >
                {authStrings.lockButtonLabel}
              </button>
            </>
          )}
        </div>
      )}

      {/* Row 4: counters. */}
      <div className="mt-3">
        <Counters counters={counters} />
      </div>

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

      <div className="mt-8 flex flex-col gap-8">
        {practitionersToShow.map((practitioner) => {
          const practitionerSchedules = schedulesForSelectedLocation.filter(
            (schedule) => schedule.practitioner_id === practitioner.id,
          );
          const hasAnySchedule = staticData.schedules.some(
            (schedule) => schedule.practitioner_id === practitioner.id,
          );
          const todaysSchedule = practitionerSchedules.find((schedule) => schedule.weekday === weekday);
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
              avgConsultMinutes={dynamicData.dayStateByPractitionerId.get(practitioner.id)?.avg_consult_minutes ?? null}
              actorLabelByVisitId={dynamicData.actorLabelByVisitId}
              onTapEmptySlot={
                canBook && practitioner.id === currentPractitionerId ? handleTapEmptySlot : undefined
              }
              onAdvance={handleAdvance}
              openMenuVisitId={openMenuVisitId}
              onOpenMenu={setOpenMenuVisitId}
              onCloseMenu={() => setOpenMenuVisitId(null)}
              onRequestMove={handleRequestMove}
              onRequestCancel={handleRequestCancel}
              onMarkNoShow={handleMarkNoShow}
              onOpenInvoice={handleOpenInvoice}
              onSendToEnd={handleSendToEnd}
            />
          );
        })}
      </div>

      {!bookingSheetMode && canBook && (
        <div className="fixed inset-x-6 bottom-24 z-10 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setPresetBookingTime(null);
              setBookingSheetMode("walk_in");
            }}
            className="rounded-full border border-line bg-paper px-4 py-3 font-display text-sm font-medium text-ink shadow-lg"
          >
            {dayScreenStrings.walkInButtonLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              setPresetBookingTime(null);
              setBookingSheetMode("booking");
            }}
            className="rounded-full bg-green px-6 py-3 font-display font-medium text-paper shadow-lg"
          >
            {isQueueMode ? dayScreenStrings.addToQueueButtonLabel : dayScreenStrings.bookingButtonLabel}
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
          services={activeServices}
          visitDate={today}
          mode={bookingSheetMode}
          presetTime={presetBookingTime ?? undefined}
          onDismiss={() => {
            setBookingSheetMode(null);
            setPresetBookingTime(null);
          }}
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

      {isDaySheetOpen && selectedLocationId && currentPractitionerId && (
        <DaySheet
          practitionerId={currentPractitionerId}
          locationId={selectedLocationId}
          tomorrow={addDaysToClinicDay(today, 1)}
          onDismiss={() => setIsDaySheetOpen(false)}
        />
      )}

      {isAuditSheetOpen && selectedLocationId && currentPractitionerId && (
        <AuditSheet
          practitionerId={currentPractitionerId}
          locationId={selectedLocationId}
          today={today}
          onDismiss={() => setIsAuditSheetOpen(false)}
        />
      )}

      {isSettingsOpen && isOwner && currentPractitionerId && selectedLocationId && currentPractitioner && (
        <SettingsSheet
          practitionerId={currentPractitionerId}
          locationId={selectedLocationId}
          orgId={currentPractitioner.org_id}
          onDismiss={() => setIsSettingsOpen(false)}
        />
      )}

      {toastState && (
        <UndoToast message={toastState.message} onUndo={toastState.undo ? handleUndo : undefined} />
      )}
    </main>
  );
}
