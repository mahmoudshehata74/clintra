import { expect, test } from "@playwright/test";
import { AUTH, gotoSeededDay, PATIENTS, S, selectPractitioner, SIDEBAR, SLOTS_DR } from "./support";

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

test("printing shows only the printed page — no app bar, rail or backdrop", async ({ page }) => {
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: S.printDaySheetAction, exact: true }).click();

  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  // App bar (the lock action), rail (the "اليوم" nav item) and the day grid
  // behind the sheet (the cash-close action) are all hidden under print.
  await expect(page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: SIDEBAR.navDay, exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true })).toBeHidden();
  await page.emulateMedia({ media: null });
});

test("the preview page is as wide as the prototype's print page allows, and carries the clinic block", async ({ page }) => {
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  // Seed (src/db/seed.ts): organization "عيادة النور"; location "الفرع الرئيسي",
  // address "شارع الجمهورية، القاهرة", phone +20221234567 (local: 02 2123 4567).
  const clinicTitle = dialog.getByText("عيادة النور", { exact: true });
  await expect(clinicTitle).toBeVisible();
  await expect(dialog.getByText("الفرع الرئيسي · شارع الجمهورية، القاهرة · 02 2123 4567", { exact: true })).toBeVisible();
  await expect(dialog.getByText("+20221234567")).toHaveCount(0);
  // The phone is its own left-to-right run, so its digit groups keep their order.
  await expect(dialog.locator('bdi[dir="ltr"]', { hasText: "02 2123 4567" })).toBeVisible();

  // The page is min(600px, 100%) of the sheet body's content box.
  const widths = await clinicTitle.evaluate((el) => {
    const pageEl = el.parentElement!.parentElement!;
    const body = pageEl.parentElement!;
    const style = getComputedStyle(body);
    const available = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { page: pageEl.getBoundingClientRect().width, available };
  });
  expect(Math.abs(widths.page - Math.min(600, widths.available))).toBeLessThanOrEqual(1);
});
