import { expect, test, type Page } from "@playwright/test";
import { addDaysToClinicDay, todayInCairo } from "../src/domain/time";
import { bookFirstOpenSlot, gotoRealDay, OWNER_NAME, OWNER_PIN, pickSearchResult, PATIENTS, QUEUE_DR, rowFor, S, selectPractitioner, setTimeField, sidebar, SIDEBAR, SLOTS_DR } from "./support";

// Settings → working hours → "إجازات ومواعيد استثنائية" (owner): a closed
// date or a date's own hours, and what the day screen does with them. On
// the real today, so the exception's date is the day on screen.

async function openExceptions(page: Page) {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = page.getByRole("dialog");
  await expect(settings.getByRole("button", { name: S.settingsHoursTab, exact: true })).toHaveAttribute("aria-pressed", "true");
  return settings.getByRole("region", { name: S.exceptionsHeading, exact: true });
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

const slotTimes = (page: Page) => page.locator("button[data-slot-time]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-slot-time")));

test.beforeEach(async ({ page }) => {
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
});

test("closing a day with a booking lists it and asks first; the booking stays, flagged outside working hours, until the closure is removed", async ({ page }) => {
  await bookFirstOpenSlot(page, PATIENTS.mona);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
  const freeBefore = (await slotTimes(page)).length;
  expect(freeBefore).toBeGreaterThan(0);

  const section = await openExceptions(page);
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(todayInCairo());
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  const confirm = section.getByRole("alert");
  await expect(confirm).toContainText(S.exceptionClosureHasVisits(1));
  await expect(confirm).toContainText(PATIENTS.mona);
  await confirm.getByRole("button", { name: S.exceptionConfirmClosure, exact: true }).click();
  await expect(section.getByRole("listitem").filter({ hasText: todayInCairo() })).toContainText(S.exceptionClosedLabel);
  await closeSettings(page);

  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.outsideHoursRowBadge);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
  expect(await slotTimes(page)).toEqual([]);

  const again = await openExceptions(page);
  await again.getByRole("listitem").filter({ hasText: todayInCairo() }).getByRole("button", { name: S.exceptionDeleteAction, exact: true }).click();
  await expect(again.getByText(S.exceptionsEmpty)).toBeVisible();
  await closeSettings(page);

  await expect(rowFor(page, PATIENTS.mona)).not.toContainText(S.outsideHoursRowBadge);
  await expect.poll(async () => (await slotTimes(page)).length).toBe(freeBefore);
});

test("a day's own hours leave only their slots to book", async ({ page }) => {
  const section = await openExceptions(page);
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(todayInCairo());
  await section.getByRole("button", { name: S.exceptionKindHours, exact: true }).click();
  await setTimeField(section, S.hoursStartLabel, "10:00");
  await setTimeField(section, S.hoursEndLabel, "11:00");
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await expect(section.getByRole("listitem").filter({ hasText: todayInCairo() })).toContainText(S.exceptionHoursLabel);
  await closeSettings(page);

  await expect.poll(() => slotTimes(page)).toEqual(["10:00", "10:30"]);
});

test("a past date and a second exception on one date are refused with a line", async ({ page }) => {
  const section = await openExceptions(page);
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill("2020-01-01");
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await expect(section.getByText(S.exceptionPastDateError)).toBeVisible();

  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(todayInCairo());
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await expect(section.getByRole("listitem").filter({ hasText: todayInCairo() })).toBeVisible();
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(todayInCairo());
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await expect(section.getByText(S.exceptionExistsError)).toBeVisible();
});

