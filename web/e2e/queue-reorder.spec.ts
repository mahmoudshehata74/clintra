import { expect, test, type Page } from "@playwright/test";
import { gotoSeededDay, OWNER_NAME, OWNER_PIN, PATIENTS, QUEUE_DR, rowFor, S, selectPractitioner } from "./support";

// Queue reordering (domain/queueReorder.ts, screen 3's "إعادة ترتيب"): the
// waiting visits of the seeded queue day move up and down with two icon
// buttons per row. On that day ياسمين is in the room, عمر has arrived and
// هدى is booked; هدى is marked arrived first, so two visits wait.

const moveUp = (page: Page, name: string) => page.getByRole("button", { name: S.queueMoveUpLabel(name), exact: true });
const moveDown = (page: Page, name: string) => page.getByRole("button", { name: S.queueMoveDownLabel(name), exact: true });

/** The queue's patient names, top to bottom. */
async function queueOrder(page: Page): Promise<string[]> {
  const names = Object.values(PATIENTS);
  const rows = await page.locator("li[data-visit-row-id]").allInnerTexts();
  return rows.map((text) => names.find((name) => text.includes(name)) ?? "?");
}

async function twoWaiting(page: Page) {
  await selectPractitioner(page, QUEUE_DR);
  const hoda = rowFor(page, PATIENTS.hoda);
  await hoda.locator("button").filter({ hasText: PATIENTS.hoda }).click();
  await expect(hoda).toHaveAttribute("data-visit-status", "arrived");
}

test("the assistant moves a waiting visit down and back up; nobody else moves", async ({ page }) => {
  await gotoSeededDay(page);
  await twoWaiting(page);
  const before = await queueOrder(page);
  const omarAt = before.indexOf(PATIENTS.omar);
  expect(before[omarAt + 1]).toBe(PATIENTS.hoda);

  // The first waiting visit cannot go up, the last cannot go down; rows not waiting have no buttons.
  await expect(moveUp(page, PATIENTS.omar)).toBeDisabled();
  await expect(moveDown(page, PATIENTS.hoda)).toBeDisabled();
  await expect(moveUp(page, PATIENTS.yasmin)).toHaveCount(0);

  await moveDown(page, PATIENTS.omar).click();
  const swapped = [...before];
  [swapped[omarAt], swapped[omarAt + 1]] = [swapped[omarAt + 1], swapped[omarAt]];
  await expect.poll(() => queueOrder(page)).toEqual(swapped);
  // Each keeps its status; the positions shown are the two they held between them.
  await expect(rowFor(page, PATIENTS.hoda)).toHaveAttribute("data-visit-status", "arrived");
  await expect(rowFor(page, PATIENTS.omar)).toHaveAttribute("data-visit-status", "arrived");
  await expect(moveUp(page, PATIENTS.hoda)).toBeDisabled();
  await expect(moveDown(page, PATIENTS.omar)).toBeDisabled();

  await moveUp(page, PATIENTS.omar).click();
  await expect.poll(() => queueOrder(page)).toEqual(before);
});

test("the owner reorders too", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await twoWaiting(page);
  await moveUp(page, PATIENTS.hoda).click();
  await expect
    .poll(async () => {
      const order = await queueOrder(page);
      return order.indexOf(PATIENTS.hoda) === order.indexOf(PATIENTS.omar) - 1;
    })
    .toBe(true);
});
