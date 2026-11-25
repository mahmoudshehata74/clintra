import { useSyncExternalStore } from "react";
import type { PullSinceResult } from "./transport";

export type CodeNotice = NonNullable<PullSinceResult["codeNotices"]>[number];
const lifetime = 7 * 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();
let notices: CodeNotice[] = [];
let snapshot: CodeNotice[] = [];
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let currentDeviceId: string | null = null;

function storageKey(deviceId: string): string {
  return `clintra:code-notices:${deviceId}`;
}

function save(): void {
  if (currentDeviceId === null || typeof localStorage === "undefined") return;
  try { localStorage.setItem(storageKey(currentDeviceId), JSON.stringify(snapshot)); } catch { /* Storage may be unavailable. */ }
}

function visible(): CodeNotice[] {
  const now = Date.now();
  return notices.filter((notice) => {
    const at = Date.parse(notice.issued_at);
    return Number.isFinite(at) && at <= now && at + lifetime > now;
  });
}

function emit(): void {
  for (const listener of listeners) listener();
}

function scheduleExpiry(): void {
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  const next = snapshot.map((notice) => Date.parse(notice.issued_at) + lifetime).sort((a, b) => a - b)[0];
  if (next !== undefined) expiryTimer = setTimeout(() => { expiryTimer = undefined; snapshot = visible(); save(); emit(); scheduleExpiry(); }, Math.max(1, next - Date.now()));
}

export function setCodeNoticeDevice(deviceId: string | null): void {
  if (deviceId === currentDeviceId) return;
  currentDeviceId = deviceId;
  let stored: unknown = [];
  if (deviceId !== null && typeof localStorage !== "undefined") {
    try { stored = JSON.parse(localStorage.getItem(storageKey(deviceId)) ?? "[]"); } catch { stored = []; }
  }
  notices = Array.isArray(stored) ? stored.filter((row): row is CodeNotice =>
    row !== null && typeof row === "object" && typeof row.id === "string"
    && (row.purpose === "device" || row.purpose === "owner_recovery") && typeof row.issued_at === "string") : [];
  snapshot = visible();
  emit();
  scheduleExpiry();
}

export function setCodeNotices(next: CodeNotice[], deviceId?: string): void {
  if (deviceId !== undefined && deviceId !== currentDeviceId) setCodeNoticeDevice(deviceId);
  notices = next.filter((notice) => notice.purpose === "device" || notice.purpose === "owner_recovery");
  snapshot = visible();
  save();
  emit();
  scheduleExpiry();
}

export function getCodeNotices(): CodeNotice[] {
  return snapshot;
}

export function subscribeCodeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCodeNotices(): CodeNotice[] {
  return useSyncExternalStore(subscribeCodeNotices, getCodeNotices);
}

const cairoTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function formatNoticeTime(instant: string): string { return cairoTime.format(new Date(instant)); }

export function codeNoticeText(notice: CodeNotice): string {
  const time = formatNoticeTime(notice.issued_at);
  return notice.purpose === "owner_recovery"
    ? `فريق كلينترا أصدر كود استرجاع لحساب المالك في ${time}`
    : `فريق كلينترا أصدر كود تفعيل جهاز جديد للعيادة في ${time}`;
}
