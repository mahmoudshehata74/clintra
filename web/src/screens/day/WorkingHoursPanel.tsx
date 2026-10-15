import { useState } from "react";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import TimeField from "../../components/ui/TimeField";
import { db } from "../../db/database";
import { addWorkingDay, removeWorkingDay, updateWorkingHours, workingDayTemplate } from "../../db/scheduleSettings";
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
  type WorkingHoursRow,
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
  /** Null for a refusal about the whole day, shown under the editor's buttons. */
  field: WorkingHoursField | null;
  message: string;
}

/**
 * Panel A, prototype #s12 (`.set-list`, `.set-row`, `.day`, `.hours`,
 * `.mode`, `.edit`): the current practitioner's week, one row per weekday.
 * Every row carries "تعديل", as in the prototype, opening its inline editor
 * on the shared Field/TextInput/Button. A working day's editor holds the
 * same three fields, checks and save as before, plus "خليه إجازة"
 * (removeWorkingDay). A day off's holds the hours only, starting from the
 * practitioner's most common hours (workingDayTemplate), and "خليه يوم شغل"
 * saves it as a working day (addWorkingDay). Saving is per row, so there is
 * no `.runrow` "save all" footer here.
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

  // The row being edited, by its WorkingHoursRow key (a schedule id, or `off-{weekday}`).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [slotMinutes, setSlotMinutes] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [saving, setSaving] = useState(false);

  function beginEdit(row: WorkingHoursRow) {
    setEditingKey(row.key);
    if (row.schedule) {
      setStartTime(row.schedule.start_time);
      setEndTime(row.schedule.end_time);
      setSlotMinutes(row.schedule.slot_minutes != null ? String(row.schedule.slot_minutes) : "");
      setMaxCapacity(row.schedule.max_capacity != null ? String(row.schedule.max_capacity) : "");
    } else {
      const template = workingDayTemplate(schedules);
      setStartTime(template.startTime);
      setEndTime(template.endTime);
    }
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
      setEditingKey(null);
    } finally {
      setSaving(false);
    }
  }

  async function addDay(weekday: number) {
    if (endTime <= startTime) {
      setError({ field: "end", message: dayScreenStrings.hoursEndBeforeStartError });
      return;
    }
    setSaving(true);
    try {
      const result = await addWorkingDay(db, { practitionerId, locationId, weekday, startTime, endTime });
      // The other refusals (already a working day, no practitioner) mean the
      // list on screen is out of date; the live query redraws it.
      if (!result.ok && result.reason === "end_before_start") {
        setError({ field: "end", message: dayScreenStrings.hoursEndBeforeStartError });
        return;
      }
      setEditingKey(null);
    } finally {
      setSaving(false);
    }
  }

  async function makeDayOff(weekday: number) {
    setSaving(true);
    try {
      const result = await removeWorkingDay(db, { practitionerId, locationId, weekday });
      if (!result.ok && result.reason === "upcoming_visits_on_day") {
        setError({ field: null, message: dayScreenStrings.hoursUpcomingVisitsError });
        return;
      }
      setEditingKey(null);
    } finally {
      setSaving(false);
    }
  }

  function errorFor(field: WorkingHoursField): string | undefined {
    return error?.field === field ? error.message : undefined;
  }

  const dayError = error !== null && error.field === null ? error.message : null;

  return (
    <SetBody>
      <SetList>
        {buildWorkingHoursRows(schedules).map((row) => {
          const schedule = row.schedule;
          const isSlots = schedule?.mode === ScheduleMode.Slots;
          const isEditing = editingKey === row.key;
          const idPrefix = `hours-${row.key}`;
          return (
            <SetRow
              key={row.key}
              layout="hours"
              editor={
                isEditing ? (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                      <Field label={dayScreenStrings.hoursStartLabel} id={`${idPrefix}-start`} error={errorFor("start")}>
                        <TimeField label={dayScreenStrings.hoursStartLabel} value={startTime} onChange={setStartTime} />
                      </Field>
                      <Field label={dayScreenStrings.hoursEndLabel} id={`${idPrefix}-end`} error={errorFor("end")}>
                        <TimeField label={dayScreenStrings.hoursEndLabel} value={endTime} onChange={setEndTime} />
                      </Field>
                      {schedule && (
                        <Field
                          label={isSlots ? dayScreenStrings.hoursSlotMinutesLabel : dayScreenStrings.hoursCapacityLabel}
                          id={`${idPrefix}-${isSlots ? "slot" : "capacity"}`}
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
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        disabled={saving}
                        onClick={() => (schedule ? save(schedule) : addDay(row.weekday))}
                      >
                        {schedule ? dayScreenStrings.settingsSaveAction : dayScreenStrings.hoursAddWorkingDayAction}
                      </Button>
                      {schedule && (
                        <Button variant="danger" size="sm" disabled={saving} onClick={() => makeDayOff(row.weekday)}>
                          {dayScreenStrings.hoursMakeDayOffAction}
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => setEditingKey(null)}>
                        {dayScreenStrings.settingsCancelAction}
                      </Button>
                    </div>
                    {dayError && (
                      <p role="alert" className="text-[12.5px] text-danger">
                        {dayError}
                      </p>
                    )}
                  </div>
                ) : undefined
              }
            >
              <span className="text-[12.5px] font-bold text-text">{dayScreenStrings.weekdayNames[row.weekday]}</span>
              {/* `.set-row .hours` in the page's own right-to-left order, as
                  the prototype renders it: the start time on the right. */}
              <span className="text-[13.5px] font-semibold text-text tabular-nums">{row.hours}</span>
              <div className="flex items-center gap-1.5">
                {/* `.set-row .mode`; the prototype tints the day-off label
                    faint, which Badge's neutral tone (muted) only
                    approximates — a closer tone would be a new Badge
                    variant for this one label. */}
                <Badge appearance="soft" tone="neutral">
                  {formatWorkingHoursMode(row.mode, MODE_STRINGS)}
                </Badge>
                {!isEditing && (
                  <Button variant="outline" onClick={() => beginEdit(row)}>
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
