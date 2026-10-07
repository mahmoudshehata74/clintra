import { expect, test } from "@playwright/test";
import { gotoRealDay, gotoSeededDay, PATIENTS, QUEUE_DR, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

// The seeded day (?seedDay=1) is always a past Monday relative to the real
// current day (see support.ts's SEEDED_DAY), so every still-booked seeded
// visit is unconditionally past due the moment the sheet opens — no clock
// manipulation needed. Both the slots practitioner (منى: booked) and the
// queue practitioner (هدى: booked) share the single seeded location, so the
// cash-close sheet — scoped to the location, not one practitioner — lists
// both regardless of which practitioner is selected on screen.
test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
});

function openCashClose(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
}

/** The primary confirm action — "إغلاق" is also the sheet's own close-button aria-label, so `.last()` (the footer, after the header) disambiguates. */
function confirmButton(dialog: import("@playwright/test").Locator) {
  return dialog.getByRole("button", { name: S.cashCloseConfirmButton, exact: true }).last();
}

test("past-due visits block the day close until settled or acknowledged", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.cashClosePastDueSectionTitle)).toBeVisible();
  await expect(dialog.getByText(PATIENTS.mona)).toBeVisible();
  await expect(dialog.getByText(PATIENTS.hoda)).toBeVisible();

  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("0");
  await confirmButton(dialog).click();
  await expect(dialog.getByText(S.cashClosePastDueBlockedError)).toBeVisible();
  await expect(page.getByText(S.cashCloseToastMessage)).toHaveCount(0);

  // Settling one row leaves the other still blocking the close.
  await dialog
    .getByRole("listitem")
    .filter({ hasText: PATIENTS.mona })
    .getByRole("button", { name: S.cashClosePastDueNoShowAction, exact: true })
    .click();
  await expect(dialog.getByText(PATIENTS.mona)).toHaveCount(0);
  await expect(dialog.getByText(PATIENTS.hoda)).toBeVisible();

  await confirmButton(dialog).click();
  await expect(dialog.getByText(S.cashClosePastDueBlockedError)).toBeVisible();

  // Acknowledging unblocks the close without changing هدى's own visit.
  await dialog.getByText(S.cashClosePastDueAcknowledgeLabel).click();
  await confirmButton(dialog).click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  await expect(dialog).toBeHidden();

  await selectPractitioner(page, QUEUE_DR);
  await expect(rowFor(page, PATIENTS.hoda)).toContainText(S.statusBooked);
});

test("the bulk action empties the past-due list", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.cashClosePastDueSectionTitle)).toBeVisible();

  await dialog.getByRole("button", { name: S.cashClosePastDueBulkAction, exact: true }).click();
  await expect(dialog.getByText(S.cashClosePastDueSectionTitle)).toHaveCount(0);
  await expect(page.getByText(S.cashClosePastDueBulkToastMessage)).toBeVisible();
});

// The real (non-seeded) day starts with no booked visits at all — see
// gotoRealDay's own doc comment — so these run with nothing past due,
// isolating the match/diff banner and the closed-day summary from the
// past-due gate covered above.
test("a matching amount shows the eligible banner; a difference requires a note before closing, then the day shows read-only", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.cashClosePastDueSectionTitle)).toHaveCount(0);

  const collected = dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder);
  // No invoices today yet, so the expected total is zero.
  await collected.fill("0");
  await expect(dialog.getByText(S.cashCloseMatchedTitle)).toBeVisible();

  await collected.fill("5");
  await expect(dialog.getByText(S.cashCloseDifferenceLabel).last()).toBeVisible();
  await confirmButton(dialog).click();
  await expect(dialog.getByText(S.cashCloseNoteRequiredError)).toBeVisible();
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(S.cashCloseNotePlaceholder).fill("زيادة من غير سبب واضح");
  await confirmButton(dialog).click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  await expect(dialog).toBeHidden();

  // Reopening the same location/day now shows the read-only summary, not the form.
  await openCashClose(page);
  const closedDialog = page.getByRole("dialog");
  await expect(closedDialog.getByText(S.cashCloseClosedAtLabel)).toBeVisible();
  await expect(closedDialog.getByText(S.cashCloseClosedByLabel)).toBeVisible();
  await expect(closedDialog.getByPlaceholder(S.cashCloseCollectedPlaceholder)).toHaveCount(0);
});
