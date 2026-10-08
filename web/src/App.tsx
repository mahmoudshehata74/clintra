import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
import { todayInCairo, type ClinicDay } from "./domain/time";
import DayScreen from "./screens/day/DayScreen";
import DoctorDayScreen from "./screens/doctor/DoctorDayScreen";
import { doctorDayStrings } from "./screens/doctor/strings";
import { dayScreenStrings } from "./screens/day/strings";
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

  // Settings lives one level up from DayScreen now: AppShell's rail is what
  // opens it (its "الإعدادات" item, shown only to an owner per
  // navItemsFor), and the rail needs to know whether it's the currently
  // active item to apply aria-current and the active look — both read this
  // same flag, so it can't stay DayScreen's own local state.
  //
  // The audit log ("السجل") is lifted here for the same reason, so the rail
  // can open it and show it as active. At most one of the two is open:
  // picking one rail item closes the other's sheet, as picking "اليوم"
  // closes both.
  const [openSection, setOpenSection] = useState<"audit" | "settings" | null>(null);
  const isSettingsOpen = openSection === "settings";
  const isAuditOpen = openSection === "audit";
  const actingMembership = useActingMembership();

  // The doctor's day (rail item "شاشة الطبيب") replaces the day screen's
  // grid while it is selected. It belongs to the acting membership's own
  // practitioner, so it needs that membership — but useActingMembership is
  // undefined while locked, and the screen must stay mounted under the lock
  // overlay (as the day screen does) so a half-typed note survives an idle
  // lock. So the last unlocked membership is remembered (React's
  // adjust-state-while-rendering pattern) and used while locked; once
  // someone unlocks, theirs decides — a membership with no practitioner_id
  // never sees the screen, and falls back to the day.
  const [isDoctorViewSelected, setIsDoctorViewSelected] = useState(false);
  const [lastUnlockedMembership, setLastUnlockedMembership] = useState(actingMembership);
  if (actingMembership && actingMembership !== lastUnlockedMembership) {
    setLastUnlockedMembership(actingMembership);
  }
  // Right after an unlock, useActingMembership is briefly undefined again
  // while its live query loads the new session's row; if that session is
  // the same membership as before the lock, keep showing what it saw.
  const isSameMemberResuming = activeMembershipId !== null && activeMembershipId === lastUnlockedMembership?.id;
  const viewingMembership = isLocked || (!actingMembership && isSameMemberResuming) ? lastUnlockedMembership : actingMembership;
  const doctorPractitionerId = viewingMembership?.practitioner_id ?? null;
  const isDoctorViewShown = isDoctorViewSelected && doctorPractitionerId !== null;
  const [doctorPractitionerName, setDoctorPractitionerName] = useState<string | undefined>(undefined);
  const handlePractitionerName = useCallback((name: string) => setDoctorPractitionerName(name), []);
  // Reported up by DayScreen (its own subtitle, e.g. "يوم العيادة" or the
  // queue-mode variant) — the one piece of the app bar a screen supplies;
  // see AppShell.tsx's own doc comment.
  const [dayScreenTitle, setDayScreenTitle] = useState<string>(dayScreenStrings.appBarTitle);
  // Reported up the same way: the day actually on screen, which the day
  // screen alone knows how to resolve (it can be pinned away from the real
  // current day by the dev-only ?seedDay=1 affordance) — AppShell no longer
  // computes its own, so its date block never disagrees with the grid below it.
  const [dayScreenToday, setDayScreenToday] = useState<ClinicDay>(() => todayInCairo());

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
        // z-47: above the app bar/rail (z-40, see AppShell.tsx's own doc
        // comment) and above an open sheet's panel (z-45, see Sheet.tsx), so
        // no sheet can cover this warning or its re-activation action — still
        // below LockScreen's z-50.
        <div className="fixed inset-x-0 top-0 z-47 bg-danger px-4 py-2 text-center text-sm text-paper">
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
        role={actingMembership?.role ?? Role.Assistant}
        hasPractitioner={Boolean(actingMembership?.practitioner_id)}
        activeItem={isDoctorViewShown ? "doctor" : (openSection ?? "day")}
        onSelect={(key) => {
          // The audit and settings sheets open over the day screen, so
          // picking either (or "اليوم") leaves the doctor's day.
          setIsDoctorViewSelected(key === "doctor");
          setOpenSection(key === "day" || key === "doctor" ? null : key);
        }}
        title={isDoctorViewShown ? doctorDayStrings.appBarTitle : dayScreenTitle}
        today={dayScreenToday}
        whoName={isDoctorViewShown ? doctorPractitionerName : undefined}
      >
        {/* The day screen stays mounted (hidden) under the doctor's day: it
            owns the seed/boot load, the day actually on screen
            (onTodayChange, which the doctor's day reads) and any sheet
            left open, none of which should restart on switching views. */}
        <div className={isDoctorViewShown ? "hidden" : undefined}>
          <DayScreen
            isSettingsOpen={isSettingsOpen}
            onCloseSettings={() => setOpenSection(null)}
            isAuditOpen={isAuditOpen}
            onCloseAudit={() => setOpenSection(null)}
            onTitleChange={setDayScreenTitle}
            onTodayChange={setDayScreenToday}
          />
        </div>
        {isDoctorViewShown && (
          <DoctorDayScreen
            practitionerId={doctorPractitionerId}
            today={dayScreenToday}
            onPractitionerName={handlePractitionerName}
          />
        )}
      </AppShell>
      {isLocked && <LockScreen defaultMembershipId={lastMembershipId} />}
    </>
  );
}
