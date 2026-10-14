import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { formatWeekdayDayMonth, formatWeekdayFullDate } from "../src/domain/displayDate";
import { todayInCairo } from "../src/domain/time";
import {
  advanceRowTo,
  ASSISTANT_NAME,
  bookFirstOpenSlot,
  gotoRealDay,
  gotoSeededDay,
  invoiceTotals,
  labeledRowValue,
  openBookingSheet,
  parsePounds,
  PATIENTS,
  pickSearchResult,
  QUEUE_DR,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
} from "./support";

// Not imported: the Playwright loader cannot import JSON without an import
// attribute (see support.ts) — the printed footer's version, read the same way.
const APP_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string }).version;

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
  const content = Buffer.concat(chunks).toString("utf-8").replace(/^\uFEFF/, "");
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

/** Counts window.print calls instead of opening the dialog, so the print target stays mounted. Before navigation. */
async function countPrints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counted = window as unknown as { printCalls: number };
    counted.printCalls = 0;
    window.print = () => {
      counted.printCalls += 1;
    };
  });
}
const printCalls = (page: Page) => page.evaluate(() => (window as unknown as { printCalls: number }).printCalls);

/** The printed summary's row value beside a label (DayCloseSummaryPrint.tsx's `.print-tbl`). */
function summaryRow(page: Page, label: string) {
  return page.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) }).getByRole("cell").last();
}

test("the cash close's head and summary cells follow the prototype", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.cashCloseHeadBadge, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: `${S.cashCloseHeadTitlePrefix} ${formatWeekdayDayMonth(todayInCairo())}`, exact: true })).toBeVisible();
  await expect(dialog.getByText(new RegExp(`^\\d{2}:\\d{2} · ${S.cashCloseHeadSubtitleSuffix}$`))).toBeVisible();
  // `.close-cell`: label and value on one line.
  const label = dialog.getByText(S.cashCloseExpectedLabel, { exact: true });
  const value = label.locator("xpath=following-sibling::*[1]");
  const [labelBox, valueBox] = [await label.boundingBox(), await value.boundingBox()];
  expect(Math.abs(labelBox!.y + labelBox!.height - (valueBox!.y + valueBox!.height))).toBeLessThanOrEqual(4);
});

test("closing the day prints its one-page summary with every figure", async ({ page }) => {
  await countPrints(page);
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);

  // One completed visit, paid in full in cash.
  await bookFirstOpenSlot(page, PATIENTS.mona);
  await advanceRowTo(page, PATIENTS.mona, S.statusArrived);
  await advanceRowTo(page, PATIENTS.mona, S.statusInRoom);
  await advanceRowTo(page, PATIENTS.mona, S.statusCompleted);
  await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  const invoice = page.getByRole("dialog");
  const totalText = await labeledRowValue(invoiceTotals(invoice), S.invoiceTotalLabel);
  const total = parsePounds(totalText);
  await invoice.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill(total.toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPaid)).toBeVisible();
  await expect.poll(() => printCalls(page)).toBe(1); // the receipt
  await page.getByRole("dialog").getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill(total.toFixed(2));
  await expect(dialog.getByText(S.cashCloseMatchedTitle)).toBeVisible();
  await confirmButton(dialog).click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  await expect.poll(() => printCalls(page)).toBe(2); // the summary, in the same tap

  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(`${S.cashCloseHeadTitlePrefix} ${formatWeekdayFullDate(todayInCairo())}`, { exact: true })).toBeVisible();
  const amount = `${totalText.replace(/\s*ج\.م$/, "")} ${S.tileCurrencyUnit}`;
  const zero = `0 ${S.tileCurrencyUnit}`;
  for (const [label, expected] of [
    [S.daySummarySeenLabel, "1"],
    [S.slabNoShowCellLabel, "0"],
    [S.daySummaryCancelledLabel, "0"],
    [`${S.daySummaryCollectedByPrefix} ${S.paymentMethodCash}`, amount],
    [`${S.daySummaryCollectedByPrefix} ${S.paymentMethodCard}`, zero],
    [`${S.daySummaryCollectedByPrefix} ${S.paymentMethodWallet}`, zero],
    [`${S.daySummaryCollectedByPrefix} ${S.paymentMethodTransfer}`, zero],
    [S.daySummaryTotalCollectedLabel, amount],
    [S.daySummaryExpectedCashLabel, amount],
    [S.cashCloseActualCashFieldLabel, amount],
    [S.cashCloseDifferenceLabel, `${zero} · ${S.cashCloseNoDifferenceNoteLabel}`],
    [S.daySummaryClosedByLabel, ASSISTANT_NAME],
  ] as const) {
    await expect(summaryRow(page, label)).toHaveText(expected);
  }
  await expect(page.getByText(new RegExp(`^${S.printedAtPrefix} \\d{1,2} \\S+ \\d{2}:\\d{2}$`))).toBeVisible();
  await expect(page.getByText(`Clintra v${APP_VERSION}`, { exact: true })).toBeVisible();
  // One A4 page: its target is laid out on the named page.
  expect(await page.locator(".day-close-print-target").evaluate((el) => getComputedStyle(el).page)).toBe("day-close");
  await page.emulateMedia({ media: null });
});

test("a refused close prints nothing", async ({ page }) => {
  await countPrints(page);
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  // A difference with no note is refused before anything is written.
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("5");
  await confirmButton(dialog).click();
  await expect(dialog.getByText(S.cashCloseNoteRequiredError)).toBeVisible();
  expect(await printCalls(page)).toBe(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.daySummaryClosedByLabel, { exact: true })).toHaveCount(0);
  await page.emulateMedia({ media: null });
});

test("a closed day reprints its summary from the closed state", async ({ page }) => {
  await countPrints(page);
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await openCashClose(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("0");
  await confirmButton(dialog).click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  await expect.poll(() => printCalls(page)).toBe(1);
  // The print dialog closing takes the printed page away again.
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".day-close-print-target")).toHaveCount(0);

  await openCashClose(page);
  const closedDialog = page.getByRole("dialog");
  await expect(closedDialog.getByText(S.cashCloseClosedAtLabel)).toBeVisible();
  await closedDialog.getByRole("button", { name: S.cashClosePrintSummaryAction, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(2);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(`${S.cashCloseHeadTitlePrefix} ${formatWeekdayFullDate(todayInCairo())}`, { exact: true })).toBeVisible();
  await expect(summaryRow(page, S.daySummaryClosedByLabel)).toHaveText(ASSISTANT_NAME);
  // The sheet itself stays off paper.
  await expect(page.getByRole("button", { name: S.cashClosePrintSummaryAction, exact: true })).toBeHidden();
  await page.emulateMedia({ media: null });
});
