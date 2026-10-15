import { clockTimeInCairo, type ClinicDay } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Visit } from "../../db/types";
import { computeSinceLabel } from "../doctor/doctorDay";
import { computeElapsedLabel } from "./elapsedLabel";
import { dayScreenStrings } from "./strings";
import { arrivedWord } from "./statusStyle";

/**
 * A slot row's `.until` sub-line — arrived/in_room/completed/no_show only.
 * arrived's is a fixed clock time, always shown. in_room and no_show are
 * live "since" counts ("من 7د"), and read "دلوقتي" under a minute through
 * the doctor's day's own rule (computeSinceLabel), the same one the queue
 * uses. completed shows its duration. All three show nothing unless `today`
 * is the real current Cairo day: a ?seedDay=1 pin would otherwise read the
 * seeded timestamps against real now.
 */
export function slotUntilText(visit: Visit, patient: Patient | undefined, today: ClinicDay, now: Date): string | null {
  if (visit.status === VisitStatus.Arrived && visit.arrived_at) {
    return `${arrivedWord(patient?.gender)} ${clockTimeInCairo(visit.arrived_at)}`;
  }
  if (visit.status === VisitStatus.Completed && visit.started_at && visit.ended_at) {
    return computeElapsedLabel(visit.started_at, visit.ended_at, today, now);
  }
  const sinceInstant =
    visit.status === VisitStatus.InRoom ? visit.started_at : visit.status === VisitStatus.NoShow ? visit.scheduled_at : null;
  if (!sinceInstant) {
    return null;
  }
  const since = computeSinceLabel(sinceInstant, today, now);
  if (since === null) {
    return null;
  }
  return since.kind === "just_now" ? dayScreenStrings.untilNow : `${dayScreenStrings.untilSincePrefix} ${since.label}`;
}
