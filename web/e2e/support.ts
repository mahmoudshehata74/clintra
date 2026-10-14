import { expect, type Locator, type Page } from "@playwright/test";
// The real UI strings, imported rather than duplicated so a wording change in
// the app can never silently drift from the tests. These modules have no
// imports of their own, so pulling them into the Playwright bundle is cheap.
import { authStrings } from "../src/auth/authStrings";
// Dev-only seed PINs — imported, never written as literals into the tests, and
// never logged, per the task's rule. See src/auth/devPins.ts.
import { DEV_SEED_PINS } from "../src/auth/devPins";
import { formatAppBarDate } from "../src/components/appBarDate";
import { formatEgyptianPhoneForDisplay } from "../src/domain/phone";
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

export type Drug = { name: string; form?: string; instructions: string; duration?: string; note?: string };

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
  if (drug.note !== undefined) {
    await scope.getByLabel(VISIT.rxNoteLabel, { exact: true }).fill(drug.note);
  }
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

// Screen fixtures shared by the screenshot and comparison captures
// (screenshots.spec.ts, compare.spec.ts).

/** Complete the seeded arrived visit and open its (unpaid) invoice. */
export async function openFreshInvoice(page: Page) {
  await selectPractitioner(page, SLOTS_DR);
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(karim).toContainText(S.statusInRoom);

  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();
  await karim.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  return page.getByRole("dialog");
}

// The shared money helper drops the fraction when the piastres part is zero
// and adds thousands separators, so this tolerates both "400" and "400.50".
export function parsePounds(text: string): number {
  const match = text.match(/([\d,]+)(?:\.(\d+))?/);
  const whole = Number((match?.[1] ?? "0").replace(/,/g, ""));
  const fraction = match?.[2] ? Number(`0.${match[2]}`) : 0;
  return whole + fraction;
}

export async function recordHalfPayment(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const total = parsePounds(await labeledRowValue(dialog, S.invoiceTotalLabel));
  // Not exact: the button's own accessible name now also carries the amount due.
  await dialog.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();
}

/** Opens a day-grid row's visit form, fills both fields (each autosaves on blur), and closes it. */
export async function fillVisitForm(page: Page, patientName: string, complaint: string, diagnosis: string): Promise<void> {
  await rowFor(page, patientName).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const form = page.getByRole("dialog");
  for (const [label, placeholder, value] of [
    [S.visitFormComplaintLabel, S.visitFormComplaintPlaceholder, complaint],
    [S.visitFormDiagnosisLabel, S.visitFormDiagnosisPlaceholder, diagnosis],
  ] as const) {
    const field = form.getByPlaceholder(placeholder);
    await field.fill(value);
    await field.blur();
    // Each field's own "اتحفظ" sits next to its own label, so the second
    // save is waited for on its own rather than on the first one's indicator.
    const labelRow = form.locator("div").filter({ has: page.getByText(label, { exact: true }) }).last();
    await expect(labelRow.getByText(S.visitFormSavedIndicator)).toBeVisible();
  }
  await form.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(form).toBeHidden();
}

export const KARIM_BIRTH_YEAR = 1992;
export const KARIM_PHONE = "+201001234567";
export const KARIM_AGE = Number(todayInCairo().slice(0, 4)) - KARIM_BIRTH_YEAR;

/**
 * Fixture data the app has no screen for yet (a patient's birth year and
 * phone; a visit on another day), written straight into IndexedDB the way
 * other specs reach the store. Patients and practitioners are picked by
 * name. Resolves to how many rows each step updated.
 */
