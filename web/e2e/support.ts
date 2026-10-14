import { expect, type Locator, type Page } from "@playwright/test";
// The real UI strings, imported rather than duplicated so a wording change in
// the app can never silently drift from the tests. These modules have no
// imports of their own, so pulling them into the Playwright bundle is cheap.
import { authStrings } from "../src/auth/authStrings";
// Dev-only seed PINs — imported, never written as literals into the tests, and
// never logged, per the task's rule. See src/auth/devPins.ts.
import { DEV_SEED_PINS } from "../src/auth/devPins";
import { formatAppBarDate } from "../src/components/appBarDate";
import { sidebarStrings } from "../src/components/strings";
// Not imported from src/db/seed.ts directly: that module's import chain
// pulls in auth/pinHash.ts's JSON import, which this test runner cannot
// load without a "type: json" attribute. seededVisitsDate() itself is just
// these two calls (see its own doc comment) — reproduced here against the
// same pure domain/time.ts helpers rather than against the db module.
import { addDaysToClinicDay, cairoInstant, mostRecentWeekdayOnOrBefore, todayInCairo, type ClockTime } from "../src/domain/time";
import { carePlanStrings } from "../src/screens/carePlan/strings";
import { dayScreenStrings } from "../src/screens/day/strings";
import { doctorDayStrings } from "../src/screens/doctor/strings";
import { messagesStrings } from "../src/screens/messages/strings";
import { patientProfileStrings } from "../src/screens/patient/strings";
import { prescriptionPrintStrings } from "../src/screens/prescription/strings";
import { visitWorkspaceStrings } from "../src/screens/visit/strings";

export const S = dayScreenStrings;
export const DOCTOR = doctorDayStrings;
export const VISIT = visitWorkspaceStrings;
export const RX = prescriptionPrintStrings;
export const MSG = messagesStrings;
export const PLAN = carePlanStrings;
export const PROFILE = patientProfileStrings;
export const AUTH = authStrings;
export const SIDEBAR = sidebarStrings;
export { DEV_SEED_PINS };

// What ?seedDay=1 pins the day screen to (the most recent Monday as of
// whenever this test process started), and what the app bar's date block
// (AppShell.tsx) must show while that pin is active — see gotoSeededDay.
const SEEDED_VISITS_WEEKDAY = 1; // Monday
export const SEEDED_DAY = mostRecentWeekdayOnOrBefore(addDaysToClinicDay(todayInCairo(), -1), SEEDED_VISITS_WEEKDAY);
export const SEEDED_APP_BAR_DATE = formatAppBarDate(SEEDED_DAY);

// Display labels the lock-screen picker shows (formatActorLabel = "name (role)").
export const ASSISTANT_NAME = "سارة حسن";
export const PRACTITIONER_NAME = "أحمد المصري";
// The seeded practitioner is also the clinic owner in v1.
export const OWNER_NAME = PRACTITIONER_NAME;
export const OWNER_PIN = DEV_SEED_PINS.practitioner;

// Seed-derived fixtures (see web/src/db/seed.ts). The slots-mode practitioner,
// the queue-mode one, and the five demo patients.
export const SLOTS_DR = "أحمد المصري";
export const QUEUE_DR = "سلمى إبراهيم";
export const PATIENTS = {
  mona: "منى عبد الله",
  karim: "كريم فتحي",
  yasmin: "ياسمين توفيق",
  omar: "عمر جمال",
  // Stored with alef-maqsura (ى); searching with a plain ya (هدي) must still find it.
  hoda: "هدى رجب",
} as const;

/**
 * Every spec starts from the same known seeded state. Playwright gives each
 * test a fresh browser context (its own empty IndexedDB and localStorage), so
 * navigating to ?seedDay=1 triggers a clean re-seed; the explicit
 * localStorage.clear() below guarantees no practitioner selection carried in,
 * which is why each day-screen test then pins its practitioner by name rather
 * than trusting the (UUID-ordered, non-deterministic) default.
 */
export async function gotoSeededDay(
  page: Page,
  loginOptions?: { pin?: string; name?: string },
): Promise<void> {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  // The app now boots locked; log in (assistant by default) so the day screen
  // is interactive, then wait for the practitioner switcher (proves the seed
  // finished and static data loaded).
  await login(page, loginOptions);
  await expect(page.getByRole("button", { name: SLOTS_DR })).toBeVisible();
}

