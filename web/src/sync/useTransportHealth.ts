import { useEffect, useState } from "react";
import { isServerUnreachable, SYNC_TRANSPORT_STATUS_EVENT_NAME } from "./engine";

/**
 * Tracks engine.ts's consecutive-transport-failure counter, kept current
 * via SYNC_TRANSPORT_STATUS_EVENT_NAME — dispatched only when the
 * threshold is crossed in either direction (docs/sync-plan.md's Q10),
 * mirroring useOnlineStatus.ts's own shape for the sibling signal.
 */
export function useServerUnreachable(): boolean {
  const [unreachable, setUnreachable] = useState(isServerUnreachable);

  useEffect(() => {
    function handleChange() {
      setUnreachable(isServerUnreachable());
    }
    window.addEventListener(SYNC_TRANSPORT_STATUS_EVENT_NAME, handleChange);
    return () => window.removeEventListener(SYNC_TRANSPORT_STATUS_EVENT_NAME, handleChange);
  }, []);

  return unreachable;
}