async function adjustKarimFixture(page: Page): Promise<{ patients: number; visits: number }> {
  return page.evaluate(
    async ({ patientName, practitionerName, birthYear, phone, shiftDays }) => {
      const req = indexedDB.open("clintra");
      const database: IDBDatabase = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const all = <T,>(store: IDBObjectStore): Promise<T[]> =>
        new Promise((resolve, reject) => {
          const getAll = store.getAll();
          getAll.onsuccess = () => resolve(getAll.result as T[]);
          getAll.onerror = () => reject(getAll.error);
        });
      const put = (store: IDBObjectStore, row: unknown): Promise<void> =>
        new Promise((resolve, reject) => {
          const request = store.put(row);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      type Row = Record<string, unknown>;
      try {
        const tx = database.transaction(["patients", "practitioners", "visits"], "readwrite");
        const patients = (await all<Row>(tx.objectStore("patients"))).filter((row) => row.full_name === patientName);
        const practitioners = (await all<Row>(tx.objectStore("practitioners"))).filter(
          (row) => row.full_name === practitionerName,
        );
        for (const patient of patients) {
          await put(tx.objectStore("patients"), { ...patient, birth_year: birthYear, phone });
        }
        const shiftMs = shiftDays * 86_400_000;
        const shiftInstant = (value: unknown) =>
          typeof value === "string" ? new Date(new Date(value).getTime() + shiftMs).toISOString() : value;
        const visits = (await all<Row>(tx.objectStore("visits"))).filter(
          (row) =>
            patients.some((patient) => patient.id === row.patient_id) &&
            practitioners.some((practitioner) => practitioner.id === row.practitioner_id) &&
            row.status === "completed",
        );
        for (const visit of visits) {
          const [year, month, date] = String(visit.visit_date).split("-").map(Number);
          const day = new Date(Date.UTC(year, month - 1, date) + shiftMs).toISOString().slice(0, 10);
          await put(tx.objectStore("visits"), {
            ...visit,
            visit_date: day,
            scheduled_at: shiftInstant(visit.scheduled_at),
            unique_scheduled_at: shiftInstant(visit.unique_scheduled_at),
            arrived_at: shiftInstant(visit.arrived_at),
            started_at: shiftInstant(visit.started_at),
            ended_at: shiftInstant(visit.ended_at),
          });
        }
        return { patients: patients.length, visits: visits.length };
      } finally {
        database.close();
      }
    },
    {
      patientName: PATIENTS.karim,
      practitionerName: QUEUE_DR,
      birthYear: KARIM_BIRTH_YEAR,
      phone: KARIM_PHONE,
      shiftDays: -21,
    },
  );
}

// The visit workspace (screen 10) for كريم, in the room on the real day
// since 09:00, with a two-visit history on two different days. On the
// seeded Monday first: his seeded queue visit (completed with سلمى) gets a
// diagnosis and is then moved three weeks earlier, he gets a birth year and
// a phone, and his seeded arrived slots visit is seen, closed, diagnosed and
// given two drugs. Every service and patient is picked by name and the
// clock is pinned, so desktop and mobile render the same data.
export async function karimWorkspaceWithHistory(page: Page): Promise<void> {
  const day = todayInCairo();
  const at = (time: ClockTime) => new Date(cairoInstant(day, time));
  await page.clock.install({ time: at("08:30") });

  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, QUEUE_DR);
  await fillVisitForm(page, PATIENTS.karim, "ألم في الركبة بعد الجري", "إجهاد عضلي");
  expect(await adjustKarimFixture(page)).toEqual({ patients: 1, visits: 1 });
  await selectPractitioner(page, SLOTS_DR);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
  await fillVisitForm(page, PATIENTS.karim, "ألم في الركبة اليمنى", "التهاب أوتار");
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const earlier = page.getByRole("dialog");
  await addDrug(earlier, { name: "Diclofenac 50mg", instructions: "قرص مرتين يوميًا بعد الأكل", duration: "5 أيام" });
  await addDrug(earlier, { name: "Voltaren Gel", instructions: "دهان موضعي على الركبة" });
  await earlier.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(earlier).toBeHidden();

  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");
  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  // Half a minute past, so the seconds the taps above took never round the
  // session length down to 13 on a slower run.
  await page.clock.setSystemTime(new Date(at("09:14").getTime() + 30_000));
}

/** Fills the workspace's two fields and three drugs, waiting for each save. */
export async function fillWorkspace(scope: ReturnType<Page["getByRole"]>): Promise<void> {
  for (const [key, placeholder, value] of [
    ["complaint", S.visitFormComplaintPlaceholder, "ألم مستمر في الركبة اليمنى من 5 أيام، يزيد مع الحركة"],
    ["diagnosis", S.visitFormDiagnosisPlaceholder, "التهاب وتر الرضفة، حاد"],
  ] as const) {
    const field = scope.getByPlaceholder(placeholder);
    await field.fill(value);
    await field.blur();
    // Each field's own "اتحفظ" hint (Field's `${id}-hint`).
    await expect(scope.locator(`#visit-form-${key}-hint`)).toHaveText(S.visitFormSavedIndicator);
  }
  await addDrug(scope, { name: "Diclofenac 50mg", instructions: "قرص مرتين يوميًا بعد الأكل", duration: "7 أيام" });
  await addDrug(scope, { name: "Paracetamol 500mg", instructions: "قرص عند الألم، بحد أقصى 4 مرات يوميًا" });
  await addDrug(scope, { name: "Voltaren Gel", instructions: "دهان موضعي 3 مرات يوميًا على الركبة", duration: "أسبوعين" });
  const history = scope.getByRole("region", { name: VISIT.historyTwo, exact: true });
  await expect(history).toBeVisible();
  // Each row leads with its d/m date run.
  const dates = await history
    .getByRole("listitem")
    .evaluateAll((rows) => rows.map((row) => row.querySelector("bdi")?.textContent ?? ""));
  expect(new Set(dates).size).toBe(2);
  await expect(scope).toContainText(`${KARIM_AGE} ${VISIT.ageUnit}`);
  await expect(scope).toContainText(formatEgyptianPhoneForDisplay(KARIM_PHONE));
  await expect(scope.getByText(S.visitFormSavedIndicator)).toHaveCount(0);
}


// The printed prescription (screen 16) for كريم's visit above: his
// diagnosis and three drugs, two with a form and one with a note, as the
// prototype's own example, then `extraDrugs` more. window.print is stubbed
// before the fixture's first navigation, so a print leaves the print target
// mounted.
export async function karimPrescriptionPreview(page: Page, extraDrugs = 0): Promise<ReturnType<Page["getByRole"]>> {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await karimWorkspaceWithHistory(page);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const workspace = page.getByRole("dialog");
  const diagnosis = workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
  await diagnosis.fill("التهاب وتر الرضفة");
  await diagnosis.blur();
  await expect(workspace.locator("#visit-form-diagnosis-hint")).toHaveText(S.visitFormSavedIndicator);
  await addDrug(workspace, {
    name: "Diclofenac 50mg",
    form: "Tablet",
    instructions: "قرص مرتين يوميًا بعد الأكل",
    duration: "7 أيام",
    note: "يوقف مع أي ألم في المعدة",
  });
  await addDrug(workspace, { name: "Paracetamol 500mg", form: "Tablet", instructions: "قرص عند الحاجة، بحد أقصى 4 مرات يوميًا" });
  await addDrug(workspace, { name: "Voltaren Gel 1%", instructions: "دهان على مكان الألم 3 مرات يوميًا", duration: "14 يوم" });
  for (const [index, name] of EXTRA_DRUGS.slice(0, extraDrugs).entries()) {
    await addDrug(workspace, {
      name,
      instructions: "قرص مرة يوميًا بعد الفطار",
      duration: "30 يوم",
      ...(index % 3 === 0 ? { form: "Tablet" } : {}),
    });
  }

  await workspace.getByRole("button", { name: RX.printButton, exact: true }).click();
  const sheet = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: RX.sheetTitle, exact: true }) });
  await expect(sheet.getByText(RX.previewNote, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("listitem")).toHaveCount(3 + extraDrugs);
  await expect(sheet).toContainText(`${KARIM_AGE} ${RX.ageUnit}`);
  return sheet;
}

