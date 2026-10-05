import { expect, test } from "@playwright/test";
import {
  DARK_SURFACE_MD_ONLY_BUTTON_DEMOS,
  DARK_SURFACE_SM_BUTTON_DEMOS,
  galleryStrings,
  LIGHT_SURFACE_MD_ONLY_BUTTON_DEMOS,
  LIGHT_SURFACE_SM_BUTTON_DEMOS,
} from "../src/gallery/strings";

// The dev-only component gallery (?gallery=1, see src/gallery/Gallery.tsx and
// main.tsx's branch before App ever mounts). No seed, no login: every test
// here starts from a bare navigation.

test.beforeEach(async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
});

const ALL_BUTTON_DEMOS = [
  ...LIGHT_SURFACE_SM_BUTTON_DEMOS,
  ...LIGHT_SURFACE_MD_ONLY_BUTTON_DEMOS,
  ...DARK_SURFACE_SM_BUTTON_DEMOS,
  ...DARK_SURFACE_MD_ONLY_BUTTON_DEMOS,
];

test("every button variant is visible by its accessible name", async ({ page }) => {
  for (const { label } of ALL_BUTTON_DEMOS) {
    await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  }
});

test("a disabled button in the gallery is actually disabled", async ({ page }) => {
  // Render order within a variant's row is size [md, sm] x state [enabled,
  // disabled] (ButtonsSection.tsx's SmCapableButtonRow) — index 1 is always
  // the md disabled instance.
  const { label } = LIGHT_SURFACE_SM_BUTTON_DEMOS[0];
  const buttons = page.getByRole("button", { name: label });
  await expect(buttons.nth(0)).toBeEnabled();
  await expect(buttons.nth(1)).toBeDisabled();
});

test("a click handler fires exactly once on an enabled button", async ({ page }) => {
  const { label } = LIGHT_SURFACE_SM_BUTTON_DEMOS[0]; // primary — wired to the counter
  await expect(page.getByText(`${galleryStrings.clickCounterLabel}: 0`)).toBeVisible();
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.getByText(`${galleryStrings.clickCounterLabel}: 1`)).toBeVisible();
});

test("an outline button's touch target reaches 40px even though its box is shorter", async ({ page }) => {
  // outline (.set-row .edit) has no sm and no min-height: its visible box
  // is the reference's own compact padding/font-size, well under 40px.
  // Button.tsx compensates with an invisible ::after, h-10, centered on the
  // button's own box regardless of that box's height — so a point just
  // outside the visible edge, but still within 20px of the button's
  // vertical center, must still hit the button.
  const { label } = LIGHT_SURFACE_MD_ONLY_BUTTON_DEMOS[0];
  const button = page.getByRole("button", { name: label }).first();
  const box = await button.boundingBox();
  if (!box) {
    throw new Error("expected the outline button to have a bounding box");
  }
  // Sanity check: the premise only holds if the real box is well under the
  // 40px band the ::after centers within (half-height 20px either side).
  expect(box.height).toBeLessThan(38);

  const x = box.x + box.width / 2;
  // 1px inside the 40px band's top edge, derived from the live box rather
  // than a guessed constant — see the expect() above for why this is
  // guaranteed to fall outside the visible box too.
  const y = box.y + box.height / 2 - 19;

  const handle = await button.elementHandle();
  const hitTargetIsTheButton = await page.evaluate(
    ({ x, y, handle }) => document.elementFromPoint(x, y) === handle,
    { x, y, handle },
  );
  expect(hitTargetIsTheButton).toBe(true);
});
