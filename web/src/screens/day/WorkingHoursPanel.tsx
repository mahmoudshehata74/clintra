import { useState } from "react";
import Ltr from "../../components/Ltr";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import { db } from "../../db/database";
import { updateWorkingHours } from "../../db/scheduleSettings";
import type { Schedule } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { ScheduleMode } from "../../domain/scheduleMode";
import { SetBody, SetList, SetRow } from "./SettingsLayout";
import { dayScreenStrings } from "./strings";
import {
  buildWorkingHoursRows,
  formatWorkingHoursMode,
  workingHoursErrorField,
  type WorkingHoursField,
} from "./workingHoursRows";

const MODE_STRINGS = {
  slots: dayScreenStrings.hoursModeSlots,
  queue: dayScreenStrings.hoursModeQueue,
  dayOff: dayScreenStrings.hoursModeDayOff,
  minutesUnit: dayScreenStrings.minutesShortUnit,
  patientsUnit: dayScreenStrings.hoursModePatientsUnit,
};

const REFUSAL_MESSAGE = {
  end_before_start: dayScreenStrings.hoursEndBeforeStartError,
  invalid_slot_minutes: dayScreenStrings.hoursInvalidSlotError,
  invalid_capacity: dayScreenStrings.hoursInvalidCapacityError,
  visits_on_old_grid: dayScreenStrings.hoursVisitsOnOldGridError,
  schedule_not_found: dayScreenStrings.hoursVisitsOnOldGridError,
} as const;

interface FieldError {
  field: WorkingHoursField;
  message: string;
}

/**
 * Panel A, prototype #s12 (`.set-list`, `.set-row`, `.day`, `.hours`,
 * `.mode`, `.edit`): the current practitioner's week, one row per weekday.
 * "تعديل" opens that schedule's inline editor — the same three fields,
 * checks and save as before, on the shared Field/TextInput/Button. Saving
 * is per row, so there is no `.runrow` "save all" footer here.
 */
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
      return all.filter((schedule) => schedule.practitioner_id === practitionerId && schedule.location_id === locationId);
    }, [practitionerId, locationId]) ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [slotMinutes, setSlotMinutes] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
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
      setError({ field: "end", message: dayScreenStrings.hoursEndBeforeStartError });
      return;
    }
    if (isSlots && (slotMinutes.trim() === "" || Number(slotMinutes) <= 0)) {
      setError({ field: "slotMinutes", message: dayScreenStrings.hoursInvalidSlotError });
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
        setError({ field: workingHoursErrorField(result.reason), message: REFUSAL_MESSAGE[result.reason] });
        return;
      }
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  function errorFor(field: WorkingHoursField): string | undefined {
    return error?.field === field ? error.message : undefined;
  }

  return (
    <SetBody>
      <SetList>
        {buildWorkingHoursRows(schedules).map((row) => {
          const schedule = row.schedule;
          const isSlots = schedule?.mode === ScheduleMode.Slots;
          const isEditing = schedule !== undefined && editingId === schedule.id;
          return (
            <SetRow
              key={row.key}
              layout="hours"
              editor={
                isEditing ? (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
                      <Field label={dayScreenStrings.hoursStartLabel} id={`hours-${schedule.id}-start`} error={errorFor("start")}>
                        <TextInput type="time" variant="centered" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                      </Field>
                      <Field label={dayScreenStrings.hoursEndLabel} id={`hours-${schedule.id}-end`} error={errorFor("end")}>
                        <TextInput type="time" variant="centered" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                      </Field>
                      <Field
                        label={isSlots ? dayScreenStrings.hoursSlotMinutesLabel : dayScreenStrings.hoursCapacityLabel}
                        id={`hours-${schedule.id}-${isSlots ? "slot" : "capacity"}`}
                        error={errorFor(isSlots ? "slotMinutes" : "capacity")}
                      >
                        <TextInput
                          type="number"
                          inputMode="numeric"
                          variant="centered"
                          value={isSlots ? slotMinutes : maxCapacity}
                          onChange={(e) => (isSlots ? setSlotMinutes(e.target.value) : setMaxCapacity(e.target.value))}
                        />
                      </Field>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" className="flex-1" disabled={saving} onClick={() => save(schedule)}>
                        {dayScreenStrings.settingsSaveAction}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                        {dayScreenStrings.settingsCancelAction}
                      </Button>
                    </div>
                  </div>
                ) : undefined
              }
            >
              <span className="text-[12.5px] font-bold text-text">{dayScreenStrings.weekdayNames[row.weekday]}</span>
              <span className="text-[13.5px] font-semibold text-text tabular-nums">
                <Ltr>{row.hours}</Ltr>
              </span>
              <div className="flex items-center gap-1.5">
                {/* `.set-row .mode`; the prototype tints the day-off label
                    faint, which Badge's neutral tone (muted) only
                    approximates — a closer tone would be a new Badge
                    variant for this one label. */}
                <Badge appearance="soft" tone="neutral">
                  {formatWorkingHoursMode(row.mode, MODE_STRINGS)}
                </Badge>
                {/* A day off has no schedule row to edit — adding a working
                    day is not something settings offers today. */}
                {schedule && !isEditing && (
                  <Button variant="outline" onClick={() => beginEdit(schedule)}>
                    {dayScreenStrings.hoursEditAction}
                  </Button>
                )}
              </div>
            </SetRow>
          );
        })}
      </SetList>
    </SetBody>
  );
}
