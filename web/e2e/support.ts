import { expect, type Page } from "@playwright/test";
// The real UI strings, imported rather than duplicated so a wording change in
// the app can never silently drift from the tests. strings.ts has no imports
// of its own, so pulling it into the Playwright bundle is cheap and safe.
import { dayScreenStrings } from "../src/screens/day/strings";

export const S = dayScreenStrings;

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
export async function gotoSeededDay(page: Page): Promise<void> {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  // Wait until the header's practitioner switcher is rendered — proves the
  // seed finished and static data loaded.
  await expect(page.getByRole("button", { name: SLOTS_DR })).toBeVisible();
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
