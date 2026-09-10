import { useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { updateWorkingHours, type UpdateWorkingHoursResult } from "../../db/scheduleSettings";
import type { Schedule } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { ScheduleMode } from "../../domain/scheduleMode";
import { dayScreenStrings } from "./strings";

const FIELD_CLASS =
  "w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start focus:border-green focus:outline-none focus:ring-[3px] focus:ring-green-soft";

type RefusalReason = Exclude<UpdateWorkingHoursResult, { ok: true }>["reason"];

function reasonMessage(reason: RefusalReason): string {
  switch (reason) {
    case "end_before_start":
      return dayScreenStrings.hoursEndBeforeStartError;
    case "invalid_slot_minutes":
      return dayScreenStrings.hoursInvalidSlotError;
    case "invalid_capacity":
      return dayScreenStrings.hoursInvalidCapacityError;
    case "visits_on_old_grid":
      return dayScreenStrings.hoursVisitsOnOldGridError;
    case "schedule_not_found":
      return dayScreenStrings.hoursVisitsOnOldGridError;
  }
}

/** Panel A: the current practitioner's weekly working hours, one editable row per weekday. */
export default function WorkingHoursPanel({
  practitionerId,
  locationId,
}: {
  practitionerId: string;
  locationId: string;
}) {
  const schedules =
    useLiveQuery<Schedule[]>(async () => {
      const all = await db.schedules.toArray();
      return all
        .filter((schedule) => schedule.practitioner_id === practitionerId && schedule.location_id === locationId)
        .sort((a, b) => a.weekday - b.weekday);
    }, [practitionerId, locationId]) ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [slotMinutes, setSlotMinutes] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function beginEdit(schedule: Schedule) {
    setEditingId(schedule.id);
    setStartTime(schedule.start_time);
    setEndTime(schedule.end_time);
    setSlotMinutes(schedule.slot_minutes != null ? String(schedule.slot_minutes) : "");
    setMaxCapacity(schedule.max_capacity != null ? String(schedule.max_capacity) : "");
    setError(null);
  }

  async function save(schedule: Schedule) {
    const isSlots = schedule.mode === ScheduleMode.Slots;
    if (endTime <= startTime) {
      setError(dayScreenStrings.hoursEndBeforeStartError);
      return;
    }
    if (isSlots && (slotMinutes.trim() === "" || Number(slotMinutes) <= 0)) {
      setError(dayScreenStrings.hoursInvalidSlotError);
      return;
    }
    setSaving(true);
    try {
      const result = await updateWorkingHours(db, schedule.id, {
        startTime,
        endTime,
        slotMinutes: isSlots ? Number(slotMinutes) : null,
        maxCapacity: isSlots ? null : maxCapacity.trim() === "" ? null : Number(maxCapacity),
      });
      if (!result.ok) {
        setError(reasonMessage(result.reason));
        return;
      }
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ul className="mt-4 flex flex-col divide-y divide-line-soft">
      {schedules.map((schedule) => {
        const isSlots = schedule.mode === ScheduleMode.Slots;
        const isEditing = editingId === schedule.id;
        return (
          <li key={schedule.id} className="py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{dayScreenStrings.weekdayNames[schedule.weekday]}</span>
              <span className="flex items-center gap-2 text-sm text-muted">
                <Ltr>
                  {schedule.start_time} – {schedule.end_time}
                </Ltr>
                <span className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs">
                  {isSlots ? dayScreenStrings.hoursModeSlots : dayScreenStrings.hoursModeQueue}
                </span>
                {!isEditing && (
                  <button type="button" onClick={() => beginEdit(schedule)} className="text-green">
                    {dayScreenStrings.hoursEditAction}
                  </button>
                )}
              </span>
            </div>

            {isEditing && (
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm text-muted">
                  {dayScreenStrings.hoursStartLabel}
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={FIELD_CLASS} />
                </label>
                <label className="flex flex-col gap-1 text-sm text-muted">
                  {dayScreenStrings.hoursEndLabel}
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={FIELD_CLASS} />
                </label>
                <label className="flex flex-col gap-1 text-sm text-muted">
                  {isSlots ? dayScreenStrings.hoursSlotMinutesLabel : dayScreenStrings.hoursCapacityLabel}
                  <input
                    type="number"
                    inputMode="numeric"
                    value={isSlots ? slotMinutes : maxCapacity}
                    onChange={(e) => (isSlots ? setSlotMinutes(e.target.value) : setMaxCapacity(e.target.value))}
                    className={FIELD_CLASS}
                  />
                </label>
                {error && <p className="text-sm text-red">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => save(schedule)}
                    className="flex-1 rounded-[--radius-el] bg-green px-4 py-2 text-center font-semibold text-paper disabled:opacity-60"
                  >
                    {dayScreenStrings.settingsSaveAction}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-[--radius-el] border border-line px-4 py-2 text-ink"
                  >
                    {dayScreenStrings.settingsCancelAction}
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