/** The lock overlay (role=dialog with the auth aria-label). */
export function lockOverlay(page: Page) {
  return page.getByRole("dialog", { name: AUTH.lockOverlayAria });
}

/** Enter a PIN on the on-screen pad, one digit button at a time. */
export async function enterPin(page: Page, pin: string): Promise<void> {
  const overlay = lockOverlay(page);
  for (const digit of pin) {
    await overlay.getByRole("button", { name: digit, exact: true }).click();
  }
}

/**
 * Complete the lock screen: pick a membership from the picker if it is showing,
 * then key in its PIN. Defaults to the seeded assistant. The PIN comes from the
 * shared dev-only constant, never a literal here.
 */
export async function login(
  page: Page,
  { pin = DEV_SEED_PINS.assistant, name = ASSISTANT_NAME }: { pin?: string; name?: string } = {},
): Promise<void> {
  const overlay = lockOverlay(page);
  await expect(overlay).toBeVisible();
  const pick = overlay.getByRole("button", { name: new RegExp(name) });
  const firstPadKey = overlay.getByRole("button", { name: "1", exact: true });
  // Wait for the overlay's controls to render (the picker list appears only
  // once the seed has written memberships); then a fresh launch shows the
  // picker, a re-lock shows the pad directly.
  await expect(pick.or(firstPadKey).first()).toBeVisible();
  if (await pick.count()) {
    await pick.first().click();
  }
  await enterPin(page, pin);
  await expect(overlay).toBeHidden();
}

/**
 * Like gotoSeededDay, but WITHOUT ?seedDay — so the screen runs on the real
 * current day. Needed by anything that reads back a freshly-written audit_log
 * row: those rows are timestamped "now", and the audit sheet filters by the
 * screen's day, so a row only surfaces when that day is the real today (the
 * seeded day is a fixed past Monday). The every-weekday seed schedule means
 * today still has a bookable grid; it just starts empty of seeded visits.
 *
 * ?demo=1 is required here since real device registration shipped
 * (src/domain/appMode.ts, src/auth/RegistrationScreen.tsx): a plain "/"
 * with no device row holding a real token now shows the activation
 * screen instead of silently seeding demo data. gotoSeededDay doesn't
 * need its own copy of this — ?seedDay=1 already counts as demo mode.
 */
export async function gotoRealDay(
  page: Page,
  loginOptions?: { pin?: string; name?: string },
): Promise<void> {
  await page.goto("/?demo=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, loginOptions);
  await expect(page.getByRole("button", { name: SLOTS_DR })).toBeVisible();
}

/** The app-wide rail (AppShell.tsx), by its accessible name. */
export function sidebar(page: Page): Locator {
  return page.getByRole("navigation", { name: SIDEBAR.navAriaLabel });
}

/** Open the audit log from the rail's "السجل" item and wait for its sheet. */
export async function openAuditLog(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navAudit, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.auditSheetTitle, { exact: false }).first()).toBeVisible();
}

/** Open the doctor's day from the rail's "شاشة الطبيب" item and wait for its day list. */
export async function openDoctorDay(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navDoctor, exact: true }).click();
  await expect(page.getByRole("list", { name: DOCTOR.dayListTitle }).or(page.getByText(DOCTOR.dayListEmpty))).toBeVisible();
}

