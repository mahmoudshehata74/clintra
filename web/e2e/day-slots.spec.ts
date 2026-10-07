import { expect, test } from "@playwright/test";
import {
  emptySlotTiles,
  gotoSeededDay,
  PATIENTS,
  pickSearchResult,
  readClockTime,
  rowFor,
  S,
  SEEDED_APP_BAR_DATE,
  selectPractitioner,
  SLOTS_DR,
  QUEUE_DR,
} from "./support";

test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
  // Wait until visits have loaded before reading the grid: until then every
  // slot renders as an empty tile, which would race the empty-tile assertions.
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
});

test("app bar renders the connection chip and date; the slab renders the delay trigger and counters", async ({ page }) => {
  // Connection chip: online or local-only, depending on the runner's network.
  await expect(
    page.getByRole("button", { name: new RegExp(`${S.syncOnline}|${S.syncLocal}`) }),
  ).toBeVisible();
  // The app bar's own date block (AppShell.tsx) — moved out of the day
  // screen's own heading in this task's COMMIT 1. It must show the seeded
  // day the grid itself is pinned to (?seedDay=1), not the real current
  // day: AppShell no longer resolves its own "today" (DayScreen reports it
  // up the same way it reports its title — see App.tsx).
  await expect(page.getByText(SEEDED_APP_BAR_DATE.dateLine, { exact: true })).toBeVisible();
  await expect(page.getByText(SEEDED_APP_BAR_DATE.weekdayLine, { exact: true })).toBeVisible();
  // The slab's delay trigger (no delay set on the seeded day, so no amount
  // appended — see DelayControl.tsx and strings.ts's delayControlTriggerLabel).
  await expect(page.getByRole("button", { name: S.delayControlTriggerLabel, exact: true })).toBeVisible();
  // The slab's cells (DaySlab.tsx), replacing the old Counters row.
  await expect(page.getByText(S.countersArrived)).toBeVisible();
  await expect(page.getByText(S.countersCompleted)).toBeVisible();
});

test("practitioner switcher appears and the selection persists across a reload", async ({ page }) => {
  await expect(page.getByRole("button", { name: SLOTS_DR, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: QUEUE_DR, exact: true })).toBeVisible();

  // Switch to the queue practitioner; the queue summary line is its signature.
  await selectPractitioner(page, QUEUE_DR);
  await expect(page.getByText(S.queueSummaryCurrentTurnLabel)).toBeVisible();

  // localStorage-backed selection survives a full reload (same context).
  await page.reload();
  await expect(page.getByText(S.queueSummaryCurrentTurnLabel)).toBeVisible();
});

test("single tap advances booked -> arrived -> in_room -> completed, and undo reverses", async ({ page }) => {
  const mona = rowFor(page, PATIENTS.mona);
  await expect(mona).toContainText(S.statusBooked);

  // booked -> arrived
  await mona.locator("button").filter({ hasText: PATIENTS.mona }).click();
  await expect(page.getByText(S.attendanceMarked)).toBeVisible();
  await expect(mona).toContainText(S.statusArrived);

  // undo reverses arrived -> booked
  await page.getByRole("button", { name: S.undoAction, exact: true }).click();
  await expect(mona).toContainText(S.statusBooked);

  // arrived -> in_room (the seeded arrived visit)
  const karim = rowFor(page, PATIENTS.karim);
  await expect(karim).toContainText(S.statusArrived);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.inRoomToastMessage)).toBeVisible();
  await expect(karim).toContainText(S.statusInRoom);

  // in_room -> completed
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();
  await expect(karim).toContainText(S.statusCompleted);
});

test("double-clicking a booked row's primary button advances only to arrived, not in_room", async ({ page }) => {
  const mona = rowFor(page, PATIENTS.mona);
  await expect(mona).toContainText(S.statusBooked);

  await mona.locator("button").filter({ hasText: PATIENTS.mona }).dblclick();
  await expect(page.getByText(S.attendanceMarked)).toBeVisible();
  await expect(mona).toContainText(S.statusArrived);
  await expect(page.getByText(S.inRoomToastMessage)).toHaveCount(0);
});

test("double-clicking an arrived row's primary button advances only to in_room, not completed", async ({ page }) => {
  const karim = rowFor(page, PATIENTS.karim);
  await expect(karim).toContainText(S.statusArrived);

  await karim.locator("button").filter({ hasText: PATIENTS.karim }).dblclick();
  await expect(page.getByText(S.inRoomToastMessage)).toBeVisible();
  await expect(karim).toContainText(S.statusInRoom);
  await expect(page.getByText(S.completedToastMessage)).toHaveCount(0);
});

test("empty-slot plus tile opens the booking sheet with the slot's time pre-filled", async ({ page }) => {
  const firstTile = emptySlotTiles(page).first();
  // The tile itself shows no time text (clintra-screens.html's .sl.free is a
  // bare centered "+"), so the time is read from the non-visual
  // data-slot-time hook instead — see SlotRow.tsx.
  const time = await readClockTime(await firstTile.getAttribute("data-slot-time"));
  await firstTile.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await pickSearchResult(dialog, PATIENTS.mona);

  // Jumped straight to confirm for the pre-filled time (the slots step was
  // skipped). exact: true tells this apart from the sheet's own head, which
  // now also names the chosen time.
  await expect(dialog.getByText(time, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true })).toBeVisible();
});

test("overflow menu offers move, cancel and mark-no-show with destructive actions grouped", async ({ page }) => {
  const mona = rowFor(page, PATIENTS.mona);
  await mona.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();

  const move = page.getByRole("menuitem", { name: S.moveMenuLabel, exact: true });
  const cancel = page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true });
  const noShow = page.getByRole("menuitem", { name: S.noShowMenuLabel, exact: true });
  await expect(move).toBeVisible();
  await expect(cancel).toBeVisible();
  await expect(noShow).toBeVisible();

  // Destructive grouping: cancel and no-show carry the danger treatment, move does not.
  await expect(cancel).toHaveClass(/text-danger/);
  await expect(noShow).toHaveClass(/text-danger/);
  await expect(move).not.toHaveClass(/text-danger/);
});
