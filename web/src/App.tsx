import { useEffect, useState, useSyncExternalStore } from "react";
import LockScreen from "./auth/LockScreen";
import {
  clearActiveSession,
  getActiveMembershipId,
  getLastActiveMembershipId,
  subscribeSession,
} from "./auth/session";
import { useActingMembership } from "./auth/useActingMembership";
import { useIdleLock } from "./auth/useIdleLock";
import AppShell from "./components/AppShell";
import InstallBanner from "./components/InstallBanner";
import { db } from "./db/database";
import { Role } from "./domain/role";
import DayScreen from "./screens/day/DayScreen";
import { startSyncEngine } from "./sync/engine";
import { FakeTransport } from "./sync/fakeTransport";
import { selectSyncTransport } from "./sync/httpTransport";

// Idle auto-lock window — 10 minutes, decided by the owner in
// docs/auth-plan.md (Layer 3): long enough to survive a reschedule phone call,
// short enough that an abandoned tablet re-locks.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export default function App() {
  // Started once, app-wide: every tab on this device shares one
  // FakeTransport database name (see fakeTransport.ts's default), which is
  // what lets two tabs converge on one coherent view of "the server". The
  // real transport is selected by whether a real device token is available
  // (selectSyncTransport, sync/httpTransport.ts) — always null today, since
  // nothing in web/ yet calls POST /api/devices/register (see
  // HttpTransport's own doc comment), so this always resolves to Fake. Not
  // a placeholder to revisit later: it is the actual, deliberate switch,
  // simply with only one live input for now.
  useEffect(() => {
    const handle = startSyncEngine(db, selectSyncTransport(null, new FakeTransport()));
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

  // Settings lives one level up from DayScreen now: AppShell's sidebar is
  // what opens it (its "الإعدادات" item), and the sidebar needs to know
  // whether it's the currently active section to apply the reference's
  // .fn div.on treatment — both read this same flag, so it can't stay
  // DayScreen's own local state the way it was before this task.
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const actingMembership = useActingMembership();
  const isOwner = actingMembership?.role === Role.Owner;

  // The day screen stays mounted while locked so an open sheet with typed
  // values is preserved and restored on unlock; the overlay covers it fully.
  return (
    <>
      <InstallBanner />
      <AppShell
        activeItem={isSettingsOpen ? "settings" : "day"}
        onSelectDay={() => setIsSettingsOpen(false)}
        settingsEnabled={isOwner}
        onSelectSettings={() => setIsSettingsOpen(true)}
      >
        <DayScreen isSettingsOpen={isSettingsOpen} onCloseSettings={() => setIsSettingsOpen(false)} />
      </AppShell>
      {isLocked && <LockScreen defaultMembershipId={lastMembershipId} />}
    </>
  );
}