export const EXTRA_DRUGS = [
  "Omeprazole 20mg",
  "Vitamin D3 50000 IU",
  "Calcium 600mg",
  "Esomeprazole 40mg",
  "Cetirizine 10mg",
  "Metformin 500mg",
  "Atorvastatin 20mg",
  "Folic Acid 5mg",
  "Magnesium 250mg",
];

// Screen 19, the messages page and the send sheet. Three new patients with
// phones booked on the real day by the owner, the clock pinned; messages
// opened at fixed times — ليلى by WhatsApp at 09:00 (then marked sent), سامح
// by SMS at 09:05 with the appointment reminder, نادية by WhatsApp at 09:10
// with the follow-up — and the appointment reminder then overridden by the
// owner and selected. window.open is recorded, never followed; an sms: link
// stays a request the page does not leave for.
export const MESSAGE_PATIENTS = [
  { name: "ليلى مراد", phone: "01001234567" },
  { name: "سامح عادل", phone: "01112345678" },
  { name: "نادية فؤاد", phone: "01223456789" },
] as const;

export async function bookMessagePatients(page: Page): Promise<(time: ClockTime) => Date> {
  const day = todayInCairo();
  const at = (time: ClockTime) => new Date(cairoInstant(day, time));
  await recordWindowOpen(page);
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  for (const patient of MESSAGE_PATIENTS) {
    await bookNewPatientWithPhone(page, patient.name, patient.phone);
  }
  return at;
}

