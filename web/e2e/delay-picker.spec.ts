import { expect, test, type Page } from "@playwright/test";
import { effectiveStartTime } from "../src/screens/day/dayDelay";
import { expectControlsHitTest, expectInsideViewport } from "./interaction";
import { gotoSeededDay, PATIENTS, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

// The seeded slots schedule opens at 09:00 (web/src/db/seed.ts).
const SLOTS_START = "09:00";

test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
});

const trigger = (page: Page) => page.getByRole("button", { name: new RegExp(`^${S.delayControlTriggerLabel}`) });
const picker = (page: Page) => page.getByRole("dialog", { name: S.delayPickerTitle, exact: true });

test("the delay picker opens unclipped, inside the viewport, every item reachable", async ({ page }) => {
  await trigger(page).click();
  const dialog = picker(page);
  await expect(dialog).toBeVisible();
  await expectInsideViewport(dialog);
  await expectControlsHitTest(dialog);
  // The presets, the minutes field and its button, and "clear".
  for (const minutes of [15, 30, 60]) {
    await expect(dialog.getByRole("button", { name: `+${minutes} ${S.delayMinutesSuffix}`, exact: true })).toBeVisible();
  }
  await expect(dialog.getByLabel(S.delayCustomLabel, { exact: true })).toHaveAttribute("inputmode", "numeric");
  await expect(dialog.getByRole("button", { name: S.delayCustomApply, exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: S.delayClearOption, exact: true })).toBeVisible();
});

test("typing 25 minutes applies them to the trigger and the effective start", async ({ page }) => {
  await trigger(page).click();
  const field = picker(page).getByLabel(S.delayCustomLabel, { exact: true });
  await field.fill("25");
  await expect(field).toHaveValue("25");
  await field.press("Enter");
  await expect(picker(page)).toBeHidden();
  await expect(trigger(page)).toHaveText(`${S.delayControlTriggerLabel} · 25 ${S.delayMinutesSuffix}`);

  await trigger(page).click();
  await expect(picker(page)).toContainText(`${S.delayLineActualStart} ${effectiveStartTime(SLOTS_START, 25)}`);
  await expectInsideViewport(picker(page));
  await expectControlsHitTest(picker(page));

  // "clear" takes the delay off again.
  await picker(page).getByRole("button", { name: S.delayClearOption, exact: true }).click();
  await expect(trigger(page)).toHaveText(S.delayControlTriggerLabel);
});

test("an invalid minutes value shows an Arabic error and applies nothing", async ({ page }) => {
  await trigger(page).click();
  const dialog = picker(page);
  const field = dialog.getByLabel(S.delayCustomLabel, { exact: true });
  for (const value of ["0", "241", "2.5"]) {
    await field.fill(value);
    await dialog.getByRole("button", { name: S.delayCustomApply, exact: true }).click();
    await expect(dialog.getByText(S.delayCustomError, { exact: true })).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
  }
  await expectInsideViewport(dialog);
  await expectControlsHitTest(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger(page)).toHaveText(S.delayControlTriggerLabel);
  await expect(trigger(page)).toBeFocused();
});

test("Arabic-Indic digits typed into the field read back as Latin ones", async ({ page }) => {
  await trigger(page).click();
  const field = picker(page).getByLabel(S.delayCustomLabel, { exact: true });
  await field.pressSequentially("٤٠");
  await expect(field).toHaveValue("40");
  await picker(page).getByRole("button", { name: S.delayCustomApply, exact: true }).click();
  await expect(trigger(page)).toHaveText(`${S.delayControlTriggerLabel} · 40 ${S.delayMinutesSuffix}`);
});