/** A doctor's-day section (each is a labelled <section>, so role "region"). */
export function doctorSection(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/** Pin the day view to one practitioner by tapping its header pill. */
export async function selectPractitioner(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

/** Open the booking sheet from the floating action (slots mode: "حجز"). */
export async function openBookingSheet(page: Page, label: string = S.bookingButtonLabel): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** The day grid's empty-slot plus tiles (SlotRow with aria-label "الموعد فاضي"). */
export function emptySlotTiles(page: Page) {
  return page.getByRole("button", { name: S.emptySlot, exact: true });
}

/**
 * Clicks a patient's row in a booking-sheet search-results list. The
 * "+ مريض جديد باسم «query»" row echoes the typed query back into its own
 * label, so once the query exactly matches a patient's name, a plain
 * `filter({ hasText: name })` matches that row too — and since the real
 * results come from a debounced, async Dexie query while the "add new"
 * row appears on the debounce alone, a click landing before the query
 * settles hits the wrong row instead of failing outright. Excluding the
 * "add new" row's own label removes the ambiguity, so Playwright's normal
 * actionability wait does the rest: it keeps retrying until the real row
 * — the only one left that can match — actually renders.
 */
export async function pickSearchResult(scope: Locator, patientName: string): Promise<void> {
  await scope
    .getByRole("button")
    .filter({ hasText: patientName })
    .filter({ hasNotText: S.newPatientButtonPrefix })
    .first()
    .click();
}

/**
 * Books an existing patient into the first open slot through the booking
 * sheet, waiting for their row. `service` picks the service by name; without
 * it the sheet's own default stands, and that default is the first active
 * service in table order — which follows the services' random UUIDs, so a
 * capture or assertion that shows the service must always name one.
 */
export async function bookFirstOpenSlot(page: Page, name: string, service?: string): Promise<void> {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
  await pickSearchResult(dialog, name);
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  if (service) {
    const option = dialog.getByRole("button", { name: new RegExp(`^${service} ·`) });
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
  }
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rowFor(page, name)).toBeVisible();
}

/** The day screen's one-tap advance on a patient's row, waiting for the new status to show. */
export async function advanceRowTo(page: Page, name: string, expectedStatus: string): Promise<void> {
  const row = rowFor(page, name);
  await row.locator("button").filter({ hasText: name }).click();
  await expect(row).toContainText(expectedStatus);
}

/** Pull the "HH:MM" clock time rendered inside a grid row or tile. */
export async function readClockTime(text: string | null): Promise<string> {
  const match = (text ?? "").match(/\d{1,2}:\d{2}/);
  if (!match) {
    throw new Error(`no clock time found in: ${JSON.stringify(text)}`);
  }
  return match[0];
}

/** A day-grid row (SlotRow <li> / QueueRow <li>) that contains the given patient name. */
export function rowFor(page: Page, patientName: string) {
  return page.getByRole("listitem").filter({ hasText: patientName });
}

/**
 * The value text beside a label in a "k/v" row (e.g. the invoice sheet's
 * totals block: a label span followed by its value span under one row —
 * InvoiceSheet.tsx). Reads the label's own next sibling rather than the
 * row's full text, so it still works regardless of which element the two
 * are wrapped in.
 */
export async function labeledRowValue(scope: Locator, label: string): Promise<string> {
  return (await scope.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]").innerText()).trim();
}

// The visit workspace's prescription (screens 10 and 16), shared by the
// prescription print and audit specs.

/** A clock time today, on the real day, as an instant for page.clock. */
export const todayAt = (time: ClockTime) => new Date(cairoInstant(todayInCairo(), time));

export type Drug = { name: string; form?: string; instructions: string; duration?: string };

/**
 * كريم booked, arrived at 09:00 and in the room, on the real day, by `as`
 * (the owner by default). The page clock is pinned to a morning before the
 * seeded slots schedule opens, so the first open slot is always bookable.
 */
export async function karimInRoom(
  page: Page,
  as: { name: string; pin: string } = { name: OWNER_NAME, pin: OWNER_PIN },
): Promise<void> {
  await page.clock.install({ time: todayAt("08:30") });
  await gotoRealDay(page, as);
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");
  await page.clock.setSystemTime(todayAt("09:00"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
}

export const visitSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: VISIT.visitSheetTitle }) });
export const printSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: RX.sheetTitle, exact: true }) });
export const rxSection = (scope: Locator) => scope.getByRole("region", { name: VISIT.rxHeading, exact: true });

/** Opens كريم's visit sheet from his row and waits for the workspace. */
export async function openVisitSheet(page: Page): Promise<Locator> {
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const sheet = visitSheet(page);
  await expect(sheet.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
  return sheet;
}

export async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(sheet).toBeHidden();
}

