import { expect, type Page } from "@playwright/test";
// The real UI strings, imported rather than duplicated so a wording change in
// the app can never silently drift from the tests. These modules have no
// imports of their own, so pulling them into the Playwright bundle is cheap.
import { authStrings } from "../src/auth/authStrings";
// Dev-only seed PINs — imported, never written as literals into the tests, and
// never logged, per the task's rule. See src/auth/devPins.ts.
import { DEV_SEED_PINS } from "../src/auth/devPins";
import { dayScreenStrings } from "../src/screens/day/strings";

export const S = dayScreenStrings;
export const AUTH = authStrings;
export { DEV_SEED_PINS };

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
 */
export async function gotoRealDay(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await login(page);
  await expect(page.getByRole("button", { name: SLOTS_DR })).toBeVisible();
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
