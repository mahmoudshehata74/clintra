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

test("the active rail item's colour and border actually differ from an inactive one", async ({ page }) => {
  const nav = sidebar(page);
  const dayItem = nav.getByRole("button", { name: SIDEBAR.navDay, exact: true });
  const settingsItem = nav.getByRole("button", { name: SIDEBAR.navSettings, exact: true });

  // "اليوم" is active, "الإعدادات" is not — ITEM_BASE/ITEM_ACTIVE used to
  // both set text/border colour, leaving the winner up to Tailwind's
  // generated-sheet order rather than isActive (AppShell.tsx).
  const [activeColor, activeBorder, inactiveColor, inactiveBorder] = await Promise.all([
    dayItem.evaluate((el) => getComputedStyle(el).color),
    dayItem.evaluate((el) => getComputedStyle(el).borderColor),
    settingsItem.evaluate((el) => getComputedStyle(el).color),
    settingsItem.evaluate((el) => getComputedStyle(el).borderColor),
  ]);
  expect(activeColor).not.toBe(inactiveColor);
  expect(activeBorder).not.toBe(inactiveBorder);
});

test("the four placeholder sections are gone; only اليوم, السجل and الإعدادات exist", async ({ page }) => {
  const nav = sidebar(page);
  await expect(nav.getByRole("button", { name: SIDEBAR.navDay, exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: SIDEBAR.navAudit, exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: SIDEBAR.navSettings, exact: true })).toBeVisible();

  // Removed from the nav model entirely — not disabled, not present as text.
  for (const label of ["المرضى", "الطابور", "الفواتير", "التقارير"]) {
    await expect(nav.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(nav.getByText("جاي قريب")).toHaveCount(0);
});

test("an assistant sees the audit log but no settings item", async ({ page }) => {
  await gotoSeededDay(page); // assistant by default
  await selectPractitioner(page, SLOTS_DR);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);

  const nav = sidebar(page);
  await expect(nav.getByRole("button", { name: SIDEBAR.navDay, exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: SIDEBAR.navAudit, exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: SIDEBAR.navSettings, exact: true })).toHaveCount(0);
});

test("the day grid renders as the prototype's single-column row list, not the old 3-column tile grid", async ({ page }) => {
  // COMMIT 3 replaces the 3-column tile grid with the prototype's `.slot`
  // row list (one row per line, PractitionerColumn.tsx) — the opposite
  // layout claim this test made before that task.
  const rows = page.getByRole("listitem");
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(3);

  const [first, second, third] = await Promise.all([
    rows.nth(0).boundingBox(),
    rows.nth(1).boundingBox(),
    rows.nth(2).boundingBox(),
  ]);
  if (!first || !second || !third) {
    throw new Error("expected the first three rows to each have a bounding box");
  }
  // Each row sits below the previous one, never side by side.
  expect(second.y).toBeGreaterThan(first.y + first.height - 2);
  expect(third.y).toBeGreaterThan(second.y + second.height - 2);
});