export async function sendFromRow(page: Page, name: string, template: string | null, channel: "whatsapp" | "sms"): Promise<void> {
  const sheet = await openSendSheetFromRow(page, name);
  if (template) {
    await sheet.getByRole("group", { name: MSG.sendTemplateLabel }).getByRole("button", { name: template, exact: true }).click();
  }
  if (channel === "sms") {
    await sheet.getByRole("group", { name: MSG.sendChannelLabel }).getByRole("button", { name: MSG.channelSms, exact: true }).click();
  }
  await sheet.getByRole("button", { name: channel === "sms" ? MSG.openSms : MSG.openWhatsApp, exact: true }).click();
  await expect(sheet).toBeHidden();
}

// The care plan (screen 17) for كريم on a fixed day, so every capture shows
// the same dates: the plan is created from his visit in the room through
// the form, the five sessions before today are written straight into the
// store as visits of past weeks (three of them paid), and the sixth is
// booked from the plan for today at 09:30 — five done, one booked, four
// suggested, as the prototype shows. The sheet is taller than a screen, so
// the window grows to show all of it.
export const PLAN_DAY = "2026-10-14";
export const planAt = (time: ClockTime) => new Date(cairoInstant(PLAN_DAY, time));
export const PLAN_GOAL = "استعادة كامل حركة الركبة اليمنى";
export const PLAN_DIAGNOSIS = "التهاب وتر الرضفة";

/** كريم in the room at 09:00 on PLAN_DAY, as the owner, his workspace open. */
export async function karimWorkspaceOnPlanDay(page: Page): Promise<ReturnType<Page["getByRole"]>> {
  await page.clock.install({ time: planAt("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");
  await page.clock.setSystemTime(planAt("09:00"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const workspace = page.getByRole("dialog");
  await expect(workspace.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
  return workspace;
}

// The doctor's day mid-morning on the real day, with the page clock pinned
// and stepped forward so the wall-clock figures read like a real morning.
// Every visit is built through the app's own write paths, and every service
// is picked by name (see bookFirstOpenSlot), so desktop and mobile render
// identical data.
//
// First, on the seeded Monday (?seedDay=1): ياسمين's seeded completed visit
// gets a complaint and diagnosis (her full last-visit block below), and
// كريم's seeded arrived visit is seen and closed (his visit with this
// practitioner and its unpaid invoice — the brief's count and invoice line).
// Then on the real day: منى seen 09:00–09:18 with no diagnosis and nothing
// paid (one attention item of each kind), عمر arrived 09:05 and waiting past
// the alert line, ياسمين called in at 09:28, كريم arrived 09:33 (the short
// waiter, and next), هدى booked for later.
export async function doctorDayFixture(page: Page): Promise<void> {
  const day = todayInCairo();
  const at = (time: ClockTime) => new Date(cairoInstant(day, time));
  const service = "كشف عام";
  await page.clock.install({ time: at("08:30") });

  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await fillVisitForm(page, PATIENTS.yasmin, "آلام أسفل الظهر بعد رفع حاجة تقيلة", "شد عضلي حاد");
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
  await fillVisitForm(page, PATIENTS.karim, "ألم في الركبة اليمنى", "التهاب أوتار");

  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  for (const name of [PATIENTS.mona, PATIENTS.yasmin, PATIENTS.karim, PATIENTS.omar, PATIENTS.hoda]) {
    await bookFirstOpenSlot(page, name, service);
  }

  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.mona, S.statusArrived);
  await advanceRowTo(page, PATIENTS.mona, S.statusInRoom);
  await page.clock.setSystemTime(at("09:05"));
  await advanceRowTo(page, PATIENTS.omar, S.statusArrived);
  await page.clock.setSystemTime(at("09:18"));
  await advanceRowTo(page, PATIENTS.mona, S.statusCompleted);
  await page.clock.setSystemTime(at("09:25"));
  await advanceRowTo(page, PATIENTS.yasmin, S.statusArrived);
  await page.clock.setSystemTime(at("09:28"));
  await advanceRowTo(page, PATIENTS.yasmin, S.statusInRoom);
  await page.clock.setSystemTime(at("09:33"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await page.clock.setSystemTime(at("09:42"));

  await openDoctorDay(page);
  const hero = doctorSection(page, DOCTOR.heroLabel);
  await expect(hero).toContainText(PATIENTS.yasmin);
  await expect(hero).toContainText("شد عضلي حاد");
  const brief = doctorSection(page, DOCTOR.briefNextHeading);
  await expect(brief).toContainText(PATIENTS.karim);
  await expect(brief).toContainText(DOCTOR.totalVisitsOne);
  await expect(brief).toContainText(DOCTOR.invoiceUnpaid);
  const waiting = doctorSection(page, DOCTOR.waitingHeading);
  await expect(waiting.getByRole("listitem")).toHaveCount(2);
  await expect(waiting).toContainText(DOCTOR.waitingAboveThreshold);
  const attention = doctorSection(page, DOCTOR.attentionHeading);
  await expect(attention.getByRole("listitem")).toHaveCount(2);
  await expect(attention).toContainText(DOCTOR.attentionMissingDiagnosisTitle);
  await expect(attention).toContainText(DOCTOR.invoiceUnpaid);
}

/** Three bookings on the real day, then an arrival, a cancellation and a no-show; the audit log open. */
export async function auditDayFixture(page: Page): Promise<void> {
  // The real day: audit rows are stamped "now", so only today's log shows
  // them (see support.ts's gotoRealDay). Three bookings, then one arrival
  // (default dot), one cancellation (danger) and one no-show (warn).
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  for (const name of [PATIENTS.mona, PATIENTS.omar, PATIENTS.karim]) {
    await openBookingSheet(page);
    const booking = page.getByRole("dialog");
    await booking.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
    await pickSearchResult(booking, name);
    await booking.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
    await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
    await expect(rowFor(page, name)).toContainText(S.statusBooked);
  }
  await rowFor(page, PATIENTS.mona).locator("button").filter({ hasText: PATIENTS.mona }).click();
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusArrived);
  await rowFor(page, PATIENTS.omar).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true }).click();
  await page.getByRole("button", { name: S.cancelReasonPatient, exact: true }).click();
  await expect(rowFor(page, PATIENTS.omar)).toContainText(S.statusCancelled);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.noShowMenuLabel, exact: true }).click();
  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.statusNoShow);
  await openAuditLog(page);
}

