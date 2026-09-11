import { expect, test } from "@playwright/test";
import {
  emptySlotTiles,
  gotoSeededDay,
  openBookingSheet,
  PATIENTS,
  readClockTime,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
} from "./support";

test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
  // Wait until visits have loaded (منى shows as booked) before any test reads
  // empty-slot tiles: until then the grid briefly renders every slot as empty,
  // which would make "the first empty slot" momentarily be an occupied time.
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
});

test("an existing patient is booked into a specific empty slot in exactly 3 taps", async ({ page }) => {
  // Practitioner selection above is test setup to pin the (otherwise
  // UUID-ordered) default; the three taps below are the booking interaction
  // itself: empty-slot tile, patient result, confirm.
  let taps = 0;
  const firstTile = emptySlotTiles(page).first();
  // The tile itself shows no time text (clintra-screens.html's .sl.free is a
  // bare centered "+"), so the time is read from the non-visual
  // data-slot-time hook instead — see SlotRow.tsx.
  const time = await readClockTime(await firstTile.getAttribute("data-slot-time"));

  taps++;
  await firstTile.click(); // tap 1 — the empty slot pre-fills its time

  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.hoda); // typing, not a tap

  taps++;
  await dialog.getByRole("button").filter({ hasText: PATIENTS.hoda }).first().click(); // tap 2 — choose patient

  // The pre-filled time took us straight to confirm; the default service needs
  // no tap, so the common path never grew past three.
  await expect(dialog.getByText(time)).toBeVisible();

  taps++;
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click(); // tap 3 — confirm

  await expect(page.getByText(S.visitBooked)).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(taps).toBe(3);
});

test("searching 'هدي' finds the patient stored as 'هدى'", async ({ page }) => {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill("هدي");
  await expect(dialog.getByText(PATIENTS.hoda)).toBeVisible();
});

test("a query that matches nothing still offers the new-patient row", async ({ page }) => {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill("ززززز");
  await expect(dialog.getByText(S.bookingNoResults)).toBeVisible();
  await expect(dialog.getByRole("button", { name: S.newPatientButtonPrefix })).toBeVisible();
});

test("the service picker pre-selects the first service and updates when another is tapped", async ({ page }) => {
  const firstTile = emptySlotTiles(page).first();
  await firstTile.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await dialog.getByRole("button").filter({ hasText: PATIENTS.mona }).first().click();

  // Service order in the DB is UUID-ordered, so which pill is pre-selected is
  // not fixed — assert the behaviour structurally: exactly one pill selected,
  // and tapping an unselected one moves the selection to it.
  const pills = dialog.locator("button.flex-1");
  await expect(pills).toHaveCount(3);
  await expect(dialog.locator("button.flex-1.border-green")).toHaveCount(1);

  const unselected = dialog.locator("button.flex-1:not(.border-green)").first();
  const unselectedName = (await unselected.innerText()).trim();
  await unselected.click();
  await expect(dialog.locator("button.flex-1.border-green")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: unselectedName, exact: true })).toHaveClass(/border-green/);
});

test("'من غير رقم' visibly disables the phone field, and the booking still completes", async ({ page }) => {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill("سمير اختبار");
  await dialog.getByRole("button", { name: S.newPatientButtonPrefix }).click();

  const phone = dialog.getByPlaceholder(S.newPatientPhonePlaceholder);
  await expect(phone).toBeEnabled();
  await dialog.getByRole("button", { name: S.newPatientNoPhoneToggle, exact: true }).click();
  await expect(phone).toBeDisabled();
  await expect(phone).toHaveValue("");

  // The new patient (no phone) is created and can be booked into a slot.
  await dialog.getByRole("button", { name: S.newPatientSubmitButton, exact: true }).click();
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.visitBooked)).toBeVisible();
});

test("the overbook flow appears only once the day is full and writes an over-capacity visit", async ({ page }) => {
  test.setTimeout(120_000);
  const cycle = [PATIENTS.mona, PATIENTS.karim, PATIENTS.yasmin, PATIENTS.omar, PATIENTS.hoda];
  const dialog = page.getByRole("dialog");
  const slotTiles = dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ });
  const overbookButton = dialog.getByRole("button", { name: S.overbookButtonLabel, exact: true });

  // Fill every remaining empty slot through the normal booking flow until the
  // slots step has no tiles left and offers the overbook button instead.
  for (let i = 0; i < 12; i++) {
    await openBookingSheet(page);
    await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(cycle[i % cycle.length]);
    await dialog.getByRole("button").filter({ hasText: cycle[i % cycle.length] }).first().click();
    await expect(dialog.getByRole("button", { name: S.bookingBackAction, exact: true })).toBeVisible();
    // Wait for the slots step to settle into EITHER a tile or the overbook
    // button, so the loop never reads a transient (re-render lag) count.
    await expect(slotTiles.first().or(overbookButton)).toBeVisible();

    if (i === 0) {
      // While empty slots remain, the overbook button is not offered.
      await expect(slotTiles.first()).toBeVisible();
      await expect(overbookButton).toHaveCount(0);
    }

    if (await overbookButton.isVisible()) {
      break; // day is full — the overbook button is now showing
    }
    await slotTiles.first().click();
    await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await expect(overbookButton).toBeVisible();
  await overbookButton.click();
  await expect(dialog.getByText(S.overbookPickerHeading)).toBeVisible();
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();

  await expect(page.getByText(S.visitBooked)).toBeVisible();
  // The over-capacity visit gets its own row, marked "فوق السعة" (is_overbooked).
  await expect(page.getByText(S.overbookedRowBadge).first()).toBeVisible();
});
