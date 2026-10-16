import { expect, test, type Locator } from "@playwright/test";
import { gotoSeededDay, PATIENTS, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

// The move and cancel sheets set their text inside the sheet's own padding.
// They used to sit straight in the card, the heading's first letter cut by
// its rounded edge on a phone.
const INSET_PX = 12;

async function expectInset(text: Locator, sheet: Locator): Promise<void> {
  const [textBox, sheetBox] = await Promise.all([text.boundingBox(), sheet.boundingBox()]);
  expect(textBox && sheetBox).toBeTruthy();
  expect(textBox!.x - sheetBox!.x, "left inset").toBeGreaterThanOrEqual(INSET_PX);
  expect(sheetBox!.x + sheetBox!.width - (textBox!.x + textBox!.width), "right inset").toBeGreaterThanOrEqual(INSET_PX);
}

test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
});

for (const [item, heading] of [
  [S.moveMenuLabel, S.moveSheetHeading],
  [S.cancelMenuLabel, S.cancelPromptTitle],
] as const) {
  test(`the ${item} sheet keeps its heading and patient clear of its edges`, async ({ page }) => {
    await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    const sheet = page.getByRole("dialog");
    const title = sheet.getByText(heading, { exact: true });
    await expect(title).toBeVisible();
    await expectInset(title, sheet);
    await expectInset(sheet.getByText(PATIENTS.mona, { exact: true }), sheet);
  });
}

// Both sheets carry the shared head every other sheet has: the title as a
// heading and the × that closes the sheet, writing nothing.
for (const [item, heading] of [
  [S.moveMenuLabel, S.moveSheetHeading],
  [S.cancelMenuLabel, S.cancelPromptTitle],
] as const) {
  test(`the ${item} sheet has the shared head, and its × closes it with the visit unchanged`, async ({ page }) => {
    await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
  });
}
