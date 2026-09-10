import { expect, test, type Page } from "@playwright/test";
import {
  ASSISTANT_NAME,
  emptySlotTiles,
  gotoSeededDay,
  lockOverlay,
  login,
  openBookingSheet,
  PATIENTS,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
  QUEUE_DR,
} from "./support";

// Opt-in visual-review capture. Every test here is tagged @screenshot, so the
// default interaction run (pnpm test:e2e uses --grep-invert @screenshot) and CI
// skip it entirely; it runs only via `pnpm test:e2e:screenshots`, locally, so a
// human can inspect the PNGs. Output lands in e2e/screenshots/ (gitignored).

const OUT_DIR = "e2e/screenshots";

// A crashing screen renders blank without necessarily failing an assertion, so
// every capture also asserts no uncaught page error fired while reaching it.
const errorsByPage = new WeakMap<Page, Error[]>();

test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (err) => errors.push(err));
  await gotoSeededDay(page);
});

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page) ?? []).toEqual([]);
});

async function shoot(page: Page, surface: string, fullPage: boolean): Promise<void> {
  const project = test.info().project.name;
  await page.screenshot({ path: `${OUT_DIR}/${surface}-${project}.png`, fullPage });
}

test("@screenshot lock-screen-picker", async ({ page }) => {
  // Re-navigate to the fresh, still-locked state (beforeEach logged in).
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await expect(lockOverlay(page).getByText("دخول العيادة")).toBeVisible();
  await shoot(page, "lock-screen-picker", false);
});

test("@screenshot lock-screen-pad", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await lockOverlay(page).getByRole("button", { name: new RegExp(ASSISTANT_NAME) }).click();
  await shoot(page, "lock-screen-pad", false);
});

test("@screenshot day-slots-default", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await shoot(page, "day-slots-default", true);
});

test("@screenshot day-slots-with-in-room", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  // Advance the arrived visit so a row wears the loud green in_room fill.
  await rowFor(page, PATIENTS.karim).locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.statusInRoom);
  await shoot(page, "day-slots-with-in-room", true);
});

test("@screenshot day-slots-with-cancelled", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true }).click();
  await page.getByRole("button", { name: S.cancelReasonPatient, exact: true }).click();
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusCancelled);
  await shoot(page, "day-slots-with-cancelled", true);
});

test("@screenshot day-slots-with-overbook", async ({ page }) => {
  test.setTimeout(120_000);
  await selectPractitioner(page, SLOTS_DR);
  const dialog = page.getByRole("dialog");
  const slotTiles = dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ });
  const overbookButton = dialog.getByRole("button", { name: S.overbookButtonLabel, exact: true });
  const cycle = [PATIENTS.mona, PATIENTS.karim, PATIENTS.yasmin, PATIENTS.omar, PATIENTS.hoda];

  for (let i = 0; i < 12; i++) {
    await openBookingSheet(page);
    await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(cycle[i % cycle.length]);
    await dialog.getByRole("button").filter({ hasText: cycle[i % cycle.length] }).first().click();
    await expect(dialog.getByRole("button", { name: S.bookingBackAction, exact: true })).toBeVisible();
    await expect(slotTiles.first().or(overbookButton)).toBeVisible();
    if (await overbookButton.isVisible()) break;
    await slotTiles.first().click();
    await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await overbookButton.click();
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.overbookedRowBadge).first()).toBeVisible();
  await shoot(page, "day-slots-with-overbook", true);
});

test("@screenshot day-queue-default", async ({ page }) => {
  await selectPractitioner(page, QUEUE_DR);
  await expect(page.getByText(S.queueSummaryCurrentTurnLabel)).toBeVisible();
  await shoot(page, "day-queue-default", true);
});

test("@screenshot booking-sheet-empty", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  await shoot(page, "booking-sheet-empty", false);
});

test("@screenshot booking-sheet-with-results", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  await page.getByRole("dialog").getByPlaceholder(S.bookingSearchPlaceholder).fill("م");
  await expect(page.getByRole("dialog").getByText(PATIENTS.mona)).toBeVisible();
  await shoot(page, "booking-sheet-with-results", false);
});

test("@screenshot booking-sheet-empty-results", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  await page.getByRole("dialog").getByPlaceholder(S.bookingSearchPlaceholder).fill("ززززز");
  await expect(page.getByRole("dialog").getByText(S.bookingNoResults)).toBeVisible();
  await shoot(page, "booking-sheet-empty-results", false);
});

test("@screenshot booking-sheet-new-patient-form", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill("مريض جديد");
  await dialog.getByRole("button", { name: S.newPatientButtonPrefix }).click();
  await expect(dialog.getByPlaceholder(S.newPatientNamePlaceholder)).toBeVisible();
  await shoot(page, "booking-sheet-new-patient-form", false);
});

test("@screenshot booking-sheet-service-picker", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await emptySlotTiles(page).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await dialog.getByRole("button").filter({ hasText: PATIENTS.mona }).first().click();
  await expect(dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true })).toBeVisible();
  await shoot(page, "booking-sheet-service-picker", false);
});

/** Complete the seeded arrived visit and open its (unpaid) invoice. */
async function openFreshInvoice(page: Page) {
  await selectPractitioner(page, SLOTS_DR);
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();
  await karim.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  return page.getByRole("dialog");
}

async function recordHalfPayment(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const totalText = await dialog.locator("p").filter({ hasText: S.invoiceTotalLabel }).innerText();
  const total = Number((totalText.match(/(\d+\.\d+)/) ?? ["", "0"])[1]);
  await dialog.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();
}

test("@screenshot invoice-unpaid", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  await expect(dialog.getByText(S.invoiceStatusUnpaid)).toBeVisible();
  await shoot(page, "invoice-unpaid", false);
});

test("@screenshot invoice-partial", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  await recordHalfPayment(page, dialog);
  await shoot(page, "invoice-partial", false);
});

test("@screenshot invoice-paid", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  await recordHalfPayment(page, dialog);
  const invoice = page.getByRole("dialog");
  const remaining = Number(
    (
      (await invoice.locator("p").filter({ hasText: S.invoiceRemainingLabel }).innerText()).match(/(\d+\.\d+)/) ?? ["", "0"]
    )[1],
  );
  await invoice.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill(remaining.toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPaid)).toBeVisible();
  await shoot(page, "invoice-paid", false);
});

test("@screenshot payment-prompt", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  await dialog.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.paymentMethodLabel)).toBeVisible();
  await shoot(page, "payment-prompt", false);
});

test("@screenshot receipt-print", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/?seedDay=1"); // re-navigate so the init script applies
  await login(page);
  const dialog = await openFreshInvoice(page);
  await recordHalfPayment(page, dialog);
  await page.getByRole("dialog").getByRole("button", { name: S.printReceiptAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await shoot(page, "receipt-print", true);
  await page.emulateMedia({ media: null });
});

test("@screenshot audit-sheet", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await rowFor(page, PATIENTS.mona).locator("button").filter({ hasText: PATIENTS.mona }).click();
  await expect(page.getByText(S.attendanceMarked)).toBeVisible();
  await page.getByRole("button", { name: S.auditButtonLabel, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.auditSheetTitle)).toBeVisible();
  await shoot(page, "audit-sheet", false);
});

test("@screenshot day-sheet-print", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/?seedDay=1");
  await login(page);
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: S.printDaySheetAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await shoot(page, "day-sheet-print", true);
  await page.emulateMedia({ media: null });
});