/** Adds one drug through the workspace's inline form, waiting for its row. */
export async function addDrug(scope: Locator, drug: Drug): Promise<void> {
  await scope.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
  await scope.getByLabel(VISIT.rxNameLabel, { exact: true }).fill(drug.name);
  await scope.getByLabel(VISIT.rxFormLabel, { exact: true }).fill(drug.form ?? "");
  await scope.getByLabel(VISIT.rxInstructionsLabel, { exact: true }).fill(drug.instructions);
  await scope.getByLabel(VISIT.rxDurationLabel, { exact: true }).fill(drug.duration ?? "");
  await scope.getByRole("button", { name: VISIT.rxAddConfirm, exact: true }).click();
  await expect(rxSection(scope).getByRole("listitem").filter({ hasText: drug.name })).toBeVisible();
  await expect(scope.getByRole("button", { name: VISIT.rxAdd, exact: true })).toBeVisible();
}

/** Opens the print sheet from the workspace's `.rx-section` button (`label`: print or reprint). */
export async function openPrintSheet(page: Page, workspace: Locator, label: string): Promise<Locator> {
  await rxSection(workspace).getByRole("button", { name: label, exact: true }).click();
  const sheet = printSheet(page);
  await expect(sheet.getByText(RX.previewNote, { exact: true })).toBeVisible();
  return sheet;
}

// The messages screen (screen 19) and its send sheet, shared by the messages
// and screenshot specs.

/** Opens the messages page from the rail and waits for its recent-messages list. */
export async function openMessagesPage(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navMessages, exact: true }).click();
  await expect(page.getByRole("heading", { name: MSG.recentHeading, exact: true })).toBeVisible();
}

/**
 * Books a new patient, with a phone, into the first open slot through the
 * booking sheet's "+ مريض جديد" row, as a named service, waiting for their row.
 */
export async function bookNewPatientWithPhone(page: Page, name: string, phone: string, service = "كشف عام"): Promise<void> {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
  await dialog.getByRole("button", { name: S.newPatientButtonPrefix }).click();
  await dialog.getByPlaceholder(S.newPatientPhonePlaceholder).fill(phone);
  await dialog.getByRole("button", { name: S.newPatientSubmitButton, exact: true }).click();
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  const option = dialog.getByRole("button", { name: new RegExp(`^${service} ·`) });
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rowFor(page, name)).toBeVisible();
}

export const sendSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: MSG.sendSheetTitle, exact: true }) });

/** Opens the send sheet from a day-grid row's overflow menu ("ابعت رسالة") and waits for its text. */
export async function openSendSheetFromRow(page: Page, patientName: string): Promise<Locator> {
  const row = rowFor(page, patientName);
  await row.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await row.getByRole("menuitem", { name: S.sendMessageMenuLabel, exact: true }).click();
  const sheet = sendSheet(page);
  await expect(sheet.getByLabel(MSG.sendBodyLabel, { exact: true })).toBeVisible();
  return sheet;
}

/**
 * Replaces window.open, before navigation, with a recorder: the wa.me link
 * the send sheet opens is kept in window.openedUrls instead of leaving the
 * page. Read it back with openedUrls.
 */
export async function recordWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recorded = window as unknown as { openedUrls: string[] };
    recorded.openedUrls = [];
    window.open = (url?: string | URL) => {
      recorded.openedUrls.push(String(url));
      return null;
    };
  });
}

export const openedUrls = (page: Page) => page.evaluate(() => (window as unknown as { openedUrls: string[] }).openedUrls);

// The app's IndexedDB, read and written straight from the browser: data that
// no screen writes (a visit in the past, a plan another device synced). A
// direct write is not audited, queues nothing, and is unseen by the app's
// live queries, which Dexie answers from its own cache — the app reads it
// once the page reloads (reloadAs). Wait for syncSettled first: the demo
// server's pull puts back every row it was pushed, so a pull still to come
// would overwrite a row written here with its older copy.

/** Reloads the page and unlocks it again as `as`, on the slots doctor's day. */
export async function reloadAs(page: Page, as: { name: string; pin: string }): Promise<void> {
  await page.reload();
  await login(page, as);
  await selectPractitioner(page, SLOTS_DR);
}

/**
 * Waits until every write so far has been pushed and pulled back: no op
 * left unsent, and the device's pull cursor at or past the newest op. Each
 * poll asks for a cycle, as coming back to the tab does (sync/engine.ts's
 * visibilitychange handler), rather than waiting for the engine's timer.
 */
