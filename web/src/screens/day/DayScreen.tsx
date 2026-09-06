import { useEffect, useMemo, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { seedDatabase } from "../../db/seed";
import type { Location, Patient, Practitioner, Schedule, Service, Visit } from "../../db/types";
import { ScheduleMode } from "../../domain/scheduleMode";
import { todayInCairo, weekdayOf } from "../../domain/time";
import Counters from "./Counters";
import { computeDayCounters } from "./dayCounters";
import PractitionerColumn from "./PractitionerColumn";
import { dayScreenStrings } from "./strings";

interface StaticData {
  locations: Location[];
  practitioners: Practitioner[];
  schedules: Schedule[];
}

interface DynamicData {
  visits: Visit[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
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
  const [dynamicData, setDynamicData] = useState<DynamicData>({
    visits: [],
    patientsById: new Map(),
    servicesById: new Map(),
  });
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await seedDatabase(db);
      const [locations, practitioners, schedules] = await Promise.all([
        db.locations.toArray(),
        db.practitioners.toArray(),
        db.schedules.toArray(),
      ]);

      if (cancelled) {
        return;
      }

      const activeLocations = locations.filter((location) => location.is_active);
      const activePractitioners = practitioners.filter((practitioner) => practitioner.is_active);

      setStaticData({ locations: activeLocations, practitioners: activePractitioners, schedules });
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

  useEffect(() => {
    // Nothing to fetch: practitionersToShow is only ever empty before
    // staticData has loaded, or when the org truly has none, in which case
    // the initial empty dynamicData already reflects that correctly.
    if (!staticData || practitionersToShow.length === 0) {
      return;
    }

    let cancelled = false;

    async function load() {
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

      if (cancelled) {
        return;
      }

      const patientsById = new Map(
        patients.filter((patient): patient is Patient => patient != null).map((patient) => [patient.id, patient]),
      );
      const servicesById = new Map(
        services.filter((service): service is Service => service != null).map((service) => [service.id, service]),
      );

      setDynamicData({ visits, patientsById, servicesById });
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [staticData, today, selectedLocationId, practitionersToShow]);

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-4xl font-semibold text-green">Clintra</h1>
      <p className="mt-2 text-muted">
        <Ltr>{today}</Ltr>
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
            />
          );
        })}
      </div>
    </main>
  );
}
