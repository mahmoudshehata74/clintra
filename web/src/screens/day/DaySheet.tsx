import { useEffect, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import type { ClinicDay, Patient, Schedule, Service, Visit } from "../../db/types";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import { ScheduleMode } from "../../domain/scheduleMode";
import { clockTimeInCairo, formatCairoDisplayDate, weekdayOf } from "../../domain/time";
import { selectDaySheetVisits } from "./daySheetVisits";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
import { dayScreenStrings } from "./strings";

interface DaySheetProps {
  practitionerId: string;
  locationId: string;
  tomorrow: ClinicDay;
  onDismiss: () => void;
}

interface DaySheetData {
  isQueueMode: boolean;
  visits: Visit[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
}

const EMPTY_DATA: DaySheetData = { isQueueMode: false, visits: [], patientsById: new Map(), servicesById: new Map() };

/**
 * A printable list of tomorrow's booked visits for one practitioner and
 * location, in the order staff will actually work through them the next
 * day — see domain layer's selectDaySheetVisits for the ordering rule.
 * Reuses InvoiceSheet's print-header safeguard: the placeholder note is
 * shown on screen only, and the printed page carries only the warning.
 */
export default function DaySheet({ practitionerId, locationId, tomorrow, onDismiss }: DaySheetProps) {
  const [printRequested, setPrintRequested] = useState(false);

  useEffect(() => {
    if (!printRequested) {
      return;
    }
    window.print();
    function handleAfterPrint() {
      setPrintRequested(false);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, [printRequested]);

  const data =
    useLiveQuery<DaySheetData>(async () => {
      const weekday = weekdayOf(tomorrow);
      const schedules = await db.schedules.toArray();
      const schedule: Schedule | undefined = schedules.find(
        (candidate) =>
          candidate.practitioner_id === practitionerId &&
          candidate.location_id === locationId &&
          candidate.weekday === weekday,
      );
      const isQueueMode = schedule?.mode === ScheduleMode.Queue;

      const allVisits = await db.visits
        .where("[practitioner_id+visit_date]")
        .equals([practitionerId, tomorrow])
        .toArray();
      const visits = allVisits.filter((visit) => visit.location_id === locationId);

      const patientIds = [...new Set(visits.map((visit) => visit.patient_id))];
      const serviceIds = [
        ...new Set(visits.map((visit) => visit.service_id).filter((id): id is string => id != null)),
      ];
      const [patients, services] = await Promise.all([
        db.patients.bulkGet(patientIds),
        db.services.bulkGet(serviceIds),
      ]);

      return {
        isQueueMode,
        visits,
        patientsById: new Map(patients.filter((p): p is Patient => p != null).map((p) => [p.id, p])),
        servicesById: new Map(services.filter((s): s is Service => s != null).map((s) => [s.id, s])),
      };
    }, [practitionerId, locationId, tomorrow]) ?? EMPTY_DATA;

  const rows = selectDaySheetVisits(data.visits, data.isQueueMode);

  function phoneOrPlaceholder(patient: Patient | undefined): string {
    return patient?.phone ? formatEgyptianPhoneForDisplay(patient.phone) : dayScreenStrings.daySheetNoPhone;
  }

  function positionOrTime(visit: Visit): string {
    return data.isQueueMode ? String(visit.position) : clockTimeInCairo(visit.scheduled_at!);
  }

  return (
    <>
      <div className="print:hidden">
        <Sheet onDismiss={onDismiss}>
          <SheetHeader
            title={
              <>
                {dayScreenStrings.daySheetTitle} — {formatCairoDisplayDate(tomorrow)}
              </>
            }
            onDismiss={onDismiss}
          />
          <p className="mt-2 text-xs text-muted">{dayScreenStrings.printHeaderPlaceholder}</p>

          <div className="mt-4 flex flex-col divide-y divide-line-soft overflow-y-auto">
            {rows.length === 0 && <p className="py-3 text-muted">{dayScreenStrings.daySheetEmpty}</p>}
            {rows.map((visit) => {
              const patient = data.patientsById.get(visit.patient_id);
              const service = visit.service_id ? data.servicesById.get(visit.service_id) : undefined;
              return (
                <div key={visit.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{patient?.full_name ?? ""}</span>
                    <Ltr>
                      <span className="text-sm text-muted">{positionOrTime(visit)}</span>
                    </Ltr>
                  </div>
                  <p className="text-sm text-muted">
                    <Ltr>{phoneOrPlaceholder(patient)}</Ltr>
                    {service ? ` — ${service.name}` : ""}
                  </p>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setPrintRequested(true)}
            className="mt-4 rounded-[--radius-el] border border-line px-4 py-3 text-center text-muted"
          >
            {dayScreenStrings.printDaySheetAction}
          </button>
        </Sheet>
      </div>

      {printRequested && (
        <div className="hidden print:block">
          <p className="text-center font-semibold">{dayScreenStrings.printHeaderWarning}</p>
          <h2 className="mt-4 text-center text-lg font-semibold">{dayScreenStrings.daySheetTitle}</h2>
          <p className="text-center">{formatCairoDisplayDate(tomorrow)}</p>
          <table className="mt-4 w-full">
            <tbody>
              {rows.map((visit) => {
                const patient = data.patientsById.get(visit.patient_id);
                const service = visit.service_id ? data.servicesById.get(visit.service_id) : undefined;
                return (
                  <tr key={visit.id}>
                    <td>{positionOrTime(visit)}</td>
                    <td>{patient?.full_name ?? ""}</td>
                    <td>{phoneOrPlaceholder(patient)}</td>
                    <td>{service?.name ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
