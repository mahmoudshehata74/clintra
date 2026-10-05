import { expect, test } from "@playwright/test";
import { DARK_SURFACE_BUTTON_DEMOS, galleryStrings, LIGHT_SURFACE_BUTTON_DEMOS } from "../src/gallery/strings";

// The dev-only component gallery (?gallery=1, see src/gallery/Gallery.tsx and
// main.tsx's branch before App ever mounts). No seed, no login: every test
// here starts from a bare navigation.

test.beforeEach(async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
});

const ALL_BUTTON_DEMOS = [...LIGHT_SURFACE_BUTTON_DEMOS, ...DARK_SURFACE_BUTTON_DEMOS];

test("every button variant is visible by its accessible name", async ({ page }) => {
  for (const { label } of ALL_BUTTON_DEMOS) {
    await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  }
});

test("a disabled button in the gallery is actually disabled", async ({ page }) => {
  // Render order within a variant's row is size [md, sm] x state [enabled,
  // disabled] (ButtonsSection.tsx's ButtonRow) — index 1 is always the md
  // disabled instance.
  const { label } = LIGHT_SURFACE_BUTTON_DEMOS[0];
  const buttons = page.getByRole("button", { name: label });
  await expect(buttons.nth(0)).toBeEnabled();
  await expect(buttons.nth(1)).toBeDisabled();
});

test("a click handler fires exactly once on an enabled button", async ({ page }) => {
  const { label } = LIGHT_SURFACE_BUTTON_DEMOS[0]; // primary — wired to the counter
  await expect(page.getByText(`${galleryStrings.clickCounterLabel}: 0`)).toBeVisible();
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.getByText(`${galleryStrings.clickCounterLabel}: 1`)).toBeVisible();
});
