import { useEffect, useRef, useState } from "react";
import Ltr from "../../components/Ltr";
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
 * The day header's doctor-delay chip and its picker. The slot grid's own
 * times never change; this only reports the effective start time above it.
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
    <div>
      <div ref={containerRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setIsPickerOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={isPickerOpen}
          className={
            delayMinutes > 0
              ? "rounded-[5px] bg-amber-soft px-2 py-0.5 text-xs text-amber"
              : "rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted"
          }
        >
          {delayMinutes > 0 ? (
            <>
              <Ltr>{delayMinutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
            </>
          ) : (
            dayScreenStrings.delayNone
          )}
        </button>

        {isPickerOpen && (
          <div
            role="menu"
            className="absolute start-0 top-full z-10 mt-1 flex w-44 flex-col overflow-hidden rounded-[--radius-el] border border-line bg-paper shadow-lg"
          >
            <p className="p-3 pb-1 text-sm font-medium">{dayScreenStrings.delayPickerTitle}</p>
            {DELAY_PRESET_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                role="menuitem"
                onClick={() => choose(minutes)}
                className="p-3 text-start hover:bg-line/30"
              >
                +<Ltr>{minutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
              </button>
            ))}
            <div className="border-t border-line" />
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(0)}
              className="p-3 text-start hover:bg-line/30"
            >
              {dayScreenStrings.delayClearOption}
            </button>
          </div>
        )}
      </div>

      {delayMinutes > 0 && scheduleStartTime && (
        <p className="mt-1 text-sm text-muted">
          {dayScreenStrings.delayLinePrefix} <Ltr>{delayMinutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
          {" — "}
          {dayScreenStrings.delayLineActualStart}{" "}
          <Ltr>{effectiveStartTime(scheduleStartTime, delayMinutes)}</Ltr>
        </p>
      )}
    </div>
  );
}
