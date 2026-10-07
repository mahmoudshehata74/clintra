import { useEffect, useMemo, useState } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { useActingMembership } from "../../auth/useActingMembership";
import { Role } from "../../domain/role";
import { computeExpectedCashTotal } from "../../db/cashClose";
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
  Invoice,
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
import type { Piastres } from "../../domain/money";
import { ScheduleMode } from "../../domain/scheduleMode";
import { addDaysToClinicDay, clockTimeInCairo, todayInCairo, weekdayOf, type ClockTime } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { formatActorLabel } from "./actorLabel";
import {
  ADVANCE_COOLDOWN_MS,
  beginCooldown,
  elapseCooldown,
  EMPTY_COOLDOWN_STATE,
  settleCooldown,
  type CooldownState,
} from "./advanceCooldown";
import AuditSheet from "./AuditSheet";
import BookingSheet, { type BookingSheetMode } from "./BookingSheet";
import CancelVisitSheet from "./CancelVisitSheet";
import CashCloseSheet from "./CashCloseSheet";
import { computeDayCounters } from "./dayCounters";
import { computeDaySlotsSlab } from "./daySlotsSlab";
import DaySlab from "./DaySlab";
import DayTiles from "./DayTiles";
import DaySheet from "./DaySheet";
import DelayControl from "./DelayControl";
import InvoiceSheet from "./InvoiceSheet";
import MoveVisitSheet from "./MoveVisitSheet";
import PaymentSheet from "./PaymentSheet";
import PractitionerColumn from "./PractitionerColumn";
import {
  computeQueueCellCounts,
  computeQueueExpectedFinishTime,
  computeQueueSummary,
} from "./queueSummary";
import SettingsSheet from "./SettingsSheet";
import VisitFormSheet from "./VisitFormSheet";
import { resolveDayScheduleState } from "./scheduleState";
import { dayScreenStrings } from "./strings";
import { formatTileMoney } from "./tileMoney";
import type { UndoAction } from "./undoAction";
import UndoToast from "./UndoToast";
import { SEED_DAY_QUERY_PARAM } from "../../domain/appMode";

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
  /** Which of today's visits already have a visit_form_data row — see db/visitForm.ts. Drives the completed-row empty-form hint. */
  formDataVisitIds: Set<string>;
  /** Today's non-void invoices at the selected location — the slab's money tiles, scoped exactly as cash-close's own total is. */
  invoicesAtLocationToday: Invoice[];
}