/** Three messages sent from the day screen, one marked sent, and the appointment reminder overridden; the messages page open. */
export async function messagesPageFixture(page: Page): Promise<void> {
  const at = await bookMessagePatients(page);
  await page.clock.setSystemTime(at("09:00"));
  await sendFromRow(page, MESSAGE_PATIENTS[0].name, null, "whatsapp");
  await page.clock.setSystemTime(at("09:05"));
  await sendFromRow(page, MESSAGE_PATIENTS[1].name, "تذكير بالموعد", "sms");
  await page.clock.setSystemTime(at("09:10"));
  await sendFromRow(page, MESSAGE_PATIENTS[2].name, "متابعة بعد الزيارة", "whatsapp");

  await openMessagesPage(page);
  const recent = page.getByRole("region", { name: MSG.recentHeading }).getByRole("listitem");
  await expect(recent).toHaveCount(3);
  await recent.filter({ hasText: MESSAGE_PATIENTS[0].name }).getByRole("button", { name: MSG.statusOpened, exact: true }).click();
  await expect(recent.getByRole("button", { name: MSG.statusSent, exact: true })).toHaveCount(1);

  const templates = page.getByRole("navigation", { name: MSG.templatesHeading });
  await templates.getByRole("button", { name: /تذكير بالموعد/ }).click();
  const reminder = page.getByRole("region", { name: `${MSG.previewPrefix} تذكير بالموعد` });
  await reminder.getByRole("button", { name: MSG.editAction, exact: true }).click();
  await reminder
    .getByLabel(MSG.editorLabel, { exact: true })
    .fill(
      [
        "أهلاً {{patient_name}}،",
        "بنفكّرك بموعدك بكرة الساعة {{time}} مع {{doctor_name}}.",
        "لو هتتأخر كلّمنا: {{clinic_phone}}",
      ].join("\n"),
    );
  await reminder.getByRole("button", { name: MSG.saveAction, exact: true }).click();
  await expect(reminder.getByText(MSG.chipOverridden, { exact: true })).toBeVisible();
}

