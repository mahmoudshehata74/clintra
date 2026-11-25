import { useSyncExternalStore } from "react";
import type { PullSinceResult } from "./transport";
import { formatNoticeTime } from "./codeNotices";

export type SupportSession = NonNullable<PullSinceResult["supportSessions"]>[number];
const listeners = new Set<() => void>();
let sessions: SupportSession[] = [];

export function setSupportSessions(next: SupportSession[]): void {
  sessions = next.filter((row) => typeof row?.device_id === "string" && typeof row.admin_name === "string"
    && typeof row.expires_at === "string" && Number.isFinite(Date.parse(row.expires_at)));
  for (const listener of listeners) listener();
}

export function removeSupportSession(deviceId: string): void {
  setSupportSessions(sessions.filter((row) => row.device_id !== deviceId));
}

export function getSupportSessions(): SupportSession[] { return sessions; }
export function subscribeSupportSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSupportSessions(): SupportSession[] {
  return useSyncExternalStore(subscribeSupportSessions, getSupportSessions, getSupportSessions);
}

export function clinicSupportText(expiresAt: string): string {
  return `فريق كلينترا عنده وصول للقراءة بس لحد ${formatNoticeTime(expiresAt)}`;
}
export function supportDeviceText(expiresAt: string): string {
  return `جهاز دعم — قراءة بس — بينتهي ${formatNoticeTime(expiresAt)}`;
}
