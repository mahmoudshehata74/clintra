import { useEffect, useSyncExternalStore } from "react";
import LockScreen from "./auth/LockScreen";
import {
  clearActiveSession,
  getActiveMembershipId,
  getLastActiveMembershipId,
  subscribeSession,
} from "./auth/session";
import { useIdleLock } from "./auth/useIdleLock";
import InstallBanner from "./components/InstallBanner";
import { db } from "./db/database";
import DayScreen from "./screens/day/DayScreen";
import { startSyncEngine } from "./sync/engine";
import { FakeTransport } from "./sync/fakeTransport";

// Idle auto-lock window — 10 minutes, decided by the owner in
// docs/auth-plan.md (Layer 3): long enough to survive a reschedule phone call,
// short enough that an abandoned tablet re-locks.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export default function App() {
  // Started once, app-wide: every tab on this device shares one
  // FakeTransport database name (see fakeTransport.ts's default), which is
  // what lets two tabs converge on one coherent view of "the server".
  useEffect(() => {
    const handle = startSyncEngine(db, new FakeTransport());
    return () => handle.stop();
  }, []);

  const activeMembershipId = useSyncExternalStore(subscribeSession, getActiveMembershipId);
  const isLocked = activeMembershipId === null;

  // The session module remembers the last person in, so a re-lock offers their
  // PIN pad directly ("دخول <name>") while a fresh launch still shows the picker
  // ("دخول العيادة"). Read here (not tracked in an effect) so it stays in sync
  // with the session it changes alongside.
  const lastMembershipId = getLastActiveMembershipId() ?? undefined;

  useIdleLock(!isLocked, IDLE_TIMEOUT_MS, clearActiveSession);

  // The day screen stays mounted while locked so an open sheet with typed
  // values is preserved and restored on unlock; the overlay covers it fully.
  return (
    <>
      <InstallBanner />
      <DayScreen />
      {isLocked && <LockScreen defaultMembershipId={lastMembershipId} />}
    </>
  );
}
