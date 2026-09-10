import { useEffect } from "react";

/**
 * Locks the app after a period with no user interaction. "Idle" is defined per
 * docs/auth-plan.md, Layer 3: no touch, keyboard, or scroll input. A screen
 * being read but not touched still re-locks after the timeout — that is the
 * common abandoned-tablet case — so passive reading is deliberately not treated
 * as activity beyond these events.
 *
 * Only runs while `enabled` (a session exists). Uses a single timer reset by any
 * qualifying event; a tab returning to the foreground also resets it, so time
 * spent backgrounded does not silently burn the window.
 */
export function useIdleLock(enabled: boolean, timeoutMs: number, onIdle: () => void): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    function reset() {
      clearTimeout(timer);
      timer = setTimeout(onIdle, timeoutMs);
    }

    // pointerdown covers mouse and touch; keydown covers hardware keyboards;
    // wheel/scroll/touchmove cover reading-by-scrolling, which counts as active.
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel", "touchmove", "scroll"];
    for (const name of events) {
      window.addEventListener(name, reset, { passive: true });
    }
    function onVisible() {
      if (document.visibilityState === "visible") {
        reset();
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    reset();
    return () => {
      clearTimeout(timer);
      for (const name of events) {
        window.removeEventListener(name, reset);
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, timeoutMs, onIdle]);
}
