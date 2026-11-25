import { useSyncExternalStore } from "react";
import { getActiveMembershipId, subscribeSession } from "../auth/session";
import { clinicSupportText, useSupportSessions } from "../sync/supportSessions";
import { isSupportMode } from "../auth/supportMode";

export default function SupportSessionBanner({ inLockCard = false }: { inLockCard?: boolean }) {
  const sessions = useSupportSessions();
  const locked = useSyncExternalStore(subscribeSession, getActiveMembershipId) === null;
  if (isSupportMode() || (locked && !inLockCard) || sessions.length === 0) return null;
  return <div role="status" data-support-sessions className={`mb-3 shrink-0 rounded-card border border-copper-line bg-copper-wash px-4 py-3 text-start text-copper-ink print:hidden ${inLockCard ? "mt-5 text-xs" : "text-sm sm:mx-auto sm:w-[calc(100%_-_40px)] sm:max-w-[calc(var(--container-page)_-_40px)] sm:rounded-panel"}`}>
    {sessions.map((session) => <p key={session.device_id}>{clinicSupportText(session.expires_at)}</p>)}
  </div>;
}
