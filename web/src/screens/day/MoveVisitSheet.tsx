import { useMemo, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import type { Schedule, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { moveVisit } from "../../db/visitMove";
import { ScheduleMode } from "../../domain/scheduleMode";
import { addDaysToClinicDay, formatCairoDisplayDateParts, type ClinicDay } from "../../domain/time";
import { computeMoveTargets } from "./moveTargets";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";
import type { UndoAction } from "./undoAction";

const MOVE_TARGET_DAY_COUNT = 8;

interface MoveVisitSheetProps {
  visit: Visit;
  patientName: string;
  locationId: string;
  schedules: readonly Schedule[];
  startDate: ClinicDay;
  onDismiss: () => void;
  onMoved: (undo: UndoAction) => void;
  onCollision: () => void;
}

export default function MoveVisitSheet({
  visit,
  patientName,
  locationId,
  schedules,
  startDate,
  onDismiss,
  onMoved,
  onCollision,
}: MoveVisitSheetProps) {
  const [isMoving, setIsMoving] = useState(false);

  const dates = useMemo(
    () => Array.from({ length: MOVE_TARGET_DAY_COUNT }, (_, i) => addDaysToClinicDay(startDate, i)),
    [startDate],
  );

  const visitsByDate =
    useLiveQuery(async () => {
      const perDate = await Promise.all(
        dates.map((date) =>
          db.visits.where("[practitioner_id+visit_date]").equals([visit.practitioner_id, date]).toArray(),
        ),
      );
      return new Map(dates.map((date, index) => [date, perDate[index]]));
    }, [visit.practitioner_id, startDate]) ?? new Map<ClinicDay, Visit[]>();

  function scheduleForWeekday(weekday: number): Schedule | undefined {
    return schedules.find(
      (schedule) =>
        schedule.practitioner_id === visit.practitioner_id &&
        schedule.location_id === locationId &&
        schedule.weekday === weekday &&
        schedule.mode === ScheduleMode.Slots,
    );
  }

  const groups = computeMoveTargets(
    startDate,
    scheduleForWeekday,
    (date) => visitsByDate.get(date) ?? [],
  );

  async function handleSelectSlot(toDate: ClinicDay, toTime: string, toSchedule: Schedule) {
    setIsMoving(true);
    try {
      const result = await moveVisit(db, { visitId: visit.id, toDate, toTime, toSchedule });
      if (result.ok) {
        onMoved({
          kind: "visit_move",
          oldVisitAuditLogId: result.oldVisitAuditLogId,
          newVisitAuditLogId: result.newVisitAuditLogId,
        });
        onDismiss();
        return;
      }
      onCollision();
    } finally {
      setIsMoving(false);
    }
  }

  return (
    <Sheet onDismiss={onDismiss}>
      <p className="font-medium">{dayScreenStrings.moveSheetHeading}</p>
      <p className="mt-1 text-sm text-muted">{patientName}</p>
      <div className="mt-3 flex flex-col gap-4 overflow-y-auto">
        {groups.map((group) => {
          const schedule = scheduleForWeekday(group.weekday);
          if (!schedule) {
            return null;
          }
          return (
            <div key={group.date}>
              <p className="text-sm font-medium text-muted">
                {formatCairoDisplayDateParts(group.date).map((part, index) =>
                  part.type === "day" ? (
                    <Ltr key={index}>{part.value}</Ltr>
                  ) : (
                    <span key={index}>{part.value}</span>
                  ),
                )}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {group.slots.map((slot) => (
                  <li key={slot.time}>
                    <button
                      type="button"
                      disabled={isMoving}
                      onClick={() => handleSelectSlot(group.date, slot.time, schedule)}
                      className="flex w-full items-center gap-3 rounded-[--radius-el] border border-line p-3 text-start disabled:opacity-60"
                    >
                      <span className="text-muted">
                        <Ltr>{slot.time}</Ltr>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
