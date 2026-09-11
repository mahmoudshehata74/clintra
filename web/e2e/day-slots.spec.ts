import { expect, test } from "@playwright/test";
import { emptySlotTiles, gotoSeededDay, PATIENTS, readClockTime, rowFor, S, selectPractitioner, SLOTS_DR, QUEUE_DR } from "./support";

test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
  // Wait until visits have loaded before reading the grid: until then every
  // slot renders as an empty tile, which would race the empty-tile assertions.
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
});

test("header renders connection chip, date, delay chip, and counters", async ({ page }) => {
  // Connection chip: online or local-only, depending on the runner's network.
  await expect(
    page.getByRole("button", { name: new RegExp(`${S.syncOnline}|${S.syncLocal}`) }),
  ).toBeVisible();
  // Date heading (font-display 2xl line under the brand).
  const dateLine = page.locator("p.font-display.text-2xl").first();
  await expect(dateLine).toBeVisible();
  expect((await dateLine.innerText()).trim().length).toBeGreaterThan(0);
  // Delay chip (no delay set on the seeded day).
  await expect(page.getByRole("button", { name: S.delayNone, exact: true })).toBeVisible();
  // Counters row.
  await expect(page.getByText(S.countersTotalBooked)).toBeVisible();
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
  await dialog.getByRole("button").filter({ hasText: PATIENTS.mona }).first().click();

  // Jumped straight to confirm for the pre-filled time (the slots step was skipped).
  await expect(dialog.getByText(time)).toBeVisible();
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

  // Destructive grouping: cancel and no-show carry the red treatment, move does not.
  await expect(cancel).toHaveClass(/text-red/);
  await expect(noShow).toHaveClass(/text-red/);
  await expect(move).not.toHaveClass(/text-red/);
});
