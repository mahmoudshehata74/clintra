import { expect, test } from "@playwright/test";
import { expectControlsHitTest, expectInsideViewport } from "./interaction";
import { gotoSeededDay, PATIENTS, QUEUE_DR, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

// A row's ⋯ menu opens fully on screen, every item reachable — for every
// row of both seeded days. Before it was a portal, منى's menu (the first
// slot, low on a 1280×800 window) ran past the bottom of the window.
for (const practitioner of [SLOTS_DR, QUEUE_DR]) {
  test(`every row menu of ${practitioner}'s day opens inside the viewport`, async ({ page }) => {
    await gotoSeededDay(page);
    await selectPractitioner(page, practitioner);
    await expect(page.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).first()).toBeVisible();
    let opened = 0;
    for (const name of Object.values(PATIENTS)) {
      const row = rowFor(page, name);
      if ((await row.count()) === 0) {
        continue;
      }
      await row.first().getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expectInsideViewport(menu, `${name}'s menu`);
      await expectControlsHitTest(menu);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      opened++;
    }
    expect(opened).toBeGreaterThan(0);
  });
}
