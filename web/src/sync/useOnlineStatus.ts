import { useSyncExternalStore } from "react";
import { isServerUnreachable, SYNC_TRANSPORT_STATUS_EVENT_NAME } from "./engine";

const listeners = new Set<() => void>();
let subscribed = false;

function refresh(): void {
  for (const listener of listeners) listener();
}

export function subscribeConnectionStatus(listener: () => void): () => void {
  listeners.add(listener);
  if (!subscribed && typeof window !== "undefined") {
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(SYNC_TRANSPORT_STATUS_EVENT_NAME, refresh);
    subscribed = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && subscribed) {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(SYNC_TRANSPORT_STATUS_EVENT_NAME, refresh);
      subscribed = false;
    }
  };
}

export function getConnectionSnapshot(): "online" | "offline" | "server_unreachable" {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  return isServerUnreachable() ? "server_unreachable" : "online";
}

/** One browser and transport-health snapshot shared by every online-only control. */
export function useConnectionStatus(): ReturnType<typeof getConnectionSnapshot> {
  return useSyncExternalStore(subscribeConnectionStatus, getConnectionSnapshot, () => "online");
}

export function useOnlineStatus(): boolean {
  return useConnectionStatus() === "online";
}