export async function syncSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      const ops = await readStore<{ synced_at: string | null; created_at: string }>(page, "sync_ops");
      const [device] = await readStore<{ pull_cursor: string | null }>(page, "device");
      const newest = ops.reduce((latest, op) => (op.created_at > latest ? op.created_at : latest), "");
      return ops.every((op) => op.synced_at !== null) && device?.pull_cursor != null && device.pull_cursor >= newest;
    })
    .toBe(true);
}

/** Every row of one of the app's stores. */
export function readStore<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (storeName) => {
    const req = indexedDB.open("clintra");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const getAll = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      return await new Promise<T[]>((resolve, reject) => {
        getAll.onsuccess = () => resolve(getAll.result as T[]);
        getAll.onerror = () => reject(getAll.error);
      });
    } finally {
      database.close();
    }
  }, store);
}

/** Puts rows into the app's stores, all in one transaction. */
export async function putRows(page: Page, rows: readonly { store: string; value: unknown }[]): Promise<void> {
  await page.evaluate(async (toPut) => {
    const req = indexedDB.open("clintra");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const transaction = database.transaction([...new Set(toPut.map((row) => row.store))], "readwrite");
      for (const row of toPut) {
        transaction.objectStore(row.store).put(row.value);
      }
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(undefined);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, rows);
}

// The care plan (screen 17), shared by the care plan and screenshot specs.

export const planSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: PLAN.sheetTitle, exact: true }) });

/** One group of the plan form, by its 1-based place. */
export const planGroup = (sheet: Locator, index: number) =>
  sheet.getByRole("group", { name: `${PLAN.groupHeading} ${index}`, exact: true });

export interface PlanGroupInput {
  service: string;
  count: string;
  gap: string;
}

/** Fills the plan form's group `index` (1-based): its service by name, its count and its gap. */
export async function fillPlanGroup(sheet: Locator, index: number, group: PlanGroupInput): Promise<void> {
  const scope = planGroup(sheet, index);
  const option = scope.getByRole("button", { name: new RegExp(`^${group.service} ·`) });
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await scope.getByLabel(PLAN.countField, { exact: true }).fill(group.count);
  await scope.getByLabel(PLAN.gapField, { exact: true }).fill(group.gap);
}

/** Opens the create form from the workspace's "ابدأ خطة رعاية" and fills it: the goal, and each group (more than one adds groups). */
export async function fillNewPlan(page: Page, workspace: Locator, goal: string, groups: readonly PlanGroupInput[]): Promise<Locator> {
  await workspace.getByRole("button", { name: PLAN.startPlan, exact: true }).click();
  const sheet = planSheet(page);
  await expect(sheet.getByText(PLAN.createHeading, { exact: true })).toBeVisible();
  await sheet.getByLabel(PLAN.goalField, { exact: true }).fill(goal);
  for (const [index, group] of groups.entries()) {
    if (index > 0) {
      await sheet.getByRole("button", { name: PLAN.addGroup, exact: true }).click();
    }
    await fillPlanGroup(sheet, index + 1, group);
  }
  return sheet;
}

