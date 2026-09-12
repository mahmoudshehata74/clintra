// Development-only: appending ?seedDay=1 to the URL pins the day screen to
// the seed's fixed demo date (see screens/day/DayScreen.tsx) instead of
// today. Shared here (not just DayScreen's own constant) because it also
// counts as a demo-mode signal for App.tsx's registration gate below.
export const SEED_DAY_QUERY_PARAM = "seedDay";

// A second, narrower demo-mode signal for call sites that want the seed's
// demo org/data without pinning the fixed date (e.g. e2e's gotoRealDay,
// which deliberately runs against the real current day).
const DEMO_MODE_QUERY_PARAM = "demo";

/**
 * True when this navigation explicitly opted into demo/dev mode — the
 * seed-based bootstrap (db/seed.ts) and the tokenless device-binding
 * fallback (db/deviceRegistration.ts's ensureDeviceRegistration), exactly
 * as this app has always booted, before real device registration
 * (db/registration.ts) existed. Real registration's activation screen
 * (auth/RegistrationScreen.tsx) never shows in this mode.
 *
 * False by default — a plain "/" with no query string is what an actually
 * installed device's first launch is, and that is the case this task
 * changes: it now shows the activation screen instead of silently
 * seeding demo data, so a real clinic can never end up with demo
 * patients (docs/auth-plan.md's registration credential resolution).
 */
export function isDemoModeRequested(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get(SEED_DAY_QUERY_PARAM) === "1" || params.get(DEMO_MODE_QUERY_PARAM) === "1";
}
