import { useCallback, useRef, useState, type FormEvent } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import Popover from "../../components/ui/Popover";
import type { ClockTime } from "../../domain/time";
import { DELAY_PRESET_MINUTES, effectiveStartTime, normalizeDelayDigits, parseDelayMinutes } from "./dayDelay";
import { dayScreenStrings } from "./strings";

interface DelayControlProps {
  delayMinutes: number;
  /** Null when today has no schedule — nothing to compute an effective start time from. */
  scheduleStartTime: ClockTime | null;
  onSetDelay: (minutes: number) => void;
}

/**
 * The summary slab's doctor-delay trigger (prototype `.sb` — Button's onDark
 * md variant) and its picker. The trigger's own label is static
 * (delayControlTriggerLabel), with the current amount appended once set; the
 * slot grid's own times never change, so the effective start time this
 * implies only ever shows inside the open picker, not on the slab itself.
 *
 * The picker is a Popover (a body-level portal), not a child of the slab:
 * the slab's rounded frame is overflow-hidden and used to cut the picker
 * down to a sliver under its buttons. It offers the presets, a minutes
 * field (whole minutes, 1-240; Enter or "سجّل" applies, anything else shows
 * an error and applies nothing) and "clear".
 */
export default function DelayControl({ delayMinutes, scheduleStartTime, onSetDelay }: DelayControlProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
    setCustomText("");
    setCustomError(false);
  }, []);

  function choose(minutes: number) {
    onSetDelay(minutes);
    closePicker();
  }

  function applyCustom(event: FormEvent) {
    event.preventDefault();
    const parsed = parseDelayMinutes(customText);
    if (!parsed.ok) {
      setCustomError(true);
      return;
    }
    choose(parsed.minutes);
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="onDark"
        onClick={() => (isPickerOpen ? closePicker() : setIsPickerOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={isPickerOpen}
      >
        {dayScreenStrings.delayControlTriggerLabel}
        {delayMinutes > 0 && (
          <>
            {" · "}
            <Ltr>{delayMinutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
          </>
        )}
      </Button>

      {isPickerOpen && (
        <Popover
          anchorRef={triggerRef}
          onClose={closePicker}
          role="dialog"
          aria-label={dayScreenStrings.delayPickerTitle}
          widthClassName="w-60"
        >
          <p className="p-3 pb-1 text-sm font-medium">{dayScreenStrings.delayPickerTitle}</p>
          {delayMinutes > 0 && scheduleStartTime && (
            <p className="px-3 pb-2 text-xs text-muted">
              {dayScreenStrings.delayLinePrefix} <Ltr>{delayMinutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
              {" — "}
              {dayScreenStrings.delayLineActualStart}{" "}
              <Ltr>{effectiveStartTime(scheduleStartTime, delayMinutes)}</Ltr>
            </p>
          )}
          {DELAY_PRESET_MINUTES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => choose(minutes)}
              className="p-3 text-start hover:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green"
            >
              +<Ltr>{minutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
            </button>
          ))}
          <form onSubmit={applyCustom} noValidate className="flex flex-col gap-2 border-t border-hair p-3">
            <Field
              label={dayScreenStrings.delayCustomLabel}
              id="delay-custom-minutes"
              error={customError ? dayScreenStrings.delayCustomError : undefined}
            >
              <TextInput
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                variant="centered"
                value={customText}
                onChange={(event) => {
                  setCustomText(normalizeDelayDigits(event.target.value));
                  setCustomError(false);
                }}
              />
            </Field>
            <Button type="submit" variant="secondary">
              {dayScreenStrings.delayCustomApply}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => choose(0)}
            className="border-t border-hair p-3 text-start hover:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green"
          >
            {dayScreenStrings.delayClearOption}
          </button>
        </Popover>
      )}
    </>
  );
}
