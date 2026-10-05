import { expect, test, type Locator } from "@playwright/test";
import {
  ALL_BADGE_DEMO_LABELS,
  cardGalleryStrings,
  DARK_SURFACE_MD_ONLY_BUTTON_DEMOS,
  DARK_SURFACE_SM_BUTTON_DEMOS,
  fieldGalleryStrings,
  galleryStrings,
  LIGHT_SURFACE_MD_ONLY_BUTTON_DEMOS,
  LIGHT_SURFACE_SM_BUTTON_DEMOS,
  sheetPanelGalleryStrings,
  toggleChipGalleryStrings,
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

test("a field's label is associated with its control", async ({ page }) => {
  const filledSearch = page.getByLabel(fieldGalleryStrings.searchLabel).nth(2);
  await expect(filledSearch).toHaveValue(fieldGalleryStrings.searchFilledValue);
});

test("typing into an empty field switches it to filled styling", async ({ page }) => {
  // font-bold is unique to the filled look (`.field .in.filled`'s own
  // font-weight:700) — unlike border-green, it never appears as a
  // focus:/aria-invalid: prefixed variant elsewhere in the base classes.
  const input = page.getByLabel(fieldGalleryStrings.searchLabel).first();
  await expect(input).not.toHaveClass(/\bfont-bold\b/);
  await input.fill(fieldGalleryStrings.searchFilledValue);
  await expect(input).toHaveClass(/\bfont-bold\b/);
});

test("an invalid field exposes aria-invalid and its error message", async ({ page }) => {
  const input = page.getByLabel(fieldGalleryStrings.phoneLabel);
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const describedById = await input.getAttribute("aria-describedby");
  if (!describedById) {
    throw new Error("expected the invalid field to have aria-describedby set");
  }
  await expect(page.locator(`#${describedById}`)).toHaveText(fieldGalleryStrings.phoneError);
});

test("the day card's head renders a real, correctly-leveled heading", async ({ page }) => {
  await expect(page.getByRole("heading", { name: cardGalleryStrings.dayCardTitle, level: 3 })).toBeVisible();
});

test("the day card's footer buttons and count are reachable", async ({ page }) => {
  // Both labels are reused from the Buttons section's own primary/secondary
  // demos (same prototype source) — disambiguated as the last match, since
  // the card renders after that section in the page.
  await expect(page.getByRole("button", { name: cardGalleryStrings.dayCardPrimaryAction }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: cardGalleryStrings.dayCardSecondaryAction }).last()).toBeVisible();
  await expect(
    page.getByText(
      `${cardGalleryStrings.dayCardCountAppointments} ${cardGalleryStrings.dayCardCountAppointmentsLabel}`,
      { exact: false },
    ),
  ).toBeVisible();
});

test("every badge demo is visible by its text", async ({ page }) => {
  for (const label of ALL_BADGE_DEMO_LABELS) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});

// Each group's own accessible name — ToggleGroup's required `label` prop.
// "services" is reused by both ToggleChipSection and SheetPanelSection (the
// same prototype field shown a second time), so it resolves to two groups.
const TOGGLE_GROUP_NAMES = [
  toggleChipGalleryStrings.servicesHeading,
  toggleChipGalleryStrings.filtersHeading,
  toggleChipGalleryStrings.tabsHeading,
  toggleChipGalleryStrings.patientTabsHeading,
  toggleChipGalleryStrings.channelHeading,
];

test("clicking a chip in each named toggle group moves aria-pressed to it and off the previous one", async ({ page }) => {
  const groups: Locator[] = [];
  for (const name of TOGGLE_GROUP_NAMES) {
    groups.push(...(await page.getByRole("group", { name }).all()));
  }
  expect(groups.length).toBeGreaterThanOrEqual(TOGGLE_GROUP_NAMES.length);

  for (const group of groups) {
    const chips = group.getByRole("button");
    const first = chips.first();
    const second = chips.nth(1);

    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(second).toHaveAttribute("aria-pressed", "false");

    await second.click();

    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(first).toHaveAttribute("aria-pressed", "false");
  }
});

test("the sheet panel's heading is present and its close button fires onClose once", async ({ page }) => {
  await expect(page.getByRole("heading", { name: sheetPanelGalleryStrings.title })).toBeVisible();

  await expect(page.getByText(`${sheetPanelGalleryStrings.closeLabel}: 0`)).toBeVisible();
  await page.getByRole("button", { name: sheetPanelGalleryStrings.closeLabel }).click();
  await expect(page.getByText(`${sheetPanelGalleryStrings.closeLabel}: 1`)).toBeVisible();
});