/** "d / m", as the plan shows a day. */
export function dayMonth(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} / ${month}`;
}

// The patient profile (screen 18), shared by the profile and screenshot specs.

/** The day the profile fixture lives on, pinned on the page clock. */
export const PROFILE_DAY = "2026-10-14";
export const profileAt = (day: string, time: ClockTime) => cairoInstant(day, time);

export const profileSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: PROFILE.sheetTitle, exact: true }) });

/** The profile's tab for `label`, by its leading text (its count follows it). */
export const profileTab = (scope: Locator | Page, label: string) =>
  scope.getByRole("group", { name: PROFILE.tabsLabel, exact: true }).getByRole("button", { name: new RegExp(`^${label}`) });

/** The timeline's event rows. */
export const profileEvents = (scope: Locator | Page) =>
  scope.getByRole("region", { name: PROFILE.timelineLabel, exact: true }).getByRole("listitem");

/** Opens the patients page from the rail and searches for `query`. */
export async function searchPatientsPage(page: Page, query: string): Promise<Locator> {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navPatients, exact: true }).click();
  await page.getByPlaceholder(PROFILE.searchPlaceholder).fill(query);
  return page.getByRole("list", { name: PROFILE.resultsLabel, exact: true });
}

/** Searches the patients page and opens the result named `name`. */
export async function openProfileFromSearch(page: Page, query: string, name: string): Promise<void> {
  const results = await searchPatientsPage(page, query);
  await results.getByRole("button").filter({ hasText: name }).click();
  await expect(page.getByRole("group", { name: PROFILE.tabsLabel, exact: true })).toBeVisible();
}

/**
 * كريم's history on PROFILE_DAY, the owner signed in, the clock pinned. He
 * is in the room at 09:00 today, where his visit starts a three-session
 * plan (كشف عام every 14 days). Written straight into the store after that:
 * his phone, age and gender; the plan started 9 / 9, its first session that
 * day's visit (done — التهاب وتر الرضفة, a printed two-drug prescription, a
 * note, 300 paid in cash) and its second today's visit; a visit on 30 / 9
 * outside the plan (خشونة بسيطة, 100 of 250 paid by card, a follow-up
 * message after it, marked sent); and a visit on 7 / 10 the patient
 * cancelled. With the demo seed's completed visit on Monday 12 / 10 (د.
 * سلمى إبراهيم): nine events on four days; three completed visits; 150 owed.
 */
export async function karimProfileFixture(page: Page): Promise<void> {
  const day = (offset: number) => addDaysToClinicDay(PROFILE_DAY, offset);
  await page.clock.install({ time: new Date(profileAt(PROFILE_DAY, "08:30")) });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");
  await page.clock.setSystemTime(new Date(profileAt(PROFILE_DAY, "09:00")));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  const workspace = await openVisitSheet(page);
  // A saved field gives the store a visit_form_data row to copy the form from.
  await workspace.getByPlaceholder(S.visitFormComplaintPlaceholder).fill("متابعة");
  await workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder).click();
  await expect(workspace.getByText(S.visitFormSavedIndicator, { exact: true })).toBeVisible();
  const plan = await fillNewPlan(page, workspace, "استعادة كامل حركة الركبة", [{ service: "كشف عام", count: "3", gap: "14" }]);
  await plan.getByLabel(PLAN.diagnosisField, { exact: true }).fill("التهاب وتر الرضفة");
  await plan.getByRole("button", { name: PLAN.startAction, exact: true }).click();
  await expect(plan.getByRole("heading", { name: PLAN.sessionsHeading, exact: true })).toBeVisible();
  await closeSheet(plan);
  await closeSheet(workspace);

  await syncSettled(page);
  type Stored = Record<string, unknown> & { id: string };
  const karim = (await readStore<Stored>(page, "patients")).find((patient) => patient.full_name === PATIENTS.karim)!;
  const today = (await readStore<Stored>(page, "visits")).find(
    (visit) => visit.patient_id === karim.id && visit.visit_date === PROFILE_DAY,
  )!;
  const form = (await readStore<Stored>(page, "visit_form_data")).find((row) => row.visit_id === today.id)!;
  const storedPlan = (await readStore<Stored>(page, "care_plans")).find((row) => row.patient_id === karim.id)!;
  const items = (await readStore<Stored & { sequence: number }>(page, "care_plan_items")).sort((a, b) => a.sequence - b.sequence);
  const assistantUser = (await readStore<Stored>(page, "users")).find((user) => user.full_name === ASSISTANT_NAME)!;
  const assistant = (await readStore<Stored>(page, "memberships")).find((membership) => membership.user_id === assistantUser.id)!;
  // Invoices and receipts are minted in this device's own number series.
  const [device] = await readStore<{ series: number | null }>(page, "device");
  const series = device.series ?? 1;

  const pastVisit = (id: string, visitDay: string, time: ClockTime, status: string, extra: Record<string, unknown> = {}) => ({
    store: "visits",
    value: {
      ...today,
      id,
      visit_date: visitDay,
      position: 1,
      scheduled_at: profileAt(visitDay, time),
      unique_scheduled_at: profileAt(visitDay, time),
      status,
      arrived_at: null,
      started_at: null,
      ended_at: null,
      note: null,
      created_at: profileAt(visitDay, "08:00"),
      ...extra,
    },
  });
  const done = (visitDay: string, start: ClockTime, end: ClockTime) => ({
    arrived_at: profileAt(visitDay, start),
    started_at: profileAt(visitDay, start),
    ended_at: profileAt(visitDay, end),
  });
  const owned = { org_id: today.org_id, location_id: today.location_id };
  const invoice = (id: string, number: number, visitId: string, total: number, paid: number, status: string, at: string) => ({
    store: "invoices",
    value: {
      id,
      ...owned,
      number,
      issued_year: 2026,
      series,
      patient_id: karim.id,
      practitioner_id: today.practitioner_id,
      visit_id: visitId,
      total,
      paid,
      status,
      issued_at: at,
      rev: 1,
    },
  });
  const payment = (id: string, invoiceId: string, amount: number, method: string, receipt: string, at: string) => ({
    store: "payments",
    value: {
      id,
      invoice_id: invoiceId,
      location_id: today.location_id,
      amount,
      method,
      receipt_number: receipt,
      series,
      note: null,
      after_close: false,
      created_by: assistant.id,
      created_at: at,
      rev: 1,
    },
  });
  const drug = (position: number, name: string, instructions: string) => ({
    store: "prescription_items",
    value: {
      id: `profile-drug-${position}`,
      prescription_id: "profile-rx-1",
      name,
      form: null,
      instructions,
      duration: null,
      note: null,
      position,
      rev: 1,
    },
  });
  const formData = (id: string, visitId: string, complaint: string, diagnosis: string) => ({
    store: "visit_form_data",
    value: { ...form, id, visit_id: visitId, data: { complaint, diagnosis } },
  });

  await putRows(page, [
    { store: "patients", value: { ...karim, phone: "+201112345678", gender: "male", birth_year: 1992 } },
    { store: "care_plans", value: { ...storedPlan, started_at: profileAt(day(-35), "08:50") } },
    { store: "care_plan_items", value: { ...items[0], visit_id: "profile-visit-1" } },
    { store: "care_plan_items", value: { ...items[1], visit_id: today.id } },
    pastVisit("profile-visit-1", day(-35), "09:00", "completed", { ...done(day(-35), "09:05", "09:30"), note: "تحسن ملحوظ في ثني الركبة" }),
    pastVisit("profile-visit-2", day(-14), "10:00", "completed", done(day(-14), "10:05", "10:25")),
    pastVisit("profile-visit-3", day(-7), "11:00", "cancelled", { cancel_reason: "patient" }),
    formData("profile-form-1", "profile-visit-1", "ألم في الركبة اليمنى", "التهاب وتر الرضفة"),
    formData("profile-form-2", "profile-visit-2", "تيبس الصبح", "خشونة بسيطة"),
    {
      store: "prescriptions",
      value: {
        id: "profile-rx-1",
        ...owned,
        visit_id: "profile-visit-1",
        patient_id: karim.id,
        practitioner_id: today.practitioner_id,
        series: 9,
        issued_year: 2026,
        number: 1,
        diagnosis: "التهاب وتر الرضفة",
        printed_at: profileAt(day(-35), "09:25"),
        created_by: today.created_by,
        created_at: profileAt(day(-35), "09:20"),
        rev: 1,
      },
    },
    drug(1, "Diclofenac 50mg", "قرص بعد الأكل مرتين"),
    drug(2, "Paracetamol 500mg", "قرص عند اللزوم"),
    invoice("profile-invoice-1", 1, "profile-visit-1", 30000, 30000, "paid", profileAt(day(-35), "09:30")),
    payment("profile-payment-1", "profile-invoice-1", 30000, "cash", "1", profileAt(day(-35), "09:35")),
    invoice("profile-invoice-2", 2, "profile-visit-2", 25000, 10000, "partial", profileAt(day(-14), "10:25")),
    payment("profile-payment-2", "profile-invoice-2", 10000, "card", "2", profileAt(day(-14), "10:30")),
    {
      store: "messages",
      value: {
        id: "profile-message-1",
        ...owned,
        patient_id: karim.id,
        visit_id: "profile-visit-2",
        template_key: "post_visit_followup",
        channel: "whatsapp",
        phone: "+201112345678",
        body: "مرحباً كريم، نتمنى تكون أحسن بعد الزيارة\nلو عندك أي سؤال كلمنا",
        attempted_at: profileAt(day(-14), "10:40"),
        marked_sent_at: profileAt(day(-14), "10:45"),
        created_by: assistant.id,
        created_at: profileAt(day(-14), "10:40"),
        rev: 1,
      },
    },
  ]);
  await reloadAs(page, { name: OWNER_NAME, pin: OWNER_PIN });
}
