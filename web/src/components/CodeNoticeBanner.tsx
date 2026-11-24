import { useSyncExternalStore } from "react";
import { getActiveMembershipId, subscribeSession } from "../auth/session";
import { codeNoticeText, useCodeNotices } from "../sync/codeNotices";

export default function CodeNoticeBanner({ inLockCard = false, inContentFlow = false }: { inLockCard?: boolean; inContentFlow?: boolean }) {
  const notices = useCodeNotices();
  const isLocked = useSyncExternalStore(subscribeSession, getActiveMembershipId) === null;
  if (notices.length === 0 || (isLocked && !inLockCard)) return null;
  return (
    <div role="status" data-code-notices className={`shrink-0 rounded-card border border-copper-line bg-copper-wash px-4 py-3 text-start text-copper-ink print:hidden ${inLockCard ? "mt-5 text-xs" : "mb-3 text-sm"} ${inContentFlow ? "sm:mx-auto sm:w-[calc(100%_-_40px)] sm:max-w-[calc(var(--container-page)_-_40px)] sm:rounded-panel" : ""}`}>
      {notices.map((notice) => <p key={notice.id}>{codeNoticeText(notice)}</p>)}
    </div>
  );
}
