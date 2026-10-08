import { expect, test } from "@playwright/test";
import {
  gotoRealDay,
  gotoSeededDay,
  openBookingSheet,
  PATIENTS,
  pickSearchResult,
  QUEUE_DR,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
} from "./support";

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

test("exporting CSV downloads a header row plus one row per invoice issued today here", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);

  // Book, then complete, a fresh visit so today has one invoice to export.
  await openBookingSheet(page);
  const bookingDialog = page.getByRole("dialog");
  await bookingDialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await pickSearchResult(bookingDialog, PATIENTS.mona);
  await bookingDialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await bookingDialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.visitBooked)).toBeVisible();

  const monaRow = rowFor(page, PATIENTS.mona);
  await monaRow.locator("button").filter({ hasText: PATIENTS.mona }).click(); // booked -> arrived
  await monaRow.locator("button").filter({ hasText: PATIENTS.mona }).click(); // arrived -> in_room
  await monaRow.locator("button").filter({ hasText: PATIENTS.mona }).click(); // in_room -> completed
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();

  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: S.cashCloseExportCsvAction, exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^clintra-\d{4}-\d{2}-\d{2}\.csv$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const content = Buffer.concat(chunks).toString("utf-8").replace(/^﻿/, "");
  const lines = content.split("\r\n");
  expect(lines[0]).toBe("التاريخ,المريض,الخدمة,المبلغ,حالة الدفع");
  expect(lines[1]).toContain(PATIENTS.mona);
  expect(lines[1]).toContain(S.invoiceStatusUnpaid);
});

test("the CSV export stays available, at full strength, once the day is closed", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("0");
  await confirmButton(dialog).click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  await expect(dialog).toBeHidden();

  await openCashClose(page);
  const closedDialog = page.getByRole("dialog");
  await expect(closedDialog.getByText(S.cashCloseClosedAtLabel)).toBeVisible();
  const exportButton = closedDialog.getByRole("button", { name: S.cashCloseExportCsvAction, exact: true });
  await expect(exportButton).toBeEnabled();
  await expect(exportButton).toHaveCSS("opacity", "1");
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^clintra-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("a past-due queue visit is labelled by its queue number", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  const hodaRow = dialog.getByRole("listitem").filter({ hasText: PATIENTS.hoda });
  await expect(hodaRow).toContainText(new RegExp(`${S.cashClosePastDueQueueNumberPrefix} [0-9]+`));
  const monaRow = dialog.getByRole("listitem").filter({ hasText: PATIENTS.mona });
  await expect(monaRow).toContainText(/\d{2}:\d{2}/);
});

test("on a narrow viewport a tall sheet's close button is fully visible and not covered by the app bar", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "the app bar only wraps to two rows on the mobile project");
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.cashClosePastDueSectionTitle)).toBeVisible();
  // Tall: the panel's content overflows, so it is capped and scrolls internally.
  expect(await dialog.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  const closeButton = dialog.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).first();
  const box = await closeButton.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

  // The button must be the topmost element at its own centre — and, since
  // the old geometry left that centre a fraction of a pixel below the
  // wrapped app bar while the button's upper half sat under it, also just
  // inside its top edge.
  const uncoveredAt = await closeButton.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const isOwn = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === el || el.contains(hit));
    };
    const midX = rect.x + rect.width / 2;
    return { centre: isOwn(midX, rect.y + rect.height / 2), topEdge: isOwn(midX, rect.y + 2) };
  });
  expect(uncoveredAt).toEqual({ centre: true, topEdge: true });
});
