import { useEffect, useMemo, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { undoMostRecentVisitMutation } from "../../db/mutate";
import { seedDatabase } from "../../db/seed";
import type { Location, Patient, Practitioner, Schedule, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitArrived } from "../../db/visitAttendance";
import { ScheduleMode } from "../../domain/scheduleMode";
import { formatCairoDisplayDateParts, todayInCairo, weekdayOf } from "../../domain/time";
import BookingSheet from "./BookingSheet";
import Counters from "./Counters";
import { computeDayCounters } from "./dayCounters";
import PractitionerColumn from "./PractitionerColumn";
import { dayScreenStrings } from "./strings";
import UndoToast from "./UndoToast";

interface StaticData {
  locations: Location[];
  practitioners: Practitioner[];
  schedules: Schedule[];
  services: Service[];
}

interface DynamicData {
  visits: Visit[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
}

const EMPTY_DYNAMIC_DATA: DynamicData = { visits: [], patientsById: new Map(), servicesById: new Map() };

// The undo action stays available for five minutes after marking a visit
// arrived or booking one, per the specification. This is a UI-side mirror of
// the real enforcement inside undoMostRecentVisitMutation; the toast
// disappearing here is a convenience, not the guarantee.
const UNDO_WINDOW_MS = 5 * 60 * 1000;
const MESSAGE_TOAST_MS = 4 * 1000;

interface ToastState {
  message: string;
  /** Present only when this message's mutation can still be undone. */
  auditLogId: string | null;
}

function toggleButtonClass(isSelected: boolean): string {
  return isSelected
    ? "rounded-[--radius-el] border border-green bg-green-soft px-3 py-1 text-sm"
    : "rounded-[--radius-el] border border-line px-3 py-1 text-sm";
}

export default function DayScreen() {
  const today = todayInCairo();
  const weekday = weekdayOf(today);

  const [staticData, setStaticData] = useState<StaticData | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [isBookingSheetOpen, setIsBookingSheetOpen] = useState(false);

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

      setStaticData({
        locations: activeLocations,
        practitioners: activePractitioners,
        schedules,
        services: activeServices,
      });
      setSelectedLocationId(activeLocations[0]?.id ?? null);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

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
  // table (e.g. a one-tap attendance mark, a booking, or an undo of either),
  // so the row and the counters update without a manual refetch.
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

      const [patients, services] = await Promise.all([
        db.patients.bulkGet(patientIds),
        db.services.bulkGet(serviceIds),
      ]);

      const patientsById = new Map(
        patients.filter((patient): patient is Patient => patient != null).map((patient) => [patient.id, patient]),
      );
      const servicesById = new Map(
        services.filter((service): service is Service => service != null).map((service) => [service.id, service]),
      );

      return { visits, patientsById, servicesById };
    }, [staticData, practitionersToShow, today, selectedLocationId]) ?? EMPTY_DYNAMIC_DATA;

  useEffect(() => {
    if (!toastState) {
      return;
    }
    const timeoutMs = toastState.auditLogId ? UNDO_WINDOW_MS : MESSAGE_TOAST_MS;
    const timeout = setTimeout(() => setToastState(null), timeoutMs);
    return () => clearTimeout(timeout);
  }, [toastState]);

  async function handleMarkArrived(visit: Visit) {
    try {
      const auditLogId = await markVisitArrived(db, visit.id);
      setToastState({ message: dayScreenStrings.attendanceMarked, auditLogId });
    } catch (error) {
      console.error(error);
    }
  }

  async function handleUndo() {
    if (!toastState?.auditLogId) {
      return;
    }
    try {
      const outcome = await undoMostRecentVisitMutation(db, toastState.auditLogId);
      setToastState(outcome.ok ? null : { message: dayScreenStrings.undoRefused, auditLogId: null });
    } catch (error) {
      console.error(error);
    }
  }

  function handleBooked(auditLogId: string) {
    setToastState({ message: dayScreenStrings.visitBooked, auditLogId });
  }

  function handleBookingCollision() {
    setToastState({ message: dayScreenStrings.bookingSlotTakenError, auditLogId: null });
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

  // The booking sheet always targets one practitioner: whichever the filter
  // has selected, or the first one when "all" is active.
  const currentPractitionerId = selectedPractitionerId ?? staticData.practitioners[0]?.id ?? null;
  const currentPractitioner =
    staticData.practitioners.find((practitioner) => practitioner.id === currentPractitionerId) ?? null;
  const currentPractitionerSchedule = schedulesForSelectedLocation.find(
    (schedule) =>
      schedule.practitioner_id === currentPractitionerId &&
      schedule.weekday === weekday &&
      schedule.mode === ScheduleMode.Slots,
  );
  const currentPractitionerVisits = dynamicData.visits.filter(
    (visit) => visit.practitioner_id === currentPractitionerId,
  );
  const defaultService = staticData.services[0] ?? null;

  const canBook = Boolean(
    currentPractitioner && selectedLocationId && currentPractitionerSchedule && defaultService,
  );

  return (
    <main className={`mx-auto max-w-3xl px-6 pt-16 ${toastState ? "pb-28" : "pb-16"}`}>
      <h1 className="font-display text-4xl font-semibold text-green">Clintra</h1>
      <p className="mt-2 text-muted">
        {formatCairoDisplayDateParts(today).map((part, index) =>
          part.type === "day" ? (
            <Ltr key={index}>{part.value}</Ltr>
          ) : (
            <span key={index}>{part.value}</span>
          ),
        )}
      </p>

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
              onMarkArrived={handleMarkArrived}
            />
          );
        })}
      </div>

      {!isBookingSheetOpen && canBook && (
        <button
          type="button"
          onClick={() => setIsBookingSheetOpen(true)}
          className="fixed bottom-24 end-6 z-10 rounded-full bg-green px-6 py-3 font-semibold text-paper shadow-lg"
        >
          {dayScreenStrings.bookingButtonLabel}
        </button>
      )}

      {isBookingSheetOpen &&
        currentPractitioner &&
        currentPractitionerSchedule &&
        selectedLocationId &&
        defaultService && (
          <BookingSheet
            practitioner={currentPractitioner}
            schedule={currentPractitionerSchedule}
            visitsForPractitioner={currentPractitionerVisits}
            locationId={selectedLocationId}
            orgId={currentPractitioner.org_id}
            service={defaultService}
            visitDate={today}
            onDismiss={() => setIsBookingSheetOpen(false)}
            onBooked={handleBooked}
            onCollision={handleBookingCollision}
          />
        )}

      {toastState && (
        <UndoToast message={toastState.message} onUndo={toastState.auditLogId ? handleUndo : undefined} />
      )}
    </main>
  );
}