const EMPTY_DYNAMIC_DATA: DynamicData = {
  visits: [],
  patientsById: new Map(),
  servicesById: new Map(),
  invoiceIdByVisitId: new Map(),
  dayStateByPractitionerId: new Map(),
  actorLabelByVisitId: new Map(),
  formDataVisitIds: new Set(),
  invoicesAtLocationToday: [],
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

/** Scrolls a day-grid row into view and focuses its primary button — the slab's "next up" action (COMMIT 2). */
function focusVisitRow(visitId: string): void {
  const row = document.querySelector(`[data-visit-row-id="${visitId}"]`);
  if (!row) {
    return;
  }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.querySelector("button")?.focus();
}

interface DayScreenProps {
  /** Lifted to App.tsx: AppShell's sidebar is what opens this now, and needs the same flag to know it's the active section. */
  isSettingsOpen: boolean;
  onCloseSettings: () => void;
  /** Reports this screen's own app-bar title up to App.tsx, which forwards it to AppShell — see AppShell.tsx's own doc comment. */
  onTitleChange: (title: string) => void;
  /** Reports this screen's own displayed day up to App.tsx, which forwards it to AppShell for its date block — the same lift as onTitleChange, and for the same reason: only the screen knows whether ?seedDay=1 has it pinned. */
  onTodayChange: (today: ClinicDay) => void;
}

export default function DayScreen({ isSettingsOpen, onCloseSettings, onTitleChange, onTodayChange }: DayScreenProps) {
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
  const [visitFormSheetVisitId, setVisitFormSheetVisitId] = useState<string | null>(null);
  const [isCashCloseOpen, setIsCashCloseOpen] = useState(false);
  const [isDaySheetOpen, setIsDaySheetOpen] = useState(false);
  const [isAuditSheetOpen, setIsAuditSheetOpen] = useState(false);
  // Per visit id: blocks a row's primary button for ADVANCE_COOLDOWN_MS after
  // a status-advancing tap, so an accidental double-tap can't skip a status
  // — see advanceCooldown.ts.
  const [advanceCooldown, setAdvanceCooldown] = useState<CooldownState>(EMPTY_COOLDOWN_STATE);
  const actingMembership = useActingMembership();
  const isOwner = actingMembership?.role === Role.Owner;

  const isSeedDayPinned = new URLSearchParams(window.location.search).get(SEED_DAY_QUERY_PARAM) === "1";
  const today = isSeedDayPinned && staticData?.seededDay ? staticData.seededDay : todayInCairo();
  const weekday = weekdayOf(today);

  // Hoisted above the loading guard below (with null-safe fallbacks) so the
  // title effect — which must run unconditionally, like every hook — can
  // read isQueueMode. Each binding is still exactly what the post-guard
  // render logic used before this task; nothing here changes once
  // staticData has actually loaded.
  const currentPractitionerId = useMemo(() => {
    if (!staticData) {
      return null;
    }
    const isStoredSelectionValid =
      selectedPractitionerId != null &&
      staticData.practitioners.some((practitioner) => practitioner.id === selectedPractitionerId);
    return isStoredSelectionValid ? selectedPractitionerId : (staticData.practitioners[0]?.id ?? null);
  }, [staticData, selectedPractitionerId]);
  const schedulesForSelectedLocation = (staticData?.schedules ?? []).filter(
    (schedule) => schedule.location_id === selectedLocationId,
  );
  const currentPractitioner =
    staticData?.practitioners.find((practitioner) => practitioner.id === currentPractitionerId) ?? null;
  const currentPractitionerSchedule = schedulesForSelectedLocation.find(
    (schedule) => schedule.practitioner_id === currentPractitionerId && schedule.weekday === weekday,
  );
  const currentPractitionerHasAnySchedule = (staticData?.schedules ?? []).some(
    (schedule) => schedule.practitioner_id === currentPractitionerId,
  );
  const currentPractitionerScheduleState = resolveDayScheduleState(
    currentPractitionerSchedule,
    currentPractitionerHasAnySchedule,
  );
  const isQueueMode =
    currentPractitionerScheduleState.kind === "scheduled" &&
    currentPractitionerScheduleState.schedule.mode === ScheduleMode.Queue;

  useEffect(() => {
    onTitleChange(isQueueMode ? dayScreenStrings.appBarTitleQueue : dayScreenStrings.appBarTitle);
  }, [isQueueMode, onTitleChange]);

  useEffect(() => {
    onTodayChange(today);
  }, [today, onTodayChange]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await seedDatabase(db, { includeQueueDemo: true, realPinHash: true });
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
    return staticData.practitioners.filter((practitioner) => practitioner.id === currentPractitionerId);
  }, [staticData, currentPractitionerId]);

  // Live query: re-emits automatically whenever any write touches the visits
  // table (attendance, booking, cancel, no-show, move, or an undo of any of
  // them), so the row and the counters update without a manual refetch.
  const dynamicData =
    useLiveQuery<DynamicData>(async () => {
      if (!staticData || practitionersToShow.length === 0 || !selectedLocationId) {
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
      const [patients, services, invoicesForVisits, invoicesAtLocation, formDataRows, dayStateRows, memberships] =
        await Promise.all([
          db.patients.bulkGet(patientIds),
          db.services.bulkGet(serviceIds),
          visitIds.length > 0 ? db.invoices.where("visit_id").anyOf(visitIds).toArray() : Promise.resolve([]),
          db.invoices.where("location_id").equals(selectedLocationId).toArray(),
          visitIds.length > 0 ? db.visit_form_data.where("visit_id").anyOf(visitIds).toArray() : Promise.resolve([]),
          Promise.all(
            practitionersToShow.map((practitioner) =>
              db.day_state
                .where("[practitioner_id+location_id+date]")
                .equals([practitioner.id, selectedLocationId, today])
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
      const formDataVisitIds = new Set(formDataRows.map((row) => row.visit_id));
      const invoicesAtLocationToday = invoicesAtLocation.filter(
        (invoice) => todayInCairo(new Date(invoice.issued_at)) === today,
      );

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

      return {
        visits,
        patientsById,
        servicesById,
        invoiceIdByVisitId,
        dayStateByPractitionerId,
        actorLabelByVisitId,
        formDataVisitIds,
        invoicesAtLocationToday,
      };
    }, [staticData, practitionersToShow, today, selectedLocationId]) ?? EMPTY_DYNAMIC_DATA;

  // Services, live: the booking sheet's service picker must reflect a service
  // the owner deactivates in settings on the next render, so this is a live
  // query rather than part of the one-time staticData load. Kept as the plain
  // toArray querier (the active filter is applied below in render) so Dexie's
  // dependency tracking reliably re-runs it on any services write.
  const allServices = useLiveQuery(() => db.services.toArray(), []) ?? [];

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
  const avgConsultMinutes = dayStateRow?.avg_consult_minutes ?? null;

  useEffect(() => {
    if (!toastState) {
      return;
    }
    const timeoutMs = toastState.undo ? UNDO_WINDOW_MS : MESSAGE_TOAST_MS;
    const timeout = setTimeout(() => setToastState(null), timeoutMs);
    return () => clearTimeout(timeout);
  }, [toastState]);

  async function handleAdvance(visit: Visit, toStatus: VisitStatus) {
    setAdvanceCooldown((prev) => beginCooldown(prev, visit.id));
    window.setTimeout(() => {
      setAdvanceCooldown((prev) => elapseCooldown(prev, visit.id));
    }, ADVANCE_COOLDOWN_MS);

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
    } finally {
      setAdvanceCooldown((prev) => settleCooldown(prev, visit.id));
    }
  }

  async function handleCallNextInQueue() {
    const sorted = [...currentPractitionerVisits].sort((a, b) => a.position - b.position);
    const nextVisitId = computeQueueSummary(sorted).nextVisitId;
    const nextVisit = sorted.find((visit) => visit.id === nextVisitId);
    if (nextVisit) {
      await handleAdvance(nextVisit, VisitStatus.InRoom);
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

  function handleOpenBooking() {
    setPresetBookingTime(null);
    setBookingSheetMode("booking");
  }

  function handleWalkIn() {
    setPresetBookingTime(null);
    setBookingSheetMode("walk_in");
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

  function handleOpenVisitForm(visit: Visit) {
    setOpenMenuVisitId(null);
    setVisitFormSheetVisitId(visit.id);
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
  const currentPractitionerVisits = dynamicData.visits.filter(
    (visit) => visit.practitioner_id === currentPractitionerId,
  );
  const advancingVisitIds = new Set(Object.keys(advanceCooldown));
  const activeServices = allServices.filter((service) => service.is_active);
  const defaultService = activeServices[0] ?? null;

  // Booking (and walk-in) do not require today's schedule to exist: they
  // must stay reachable on a day off and even before any schedule is
  // configured (BookingSheet itself explains that case and offers no slots).
  const canBook = Boolean(currentPractitioner && selectedLocationId && defaultService && !bookingSheetMode);

  // The slab's own numbers, computed once per mode and reused across the
  // hero/cells/split/actions JSX below rather than recomputed per section.
  const slotsSlab = computeDaySlotsSlab(currentPractitionerVisits, dynamicData.invoicesAtLocationToday);
  const queueSummaryForCurrent = computeQueueSummary(currentPractitionerVisits);
  const queueCellsForCurrent = computeQueueCellCounts(currentPractitionerVisits);
  const queueExpectedFinishTime = computeQueueExpectedFinishTime(
    queueSummaryForCurrent.waitingCount,
    queueCellsForCurrent.inRoomCount,
    avgConsultMinutes,
    new Date().toISOString(),
  );
  const nextVisit = isQueueMode
    ? currentPractitionerVisits.find((visit) => visit.id === queueSummaryForCurrent.nextVisitId)
    : slotsSlab.nextVisit;
  const finalStateCount = isQueueMode ? queueCellsForCurrent.finalStateCount : slotsSlab.finalStateCount;
  const collectedPiastres = selectedLocationId
    ? computeExpectedCashTotal(dynamicData.invoicesAtLocationToday, selectedLocationId, today)
    : (0 as Piastres);

  return (
    <main className={`mx-auto max-w-3xl px-6 py-6 ${toastState ? "pb-28" : "pb-16"}`}>
      {currentPractitioner && selectedLocationId && (
        <DaySlab
          heroLabel={isQueueMode ? dayScreenStrings.queueSummaryCurrentTurnLabel : dayScreenStrings.slabRemainingLabel}
          heroValue={<Ltr>{isQueueMode ? (queueSummaryForCurrent.currentTurnPosition ?? "—") : counters.remaining}</Ltr>}
          heroUnit={
            isQueueMode ? (
              <>
                {dayScreenStrings.queueHeroOfTotalWord} <Ltr>{currentPractitionerVisits.length}</Ltr>
              </>
            ) : (
              dayScreenStrings.slabRemainingUnit
            )
          }
          heroCaption={
            isQueueMode ? (
              <>
                {dayScreenStrings.queueSummaryAverageLabel}{" "}
                <b className="font-semibold text-on-dark">
                  {avgConsultMinutes !== null ? (
                    <>
                      <Ltr>{avgConsultMinutes}</Ltr>
                      {dayScreenStrings.minutesShortUnit}
                    </>
                  ) : (
                    "—"
                  )}
                </b>
                {" · "}
                {dayScreenStrings.queueExpectedFinishPrefix}{" "}
                <b className="font-semibold text-on-dark">
                  {queueExpectedFinishTime ? <Ltr>{queueExpectedFinishTime}</Ltr> : "—"}
                </b>
              </>
            ) : (
              <>
                {dayScreenStrings.slabTotalCaptionPrefix}{" "}
                <b className="font-semibold text-on-dark">
                  <Ltr>{counters.total}</Ltr>
                </b>{" "}
                {dayScreenStrings.slabTotalCaptionSuffix}
              </>
            )
          }
          cells={
            isQueueMode
              ? [
                  {
                    label: dayScreenStrings.queueSummaryWaitingLabel,
                    value: <Ltr>{queueSummaryForCurrent.waitingCount}</Ltr>,
                    tone: "arrived",
                  },
                  { label: dayScreenStrings.countersCompleted, value: <Ltr>{queueCellsForCurrent.completedCount}</Ltr> },
                  {
                    label: dayScreenStrings.queueInRoomCellLabel,
                    value: <Ltr>{queueCellsForCurrent.inRoomCount}</Ltr>,
                    tone: "copper",
                  },
                ]
              : [
                  { label: dayScreenStrings.countersArrived, value: <Ltr>{counters.arrived}</Ltr>, tone: "arrived" },
                  { label: dayScreenStrings.countersCompleted, value: <Ltr>{counters.completed}</Ltr> },
                  { label: dayScreenStrings.slabNoShowCellLabel, value: <Ltr>{slotsSlab.noShowCount}</Ltr>, tone: "miss" },
                ]
          }
          splitSharePercent={isQueueMode ? queueCellsForCurrent.splitSharePercent : slotsSlab.splitSharePercent}
          splitCompletedText={
            <>
              {dayScreenStrings.slabSplitCompletedPrefix}{" "}
              <b>
                <Ltr>{finalStateCount}</Ltr>
              </b>{" "}
              {dayScreenStrings.slabSplitOfWord}{" "}
              <b>
                <Ltr>{currentPractitionerVisits.length}</Ltr>
              </b>
            </>
          }
          splitRemainingText={
            <>
              {dayScreenStrings.slabSplitRemainingPrefix}{" "}
              <b>
                <Ltr>{currentPractitionerVisits.length - finalStateCount}</Ltr>
              </b>
            </>
          }
          actions={
            <>
              {nextVisit && (
                <Button variant="onDarkCopper" onClick={() => focusVisitRow(nextVisit.id)}>
                  {dayScreenStrings.slabNextActionPrefix}{" "}
                  <span className="font-bold">{dynamicData.patientsById.get(nextVisit.patient_id)?.full_name}</span>
                  {" · "}
                  {isQueueMode ? (
                    <>
                      {dayScreenStrings.queueNextActionNumberPrefix} <Ltr>{nextVisit.position}</Ltr>
                    </>
                  ) : (
                    nextVisit.scheduled_at && <Ltr>{clockTimeInCairo(nextVisit.scheduled_at)}</Ltr>
                  )}
                </Button>
              )}
              <DelayControl
                delayMinutes={delayMinutes}
                scheduleStartTime={currentPractitionerSchedule?.start_time ?? null}
                onSetDelay={handleSetDelay}
              />
              <Button variant="onDark" onClick={() => setIsCashCloseOpen(true)}>
                {dayScreenStrings.cashCloseButtonLabel}
              </Button>
              {currentPractitionerSchedule && (
                <span className="ms-auto text-[11px] text-on-dark-dim">
                  {dayScreenStrings.slabCloseKbdPrefix} <Ltr>{currentPractitionerSchedule.end_time}</Ltr>
                </span>
              )}
            </>
          }
        />
      )}

      {!isQueueMode && currentPractitioner && selectedLocationId && (
        <div className="mt-2.5">
          <DayTiles
            tiles={[
              {
                label: dayScreenStrings.tileCollectedLabel,
                value: <Ltr>{formatTileMoney(collectedPiastres)}</Ltr>,
                unit: dayScreenStrings.tileCurrencyUnit,
                sub: (
                  <>
                    <Ltr>{slotsSlab.invoiceCount}</Ltr> {dayScreenStrings.tileInvoiceCountSuffix}
                  </>
                ),
                tone: "ok",
              },
              {
                label: dayScreenStrings.tileDueLabel,
                value: <Ltr>{formatTileMoney(slotsSlab.duePiastres)}</Ltr>,
                unit: dayScreenStrings.tileCurrencyUnit,
                sub: slotsSlab.hasPartialInvoice ? dayScreenStrings.invoiceStatusPartial : undefined,
                tone: "copper",
              },
              {
                label: dayScreenStrings.queueSummaryAverageLabel,
                value: avgConsultMinutes !== null ? <Ltr>{avgConsultMinutes}</Ltr> : "—",
                unit: dayScreenStrings.delayMinutesSuffix,
                sub:
                  slotsSlab.longestCompletedConsultMinutes !== null ? (
                    <>
                      {dayScreenStrings.tileLongestConsultPrefix} <Ltr>{slotsSlab.longestCompletedConsultMinutes}</Ltr>
                      {dayScreenStrings.minutesShortUnit}
                    </>
                  ) : undefined,
              },
            ]}
          />
        </div>
      )}

      {(showPractitionerFilter || showLocationSwitcher) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {showPractitionerFilter && (
            <ToggleGroup
              variant="filter"
              label={dayScreenStrings.practitionerFilterAriaLabel}
              value={currentPractitionerId ?? ""}
              onChange={handleSelectPractitioner}
              options={staticData.practitioners.map((practitioner) => ({
                value: practitioner.id,
                label: practitioner.full_name,
              }))}
            />
          )}
          {showLocationSwitcher && (
            <ToggleGroup
              variant="filter"
              label={dayScreenStrings.locationSwitcherAriaLabel}
              value={selectedLocationId ?? ""}
              onChange={setSelectedLocationId}
              options={staticData.locations.map((location) => ({ value: location.id, label: location.name }))}
            />
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6">
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
              formDataVisitIds={dynamicData.formDataVisitIds}
              advancingVisitIds={advancingVisitIds}
              today={today}
              onTapEmptySlot={
                canBook && practitioner.id === currentPractitionerId ? handleTapEmptySlot : undefined
              }
              onOpenBooking={canBook && practitioner.id === currentPractitionerId ? handleOpenBooking : undefined}
              onWalkIn={canBook && practitioner.id === currentPractitionerId ? handleWalkIn : undefined}
              onAdvance={handleAdvance}
              openMenuVisitId={openMenuVisitId}
              onOpenMenu={setOpenMenuVisitId}
              onCloseMenu={() => setOpenMenuVisitId(null)}
              onRequestMove={handleRequestMove}
              onRequestCancel={handleRequestCancel}
              onMarkNoShow={handleMarkNoShow}
              onOpenInvoice={handleOpenInvoice}
              onSendToEnd={handleSendToEnd}
              onOpenVisitForm={handleOpenVisitForm}
              onOpenDaySheet={practitioner.id === currentPractitionerId ? () => setIsDaySheetOpen(true) : undefined}
              onOpenAudit={practitioner.id === currentPractitionerId ? () => setIsAuditSheetOpen(true) : undefined}
              onCallNextInQueue={practitioner.id === currentPractitionerId ? handleCallNextInQueue : undefined}
            />
          );
        })}
      </div>

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

      {visitFormSheetVisitId && (
        <VisitFormSheet visitId={visitFormSheetVisitId} onDismiss={() => setVisitFormSheetVisitId(null)} />
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
          onDismiss={onCloseSettings}
        />
      )}

      {toastState && (
        <UndoToast message={toastState.message} onUndo={toastState.undo ? handleUndo : undefined} />
      )}
    </main>
  );
}
