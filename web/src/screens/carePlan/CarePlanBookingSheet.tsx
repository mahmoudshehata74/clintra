import { useState } from "react";
import { createPortal } from "react-dom";
import { db } from "../../db/database";
import type { CarePlan, Patient, Practitioner, Schedule, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { todayInCairo, weekdayOf, type ClinicDay } from "../../domain/time";
import BookingSheet from "../day/BookingSheet";
import { resolveDayScheduleState } from "../day/scheduleState";
import type { BookNextState } from "./carePlanModel";

interface CarePlanBookingSheetProps {
  plan: CarePlan;
  /** The session to book, and the day suggested for it. */
  book: BookNextState;
  onDismiss: () => void;
}

interface BookingData {
  patient: Patient;
  practitioner: Practitioner;
  schedules: Schedule[];
  services: Service[];
}

/**
 * "احجز الجلسة التالية": the day screen's own BookingSheet for the plan's
 * practitioner at the plan's location, prefilled with the plan's patient,
 * the session's service and its suggested day, and linking the booked
 * visit to the session. The day can move from there; each day's schedule
 * and visits are read for it. Rendered into a body-level portal, over the
 * plan's sheet.
 */
export default function CarePlanBookingSheet({ plan, book, onDismiss }: CarePlanBookingSheetProps) {
  const [visitDate, setVisitDate] = useState<ClinicDay>(book.date);

  const data = useLiveQuery<BookingData | null>(async () => {
    const [patient, practitioner, schedules, services] = await Promise.all([
      db.patients.get(plan.patient_id),
      db.practitioners.get(plan.practitioner_id),
      db.schedules.toArray(),
      db.services.toArray(),
    ]);
    return patient && practitioner ? { patient, practitioner, schedules, services } : null;
  }, [plan.patient_id, plan.practitioner_id]);
  const visits =
    useLiveQuery<Visit[]>(
      () => db.visits.where("[practitioner_id+visit_date]").equals([plan.practitioner_id, visitDate]).toArray(),
      [plan.practitioner_id, visitDate],
    ) ?? null;

  if (!data || visits === null) {
    return null;
  }

  const practitionerSchedules = data.schedules.filter((schedule) => schedule.practitioner_id === plan.practitioner_id);
  const scheduleState = resolveDayScheduleState(
    practitionerSchedules.find((schedule) => schedule.location_id === plan.location_id && schedule.weekday === weekdayOf(visitDate)),
    practitionerSchedules.length > 0,
  );

  return createPortal(
    <div className="print:hidden">
      <BookingSheet
        // A new day starts the sheet over on that day's slots.
        key={visitDate}
        practitioner={data.practitioner}
        scheduleState={scheduleState}
        visitsForPractitioner={visits}
        locationId={plan.location_id}
        orgId={plan.org_id}
        services={data.services.filter((service) => service.is_active)}
        visitDate={visitDate}
        mode="booking"
        showPractitionerName={false}
        prefill={{
          patient: data.patient,
          serviceId: book.serviceId,
          carePlanItemId: book.itemId,
          earliestDate: todayInCairo(),
          onVisitDateChange: setVisitDate,
        }}
        onDismiss={onDismiss}
        // The plan's sheet shows the session booked; there is no day-screen toast to undo from.
        onBooked={() => {}}
        onCollision={() => {}}
      />
    </div>,
    document.body,
  );
}