/** كريم's plan, five sessions done, the sixth booked from the plan, four suggested; resolves to the plan sheet. */
export async function carePlanSheetFixture(page: Page): Promise<Locator> {
  const workspace = await karimWorkspaceOnPlanDay(page);
  const created = await fillNewPlan(page, workspace, PLAN_GOAL, [
    { service: "فحص شامل", count: "1", gap: "0" },
    { service: "كشف عام", count: "9", gap: "7" },
  ]);
  await created.getByLabel(PLAN.diagnosisField, { exact: true }).fill(PLAN_DIAGNOSIS);
  await created.getByRole("button", { name: PLAN.startAction, exact: true }).click();
  await expect(created.getByRole("heading", { name: PLAN.sessionsHeading, exact: true })).toBeVisible();

  // Sessions 1–5: visits of the five weeks before PLAN_DAY, done; 1–3 paid.
  await syncSettled(page);
  type Stored = Record<string, unknown> & { id: string };
  const visits = await readStore<Stored>(page, "visits");
  const karim = (await readStore<Stored>(page, "patients")).find((patient) => patient.full_name === PATIENTS.karim)!;
  const today = visits.find((visit) => visit.patient_id === karim.id && visit.visit_date === PLAN_DAY)!;
  const items = (await readStore<Stored & { sequence: number; price: number }>(page, "care_plan_items")).sort(
    (a, b) => a.sequence - b.sequence,
  );
  // The plan starts on the day of its first session, so its hero reads the
  // same date as session 1.
  const plan = (await readStore<Stored>(page, "care_plans")).find((row) => row.patient_id === karim.id)!;
  const rows: { store: string; value: unknown }[] = [
    { store: "care_plans", value: { ...plan, started_at: cairoInstant(addDaysToClinicDay(PLAN_DAY, -35), "09:00") } },
  ];
  for (const [index, item] of items.slice(0, 5).entries()) {
    const day = addDaysToClinicDay(PLAN_DAY, -35 + index * 7);
    const at = cairoInstant(day, "09:00");
    const visitId = `plan-visit-${index + 1}`;
    rows.push({
      store: "visits",
      value: {
        ...today,
        id: visitId,
        visit_date: day,
        position: 1,
        scheduled_at: at,
        unique_scheduled_at: at,
        status: "completed",
        service_id: item.service_id,
        arrived_at: at,
        started_at: at,
        ended_at: cairoInstant(day, "09:30"),
        created_at: at,
      },
    });
    rows.push({ store: "care_plan_items", value: { ...item, visit_id: visitId } });
    if (index < 3) {
      const invoiceId = `plan-invoice-${index + 1}`;
      rows.push({
        store: "invoices",
        value: {
          id: invoiceId,
          org_id: today.org_id,
          location_id: today.location_id,
          number: index + 1,
          issued_year: 2026,
          series: 9,
          patient_id: karim.id,
          practitioner_id: today.practitioner_id,
          visit_id: visitId,
          total: item.price,
          paid: item.price,
          status: "paid",
          issued_at: at,
          rev: 1,
        },
      });
      rows.push({
        store: "payments",
        value: {
          id: `plan-payment-${index + 1}`,
          invoice_id: invoiceId,
          location_id: today.location_id,
          amount: item.price,
          method: "cash",
          receipt_number: String(index + 1),
          series: 9,
          note: null,
          after_close: false,
          created_by: today.created_by,
          created_at: at,
          rev: 1,
        },
      });
    }
  }
  await putRows(page, rows);
  await reloadAs(page, { name: OWNER_NAME, pin: OWNER_PIN });

  // Session 6, booked from the plan for today at 09:30.
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(PLAN.badgePrefix) }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: PLAN.sheetTitle, exact: true }) });
  await expect(sheet.getByText("5 / 10 جلسة", { exact: true })).toBeVisible();
  await expect(sheet).toContainText(`${PLAN.startedLabel} 9 / 9 / 2026`);
  await sheet.getByRole("button", { name: PLAN.bookNext, exact: true }).click();
  const booking = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: new RegExp(`^${S.bookingButtonLabel}`) }) });
  await booking.getByRole("button", { name: "09:30", exact: true }).click();
  await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(booking).toBeHidden();
  await expect(sheet.getByText(PLAN.stateNext, { exact: true })).toBeVisible();
  await expect(sheet.getByText(PLAN.stateSuggested, { exact: true })).toHaveCount(4);
  await expect(sheet).toContainText(`${PLAN.paidLabel} 1,100 ج.م`);
  return sheet;
}
