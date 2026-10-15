import { expect, test, type Locator, type Page } from "@playwright/test";
import { APPEARANCE_MIRROR_KEY, appearanceAccessibleName, type Appearance } from "../src/domain/appearance";
import { ASSISTANT_NAME, DEV_SEED_PINS, gotoSeededDay, lockOverlay, login, readStore, S, selectPractitioner, SLOTS_DR } from "./support";

// The no-flash checks hold the app's own scripts back (page.route below); the
// service worker would serve them from its cache around the route.
test.use({ serviceWorkers: "block" });

// index.css's --color-paper and --color-rule in each theme, as computed colours.
const LIGHT_PAPER = "rgb(239, 243, 241)";
const DARK_PAPER = "rgb(8, 19, 17)";
const LIGHT_RULE = "rgb(217, 224, 221)";
const DARK_RULE = "rgb(34, 51, 46)";

const appBarToggle = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^المظهر: / });

async function expectAppearance(toggle: Locator, appearance: Appearance): Promise<void> {
  await expect(toggle).toHaveAccessibleName(appearanceAccessibleName(appearance));
}

async function themeAttribute(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

async function pageBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * Reloads with the app's scripts held back, so only index.html's inline
 * script and the stylesheet have run: what the first paint shows. Then lets
 * the app load again.
 */
async function firstPaint(page: Page): Promise<{ theme: string | null; background: string }> {
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.reload();
  const result = { theme: await themeAttribute(page), background: await pageBackground(page) };
  await page.unroute("**/assets/*.js");
  return result;
}

test("auto follows a dark system: no data-theme, the dark tokens and color-scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoSeededDay(page);

  await expectAppearance(appBarToggle(page), "auto");
  expect(await themeAttribute(page)).toBeNull();
  expect(await pageBackground(page)).toBe(DARK_PAPER);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");

  // The same auto on a light system is light.
  await page.emulateMedia({ colorScheme: "light" });
  expect(await pageBackground(page)).toBe(LIGHT_PAPER);
});

test("explicit light over a dark system, kept across a reload and painted light first", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoSeededDay(page);

  await appBarToggle(page).click();
  await expectAppearance(appBarToggle(page), "light");
  expect(await themeAttribute(page)).toBe("light");
  expect(await pageBackground(page)).toBe(LIGHT_PAPER);

  const paint = await firstPaint(page);
  expect(paint).toEqual({ theme: "light", background: LIGHT_PAPER });

  await page.reload();
  await login(page);
  await expectAppearance(appBarToggle(page), "light");
  expect(await pageBackground(page)).toBe(LIGHT_PAPER);
});

test("explicit dark over a light system, kept across a reload and painted dark first", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await gotoSeededDay(page);

  await appBarToggle(page).click();
  await appBarToggle(page).click();
  await expectAppearance(appBarToggle(page), "dark");
  expect(await themeAttribute(page)).toBe("dark");
  expect(await pageBackground(page)).toBe(DARK_PAPER);

  const paint = await firstPaint(page);
  expect(paint).toEqual({ theme: "dark", background: DARK_PAPER });

  await page.reload();
  await login(page);
  await expectAppearance(appBarToggle(page), "dark");
  expect(await pageBackground(page)).toBe(DARK_PAPER);
});

test("the choice is stored on the device only: a local preference, its mirror, no sync op", async ({ page }) => {
  await gotoSeededDay(page);
  await appBarToggle(page).click();
  await appBarToggle(page).click();
  await expectAppearance(appBarToggle(page), "dark");

  await expect
    .poll(() => readStore<{ key: string; value: string }>(page, "preferences"))
    .toEqual([{ key: "appearance", value: "dark" }]);
  expect(await page.evaluate((key) => localStorage.getItem(key), APPEARANCE_MIRROR_KEY)).toBe("dark");
  const ops = await readStore<{ entity: string }>(page, "sync_ops");
  expect(ops.filter((op) => op.entity === "preferences")).toEqual([]);

  // A third tap goes back to auto, which clears data-theme.
  await appBarToggle(page).click();
  await expectAppearance(appBarToggle(page), "auto");
  expect(await themeAttribute(page)).toBeNull();
  await expect
    .poll(() => readStore<{ key: string; value: string }>(page, "preferences"))
    .toEqual([{ key: "appearance", value: "auto" }]);
});

test("the lock screen carries the toggle, and the app bar takes its choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?seedDay=1");
  const overlay = lockOverlay(page);
  const lockToggle = overlay.getByRole("button", { name: /^المظهر: / });

  await expectAppearance(lockToggle, "auto");
  await lockToggle.click();
  await lockToggle.click();
  await expectAppearance(lockToggle, "dark");
  expect(await pageBackground(page)).toBe(DARK_PAPER);
  // The overlay is the page's own paper.
  await expect(overlay).toHaveCSS("background-image", /rgb\(11, 24, 21\)/);

  await overlay.getByRole("button", { name: new RegExp(ASSISTANT_NAME) }).click();
  for (const digit of DEV_SEED_PINS.assistant) {
    await overlay.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(overlay).toBeHidden();
  await expectAppearance(appBarToggle(page), "dark");
});

test("from sm up the toggle shows its label beside the icon; below, the icon alone", async ({ page }) => {
  await gotoSeededDay(page);
  const label = appBarToggle(page).getByText("تلقائي", { exact: true });
  const width = page.viewportSize()!.width;
  if (width >= 640) {
    await expect(label).toBeVisible();
  } else {
    await expect(label).toBeHidden();
  }
});

test("a printed page takes the light tokens while the app is dark", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoSeededDay(page);
  await appBarToggle(page).click();
  await appBarToggle(page).click();
  await expectAppearance(appBarToggle(page), "dark");
  await selectPractitioner(page, SLOTS_DR);

  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  // On screen the preview card sits on the dark theme's rule.
  const previewPage = dialog.getByText(`✎ ${S.printHeaderPlaceholder}`, { exact: true }).locator("..");
  await expect(previewPage).toHaveCSS("border-top-color", DARK_RULE);

  await dialog.getByRole("button", { name: S.printDaySheetAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  const printed = page.getByText(S.printHeaderWarning).locator("..");
  await expect(printed).toBeVisible();
  await expect(printed).toHaveCSS("border-top-color", LIGHT_RULE);
  expect(await pageBackground(page)).toBe(LIGHT_PAPER);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  expect(await themeAttribute(page)).toBe("dark");

  await page.emulateMedia({ media: null });
  expect(await pageBackground(page)).toBe(DARK_PAPER);
});
