import { expect, test } from "@playwright/test";
import { todayInCairo, weekdayOf } from "../src/domain/time";
import { emptySlotTiles, gotoRealDay, OWNER_NAME, OWNER_PIN, S, selectPractitioner, sidebar, SIDEBAR, SLOTS_DR } from "./support";

// Settings written on this device reach the day screen at once. The day
// screen used to read locations, practitioners and schedules once at boot,
// so a day made a working day (or another device's synced schedule) only
// showed after a reload.

test.beforeEach(async ({ page }) => {
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await expect(emptySlotTiles(page).first()).toBeVisible();
  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
});

test("today made a day off, then a working day again, shows on the day screen without a reload", async ({ page }) => {
  const settings = page.getByRole("dialog");
  const today = settings.getByRole("listitem").filter({ hasText: S.weekdayNames[weekdayOf(todayInCairo())] });
  await today.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await today.getByRole("button", { name: S.hoursMakeDayOffAction, exact: true }).click();
  await expect(today).toContainText(S.hoursModeDayOff);
  await page.keyboard.press("Escape");
  await expect(page.getByText(S.noScheduleToday)).toBeVisible();
  await expect(emptySlotTiles(page)).toHaveCount(0);

  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  await today.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await today.getByRole("button", { name: S.hoursAddWorkingDayAction, exact: true }).click();
  await expect(today).not.toContainText(S.hoursModeDayOff);
  await page.keyboard.press("Escape");
  await expect(emptySlotTiles(page).first()).toBeVisible();
});

test("a doctor renamed in settings shows renamed on the day screen without a reload", async ({ page }) => {
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsPractitionersTab, exact: true }).click();
  const row = settings.getByRole("listitem").filter({ hasText: SLOTS_DR });
  await row.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await settings.getByLabel(S.practitionerNameLabel, { exact: true }).fill("أحمد المصري الجديد");
  await settings.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(settings.getByRole("listitem").filter({ hasText: "أحمد المصري الجديد" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "أحمد المصري الجديد", exact: true })).toBeVisible();
});
