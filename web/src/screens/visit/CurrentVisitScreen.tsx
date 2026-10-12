import { useEffect, useState } from "react";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import { db } from "../../db/database";
import { getDeviceBinding } from "../../db/deviceRegistration";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitCompleted } from "../../db/visitAttendance";
import type { ClinicDay } from "../../domain/time";
import { findCurrentVisit } from "../doctor/doctorDay";
import { useVisitAdvance } from "../doctor/useVisitAdvance";
import { visitWorkspaceStrings as T } from "./strings";
import VisitWorkspace from "./VisitWorkspace";

interface CurrentVisitScreenProps {
  /** The acting membership's own practitioner (memberships.practitioner_id). */
  practitionerId: string;
  /** The clinic day the day screen is showing, as the doctor's day reads it. */
  today: ClinicDay;
  /** The empty state's button, and where "حفظ ومتابعة لاحقًا" goes. */
  onOpenDoctorDay: () => void;
}

/**
 * "الزيارة الحالية": the visit workspace (reference screen 10) for this
 * practitioner's in_room visit today at the device's location — the visit
 * the doctor's day shows in its hero — or an empty state that points back to
 * the doctor's day. Closing the visit goes through the doctor's day's own
 * write path and cooldown (useVisitAdvance). Like the doctor's day it stays
 * mounted under the lock overlay, so half-typed text survives an idle lock.
 */
export default function CurrentVisitScreen({ practitionerId, today, onOpenDoctorDay }: CurrentVisitScreenProps) {
  const [locationId, setLocationId] = useState<string | null>(null);
  const { advance, isCoolingDown, advanceError } = useVisitAdvance();

  useEffect(() => {
    let cancelled = false;
    void getDeviceBinding(db).then((binding) => {
      if (!cancelled) {
        setLocationId(binding.location_id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = useLiveQuery(async () => {
    if (!locationId) {
      return undefined;
    }
    const visits = await db.visits.where("[practitioner_id+visit_date]").equals([practitionerId, today]).toArray();
    return findCurrentVisit(visits.filter((visit) => visit.location_id === locationId));
  }, [locationId, practitionerId, today]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3.5 px-6 pt-6 pb-16 print:hidden">
      {current === undefined ? (
        <p className="text-muted">{T.loadingLabel}</p>
      ) : current === null ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-muted">{T.currentVisitEmpty}</p>
          <Button variant="secondary" onClick={onOpenDoctorDay}>
            {T.currentVisitOpenDoctorDay}
          </Button>
        </Card>
      ) : (
        <Card>
          <VisitWorkspace
            key={current.id}
            visitId={current.id}
            layout="page"
            onClose={onOpenDoctorDay}
            completion={{
              onComplete: (visit) => void advance(visit, (visitId) => markVisitCompleted(db, visitId)),
              isCoolingDown,
              error: advanceError,
            }}
          />
        </Card>
      )}
    </main>
  );
}
