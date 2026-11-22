import { useSyncExternalStore } from "react";
import { getActiveMembershipId, subscribeSession } from "../auth/session";
import { suspensionStrings, useOrganizationSuspension } from "../sync/organizationSuspension";

/** The rollout warning's content-flow slot, using the danger tokens. */
export default function OrganizationSuspensionNotice({ inLockCard = false }: { inLockCard?: boolean }) {
  const suspended = useOrganizationSuspension();
  const isLocked = useSyncExternalStore(subscribeSession, getActiveMembershipId) === null;
  if (!suspended || (isLocked && !inLockCard)) return null;

  return (
    <p
      role="status"
      data-organization-suspension
      className={`shrink-0 rounded-card border border-danger-line bg-danger-wash px-4 py-3 text-start text-danger print:hidden ${inLockCard ? "mt-5 text-xs" : "mb-3 text-sm"}`}
    >
      {suspensionStrings.banner}
    </p>
  );
}
