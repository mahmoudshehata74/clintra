import { useEffect, useState, useSyncExternalStore } from "react";
import LockScreen from "./auth/LockScreen";
import RegistrationScreen from "./auth/RegistrationScreen";
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
import { isDeviceRegistered } from "./db/registration";
import { isDemoModeRequested } from "./domain/appMode";
import { Role } from "./domain/role";
import DayScreen from "./screens/day/DayScreen";
import { SYNC_AUTH_ERROR_EVENT_NAME, startSyncEngine, type SyncEngineHandle } from "./sync/engine";
import { FakeTransport } from "./sync/fakeTransport";
import { selectSyncTransport } from "./sync/httpTransport";

// Idle auto-lock window — 10 minutes, decided by the owner in
// docs/auth-plan.md (Layer 3): long enough to survive a reschedule phone call,
// short enough that an abandoned tablet re-locks.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Registration screen aside, before deciding what to render. See its own effect below for how each is reached. */
type BootStatus = "checking" | "needs_registration" | "ready";

export default function App() {
  // "checking" only ever lasts one IndexedDB read (near-instant, no
  // network) — demo mode (?seedDay=1 / ?demo=1) skips the check entirely
  // and is always "ready", exactly as this app has always booted, so
  // dev/e2e behaviour is unchanged. Outside demo mode, a plain "/" with
  // no device row holding a real token is a genuinely fresh device —
  // install day — and shows RegistrationScreen instead of ever silently
  // seeding demo data (docs/auth-plan.md's registration credential
  // resolution; db/seed.ts's own emptiness guard is what makes this safe
  // either way: it never runs once real org data already exists).
  const [bootStatus, setBootStatus] = useState<BootStatus>(() => (isDemoModeRequested() ? "ready" : "checking"));
  const [authErrorDetected, setAuthErrorDetected] = useState(false);

  useEffect(() => {
    if (bootStatus !== "checking") {
      return;
    }
    let cancelled = false;
    void isDeviceRegistered(db).then((registered) => {
      if (!cancelled) {
        setBootStatus(registered ? "ready" : "needs_registration");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bootStatus]);

  // Started once boot is resolved, app-wide: every tab on this device
  // shares one FakeTransport database name (see fakeTransport.ts's own
  // default), which is what lets two tabs converge on one coherent view
  // of "the server". The real transport is selected by whether this
  // device's own row holds a real token (selectSyncTransport,
  // sync/httpTransport.ts) — present only after real registration; demo
  // mode's device row never has one, so it always resolves to Fake.
  //
  // A 401 from the real transport is never silently swallowed: engine.ts
  // dispatches SYNC_AUTH_ERROR_EVENT_NAME instead of throwing into a bare
  // console.error, and this listens for it app-wide for as long as the
  // engine runs. It never wipes anything on its own — only surfaces the
  // banner below, which requires an explicit, successful re-registration
  // before it goes away.
  useEffect(() => {
    if (bootStatus !== "ready") {
      return;
    }
    let handle: SyncEngineHandle | null = null;
    let cancelled = false;

    function onAuthError() {
      setAuthErrorDetected(true);
    }
    window.addEventListener(SYNC_AUTH_ERROR_EVENT_NAME, onAuthError);

    void db.device.toArray().then((rows) => {
      if (cancelled) {
        return;
      }
      const token = rows.find((row) => row.token !== null)?.token ?? null;
      handle = startSyncEngine(db, selectSyncTransport(token, new FakeTransport()));
    });

    return () => {
      cancelled = true;
      window.removeEventListener(SYNC_AUTH_ERROR_EVENT_NAME, onAuthError);
      handle?.stop();
    };
  }, [bootStatus]);

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

  if (bootStatus !== "ready") {
    // "checking" renders nothing rather than a spinner: it resolves from
    // one local IndexedDB read, sub-frame in practice, and there is
    // nothing yet to show a spinner over.
    return bootStatus === "needs_registration" ? (
      <RegistrationScreen onRegistered={() => setBootStatus("ready")} />
    ) : null;
  }

  // The day screen stays mounted while locked so an open sheet with typed
  // values is preserved and restored on unlock; the overlay covers it fully.
  return (
    <>
      <InstallBanner />
      {authErrorDetected && (
        <div className="fixed inset-x-0 top-0 z-40 bg-red px-4 py-2 text-center text-sm text-paper">
          الجهاز محتاج إعادة تفعيل — الاتصال بالخادم مرفوض
          <button
            type="button"
            className="mr-3 underline"
            onClick={() => {
              setAuthErrorDetected(false);
              setBootStatus("needs_registration");
            }}
          >
            إعادة التفعيل
          </button>
        </div>
      )}
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
