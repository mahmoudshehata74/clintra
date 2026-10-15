import { timeFieldStrings } from "../strings";
import { SelectInput } from "./Field";
import { HOUR_OPTIONS, joinTimeValue, minuteOptions, splitTimeValue } from "./timeValue";

export interface TimeFieldProps {
  /** "HH:MM", 24-hour. */
  value: string;
  onChange: (value: string) => void;
  /** The group's accessible name — the same text as the Field label around it. */
  label: string;
  disabled?: boolean;
  // Injected by Field: `id` lands on the hour select, so the Field's label
  // focuses it; aria-invalid and aria-describedby go on both selects.
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * The app's one time input: two selects, hour 00–23 and minute in 5-minute
 * steps, Latin digits, always 24-hour — a native `<input type="time">`
 * follows the device locale instead ("09:00 AM"). The pair reads left to
 * right like the time it makes ("09 : 30"), whatever the page direction.
 * Wrap it in Field like a TextInput; `label` names the group for screen
 * readers, and each select names its own part (الساعة / الدقيقة).
 */
export default function TimeField({
  value,
  onChange,
  label,
  disabled,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: TimeFieldProps) {
  const parts = splitTimeValue(value);

  return (
    <div role="group" aria-label={label} dir="ltr" className="flex items-center gap-1.5">
      <SelectInput
        id={id}
        aria-label={timeFieldStrings.hourLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        value={parts.hour}
        onChange={(event) => onChange(joinTimeValue({ hour: event.target.value, minute: parts.minute }))}
      >
        {HOUR_OPTIONS.map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </SelectInput>
      <span aria-hidden="true" className="text-[15px] font-bold text-muted">
        :
      </span>
      <SelectInput
        id={id ? `${id}-minute` : undefined}
        aria-label={timeFieldStrings.minuteLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        value={parts.minute}
        onChange={(event) => onChange(joinTimeValue({ hour: parts.hour, minute: event.target.value }))}
      >
        {minuteOptions(parts.minute).map((minute) => (
          <option key={minute} value={minute}>
            {minute}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}