test("a closed queue day keeps its waiting patient, flagged, with nothing more to add", async ({ page }) => {
  await selectPractitioner(page, QUEUE_DR);
  await page.getByRole("button", { name: S.walkInButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.karim);
  await pickSearchResult(dialog, PATIENTS.karim);
  await dialog.getByRole("button", { name: S.addToQueueConfirmButton, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rowFor(page, PATIENTS.karim)).toHaveAttribute("data-visit-status", "arrived");

  const section = await openExceptions(page);
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(todayInCairo());
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await expect(section.getByRole("alert")).toContainText(PATIENTS.karim);
  await section.getByRole("button", { name: S.exceptionConfirmClosure, exact: true }).click();
  await expect(section.getByRole("listitem").filter({ hasText: todayInCairo() })).toBeVisible();
  await closeSettings(page);

  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.outsideHoursRowBadge);
  await expect(page.getByRole("button", { name: S.walkInButtonLabel, exact: true })).toHaveCount(0);
});

// A closure's optional reason ("سبب الإجازة", docs/schema.md's v27 additions).

test("a closure's reason shows under it in settings and on the closed day's line, over the booking it keeps", async ({ page }) => {
  await bookFirstOpenSlot(page, PATIENTS.mona);
  const section = await openExceptions(page);
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(todayInCairo());
  await section.getByLabel(S.exceptionReasonLabel, { exact: true }).fill("  مؤتمر طبي  ");
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await section.getByRole("alert").getByRole("button", { name: S.exceptionConfirmClosure, exact: true }).click();
  const listed = section.getByRole("listitem").filter({ hasText: todayInCairo() });
  await expect(listed).toContainText(S.exceptionClosedLabel);
  await expect(listed).toContainText(`${S.closureReasonPrefix} مؤتمر طبي`);
  // The form is cleared for the next one.
  await expect(section.getByLabel(S.exceptionReasonLabel, { exact: true })).toHaveValue("");
  await closeSettings(page);

  const note = page.locator("[data-closed-day-note]");
  await expect(note).toContainText(S.dayClosedByException);
  await expect(note).toContainText(`${S.closureReasonPrefix} مؤتمر طبي`);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.outsideHoursRowBadge);
});

test("a closed day with nothing booked shows its reason under the closed line; a date's own hours take no reason", async ({ page }) => {
  const section = await openExceptions(page);
  await section.getByRole("button", { name: S.exceptionKindHours, exact: true }).click();
  await expect(section.getByLabel(S.exceptionReasonLabel, { exact: true })).toHaveCount(0);
  await section.getByRole("button", { name: S.exceptionKindClosed, exact: true }).click();

  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(todayInCairo());
  await section.getByLabel(S.exceptionReasonLabel, { exact: true }).fill("إجازة سنوية");
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await expect(section.getByRole("listitem").filter({ hasText: todayInCairo() })).toContainText(`${S.closureReasonPrefix} إجازة سنوية`);
  await closeSettings(page);

  await expect(page.getByText(S.dayClosedByException, { exact: true })).toBeVisible();
  await expect(page.getByText(`${S.closureReasonPrefix} إجازة سنوية`, { exact: true })).toBeVisible();
});

test("tomorrow's sheet says tomorrow is closed, with its reason, on screen and on paper", async ({ page }) => {
  // The sheet calls window.print() when asked; the page under test must not open the dialog.
  await page.evaluate(() => {
    window.print = () => {};
  });
  const tomorrow = addDaysToClinicDay(todayInCairo(), 1);
  const section = await openExceptions(page);
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(tomorrow);
  await section.getByLabel(S.exceptionReasonLabel, { exact: true }).fill("سفر");
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  await expect(section.getByRole("listitem").filter({ hasText: tomorrow })).toContainText(`${S.closureReasonPrefix} سفر`);
  await closeSettings(page);

  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  const onScreen = dialog.locator("[data-closed-day-note]");
  await expect(onScreen).toContainText(S.daySheetClosedLine);
  await expect(onScreen).toContainText(`${S.closureReasonPrefix} سفر`);

  await dialog.getByRole("button", { name: S.printDaySheetAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await expect(page.locator("[data-closed-day-note]").filter({ visible: true })).toContainText(`${S.closureReasonPrefix} سفر`);
  await page.emulateMedia({ media: null });
});
