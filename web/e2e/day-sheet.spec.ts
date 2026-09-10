import { expect, test } from "@playwright/test";
import { gotoSeededDay, PATIENTS, S, selectPractitioner, SLOTS_DR } from "./support";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
});

test("the day sheet opens from the header and shows tomorrow's visits, not today's", async ({ page }) => {
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.daySheetTitle)).toBeVisible();

  // The seed only books visits on its demo day (today); tomorrow is empty.
  // Seeing the empty-tomorrow message — and none of today's patients — proves
  // the sheet reads the next day, not the current one.
  await expect(dialog.getByText(S.daySheetEmpty)).toBeVisible();
  await expect(dialog.getByText(PATIENTS.mona)).toHaveCount(0);
});

test("the day sheet's print view carries the print-header note", async ({ page }) => {
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: S.printDaySheetAction, exact: true }).click();

  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await page.emulateMedia({ media: null });
});
