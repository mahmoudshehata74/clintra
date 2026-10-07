import { useEffect, useRef, useState } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import type { ClockTime } from "../../domain/time";
import { DELAY_PRESET_MINUTES, effectiveStartTime } from "./dayDelay";
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
 */
export default function DelayControl({ delayMinutes, scheduleStartTime, onSetDelay }: DelayControlProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPickerOpen]);

  function choose(minutes: number) {
    onSetDelay(minutes);
    setIsPickerOpen(false);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        variant="onDark"
        onClick={() => setIsPickerOpen((open) => !open)}
        aria-haspopup="menu"
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
        <div
          role="menu"
          className="absolute start-0 top-full z-10 mt-1 flex w-48 flex-col overflow-hidden rounded-panel border border-rule bg-card text-text shadow-l"
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
              role="menuitem"
              onClick={() => choose(minutes)}
              className="p-3 text-start hover:bg-field"
            >
              +<Ltr>{minutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
            </button>
          ))}
          <div className="border-t border-hair" />
          <button type="button" role="menuitem" onClick={() => choose(0)} className="p-3 text-start hover:bg-field">
            {dayScreenStrings.delayClearOption}
          </button>
        </div>
      )}
    </div>
  );
}
