import { expect, test } from "@playwright/test";
import { gotoSeededDay, OWNER_NAME, OWNER_PIN, PATIENTS, rowFor, S, SIDEBAR, selectPractitioner, SLOTS_DR } from "./support";

// The owner, not the default assistant: settings only ever renders live for
// an owner (unchanged from before this task — see settings.spec.ts), and
// this file's whole point is to exercise the sidebar's two live items.
test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
});

function sidebar(page: import("@playwright/test").Page) {
  return page.getByRole("navigation", { name: SIDEBAR.navAriaLabel });
}

test("the sidebar renders on every route", async ({ page }) => {
  const nav = sidebar(page);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: SIDEBAR.navDay, exact: true })).toBeVisible();

  // Not a second page — AppShell always wraps DayScreen; opening settings
  // just overlays a sheet on top of it, and the sidebar stays put underneath.
  await nav.getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.settingsHoursTab)).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: SIDEBAR.navDay, exact: true })).toBeVisible();
});

test("the active sidebar item reflects whether settings is open", async ({ page }) => {
  const nav = sidebar(page);
  const dayItem = nav.getByRole("button", { name: SIDEBAR.navDay, exact: true });
  const settingsItem = nav.getByRole("button", { name: SIDEBAR.navSettings, exact: true });

  await expect(dayItem).toHaveAttribute("aria-current", "page");
  await expect(settingsItem).not.toHaveAttribute("aria-current", "page");

  await settingsItem.click();
  await expect(page.getByRole("dialog").getByText(S.settingsHoursTab)).toBeVisible();
  await expect(settingsItem).toHaveAttribute("aria-current", "page");
  await expect(dayItem).not.toHaveAttribute("aria-current", "page");

  // Tapping "اليوم" while settings is open returns to the day view.
  await dayItem.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(dayItem).toHaveAttribute("aria-current", "page");
});

test("only اليوم and الإعدادات are tappable; the other four show the جاي قريب hint and do not navigate", async ({ page }) => {
  const nav = sidebar(page);
  await expect(nav.getByRole("button", { name: SIDEBAR.navDay, exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: SIDEBAR.navSettings, exact: true })).toBeVisible();

  const disabledLabels = [SIDEBAR.navPatients, SIDEBAR.navQueue, SIDEBAR.navInvoices, SIDEBAR.navReports];
  for (const label of disabledLabels) {
    // Present as text, but not as a button — nothing to tap, nothing to navigate to.
    await expect(nav.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    await expect(nav.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(nav.getByText(SIDEBAR.comingSoonHint)).toHaveCount(disabledLabels.length);

  // Clicking where a disabled item sits does nothing observable: still on
  // the day view, no dialog opened.
  await nav.getByText(SIDEBAR.navQueue, { exact: true }).click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the day grid renders as a 3-column layout: the first three slots share one row", async ({ page }) => {
  const tiles = page.getByRole("listitem");
  const count = await tiles.count();
  expect(count).toBeGreaterThanOrEqual(3);

  const [first, second, third] = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox(), tiles.nth(2).boundingBox()]);
  if (!first || !second || !third) {
    throw new Error("expected the first three grid tiles to each have a bounding box");
  }
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
  expect(Math.abs(second.y - third.y)).toBeLessThan(2);
  // And a 4th tile (if the grid has one) wraps to a new row, proving this is
  // genuinely a 3-column grid and not a very wide single row.
  if (count >= 4) {
    const fourth = await tiles.nth(3).boundingBox();
    if (!fourth) throw new Error("expected a 4th grid tile to have a bounding box");
    expect(fourth.y).toBeGreaterThan(first.y + 2);
  }
});
