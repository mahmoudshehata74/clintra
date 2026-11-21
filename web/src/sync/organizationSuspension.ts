import { useSyncExternalStore } from "react";

let suspended = false;
const listeners = new Set<() => void>();

export const suspensionStrings = {
  banner: "حساب العيادة موقوف مؤقتًا، والمزامنة متوقفة. التغييرات محفوظة على هذا الجهاز وستُرسل عند إعادة تشغيل الحساب. تواصل مع فريق كلينترا.",
};

export function isOrganizationSuspended(): boolean {
  return suspended;
}

export function setOrganizationSuspended(next: boolean): void {
  if (next === suspended) return;
  suspended = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOrganizationSuspension(): boolean {
  return useSyncExternalStore(subscribe, isOrganizationSuspended);
}
