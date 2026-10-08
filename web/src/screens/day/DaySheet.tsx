import { useEffect, useState, type ReactNode } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import type { ClinicDay, Patient, Schedule, Service, Visit } from "../../db/types";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import { ScheduleMode } from "../../domain/scheduleMode";
import { clockTimeInCairo, formatCairoDisplayDate, todayInCairo, weekdayOf } from "../../domain/time";
import { SheetPanelBody } from "../../components/ui/SheetPanel";
import { selectDaySheetVisits } from "./daySheetVisits";
import { PrintClinicBlock, PrintDayLine, PrintFoot, PrintHeaderNote, PrintPage, PrintTable, PrintTd, PrintTh } from "./PrintPage";
import Sheet from "./Sheet";
import { usePrintClinic } from "./usePrintClinic";
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

const EMPTY_DATA: DaySheetData = {
  isQueueMode: false,
  visits: [],
  patientsById: new Map(),
  servicesById: new Map(),
};

/**
 * A printable list of tomorrow's booked visits for one practitioner and
 * location, in the order staff will actually work through them the next
 * day — see domain layer's selectDaySheetVisits for the ordering rule. The
 * on-screen preview (inside the sheet) and the actual printed page
 * (print:block, outside it) render the exact same PrintPage content, so what
 * staff see before printing is what comes out of the printer — only the
 * header note's own text differs (placeholder vs. warning), per its existing
 * rule.
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

  const clinic = usePrintClinic(locationId);
  const dayLine = (
    <>
      {formatCairoDisplayDate(tomorrow)} <Ltr>{tomorrow.slice(0, 4)}</Ltr> — <Ltr>{rows.length}</Ltr>{" "}
      {dayScreenStrings.daySheetPatientCountUnit}
    </>
  );
  const now = new Date();
  const printedAt = `${dayScreenStrings.printedAtPrefix} ${formatCairoDisplayDate(todayInCairo(now))} ${clockTimeInCairo(now.toISOString())}`;

  const pageBodyProps = {
    rows,
    patientsById: data.patientsById,
    servicesById: data.servicesById,
    isQueueMode: data.isQueueMode,
    clinic,
    dayLine,
    printedAt,
  };

  return (
    <>
      <div className="print:hidden">
        <Sheet onDismiss={onDismiss} size="lg">
          <SheetHeader
            title={dayScreenStrings.daySheetTitle}
            onDismiss={onDismiss}
            extra={
              <Button variant="onDark" size="sm" onClick={() => setPrintRequested(true)}>
                {dayScreenStrings.printDaySheetAction}
              </Button>
            }
          />
          <SheetPanelBody>
            <PageBody
              headerNote={dayScreenStrings.printHeaderPlaceholder}
              {...pageBodyProps}
            />
          </SheetPanelBody>
        </Sheet>
      </div>

      {printRequested && (
        <div className="hidden print:block">
          <PageBody headerNote={dayScreenStrings.printHeaderWarning} {...pageBodyProps} />
        </div>
      )}
    </>
  );
}

function phoneOrPlaceholder(patient: Patient | undefined): string {
  return patient?.phone ? formatEgyptianPhoneForDisplay(patient.phone) : dayScreenStrings.daySheetNoPhone;
}

function positionOrTime(visit: Visit, isQueueMode: boolean): string {
  return isQueueMode ? String(visit.position) : clockTimeInCairo(visit.scheduled_at!);
}

interface PageBodyProps {
  headerNote: string;
  rows: Visit[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
  isQueueMode: boolean;
  clinic: ReturnType<typeof usePrintClinic>;
  dayLine: ReactNode;
  printedAt: string;
}

function PageBody({
  headerNote,
  rows,
  patientsById,
  servicesById,
  isQueueMode,
  clinic,
  dayLine,
  printedAt,
}: PageBodyProps) {
  return (
    <PrintPage>
      <PrintHeaderNote>{headerNote}</PrintHeaderNote>
      <PrintClinicBlock {...clinic} />
      <PrintDayLine>{dayLine}</PrintDayLine>
      <PrintTable>
        <thead>
          <tr>
            <PrintTh>{dayScreenStrings.daySheetColumnTime}</PrintTh>
            <PrintTh>{dayScreenStrings.daySheetColumnPatient}</PrintTh>
            <PrintTh>{dayScreenStrings.daySheetColumnService}</PrintTh>
            <PrintTh>{dayScreenStrings.daySheetColumnPhone}</PrintTh>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <PrintTd colSpan={4}>{dayScreenStrings.daySheetEmpty}</PrintTd>
            </tr>
          )}
          {rows.map((visit) => {
            const patient = patientsById.get(visit.patient_id);
            const service = visit.service_id ? servicesById.get(visit.service_id) : undefined;
            return (
              <tr key={visit.id}>
                <PrintTd>
                  <Ltr>{positionOrTime(visit, isQueueMode)}</Ltr>
                </PrintTd>
                <PrintTd>{patient?.full_name ?? ""}</PrintTd>
                <PrintTd>{service?.name ?? ""}</PrintTd>
                <PrintTd mono>
                  <Ltr>{phoneOrPlaceholder(patient)}</Ltr>
                </PrintTd>
              </tr>
            );
          })}
        </tbody>
      </PrintTable>
      <PrintFoot printedAt={printedAt} />
    </PrintPage>
  );
}
