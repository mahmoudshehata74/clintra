import { expect, test, type Page } from "@playwright/test";
import { gotoSeededDay, labeledRowValue, PATIENTS, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

// Neutralise window.print so clicking a print action leaves the print view
// mounted (printTarget stays set) for assertions, instead of the afterprint
// handler immediately tearing it down. Must be registered before navigation.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
});

/** Complete the seeded arrived visit (creating its invoice) and open it. */
async function completeAndOpenInvoice(page: Page) {
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // arrived -> in_room
  await expect(karim).toContainText(S.statusInRoom);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // in_room -> completed
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();

  await karim.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  return page.getByRole("dialog");
}

// The shared money helper drops the fraction when the piastres part is zero
// and adds thousands separators (screens/money.ts's formatMoneyAmount), so
// this now tolerates both "400" and "400.50", and strips any separator.
function parsePounds(text: string): number {
  const match = text.match(/([\d,]+)(?:\.(\d+))?/);
  if (!match) {
    throw new Error(`no amount in: ${JSON.stringify(text)}`);
  }
  const whole = Number(match[1].replace(/,/g, ""));
  const fraction = match[2] ? Number(`0.${match[2]}`) : 0;
  return whole + fraction;
}

test("completing a visit produces an invoice with number, status, items and totals", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);

  // Invoice number (wrapped in an LTR run) in the header — the reference's
  // own .inv-num has no separate label, unlike the old header's "رقم
  // الفاتورة: …" line, so this checks the formatted "INV-…" text itself.
  await expect(dialog.getByText(/^INV-\d{4}-\d{4}$/)).toBeVisible();
  await expect(dialog.locator("bdi.ltr-run").first()).toContainText(/\d/);
  // Status pill — a brand-new invoice is unpaid.
  await expect(dialog.getByText(S.invoiceStatusUnpaid)).toBeVisible();
  // Items table: leading header and the completed visit's service line.
  await expect(dialog.getByText(S.invoiceItemLabel)).toBeVisible();
  await expect(dialog.getByText("استشارة متابعة")).toBeVisible();
  // Totals block.
  await expect(dialog.getByText(S.invoiceTotalLabel)).toBeVisible();
  await expect(dialog.getByText(S.invoicePaidLabel)).toBeVisible();
  await expect(dialog.getByText(S.invoiceRemainingLabel)).toBeVisible();
});

test("a partial payment flips status to partial and turns the remaining row amber", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);
  const total = parsePounds(await labeledRowValue(dialog, S.invoiceTotalLabel));

  // Not exact: the button's own accessible name now also carries the amount due.
  await dialog.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentMethodCash, exact: true }).click();
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  // Back on the invoice: partial status, and the remaining row wears the
  // warning emphasis (the reference's .row.remain.grand, replacing the old
  // ad-hoc amber classes).
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();
  const remainingValue = page
    .getByRole("dialog")
    .getByText(S.invoiceRemainingLabel, { exact: true })
    .locator("xpath=following-sibling::*[1]");
  await expect(remainingValue).toHaveClass(/text-warning/);
});

test("paying the remainder flips status to paid and drops the amber remaining emphasis", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);
  const total = parsePounds(await labeledRowValue(dialog, S.invoiceTotalLabel));

  // First half.
  await dialog.getByRole("button", { name: S.recordPaymentAction }).click();
  let payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();

  // Remaining half.
  const invoice = page.getByRole("dialog");
  const remaining = parsePounds(await labeledRowValue(invoice, S.invoiceRemainingLabel));
  await invoice.getByRole("button", { name: S.recordPaymentAction }).click();
  payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill(remaining.toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  await expect(page.getByText(S.invoiceStatusPaid)).toBeVisible();
  const remainingValue = page
    .getByRole("dialog")
    .getByText(S.invoiceRemainingLabel, { exact: true })
    .locator("xpath=following-sibling::*[1]");
  await expect(remainingValue).not.toHaveClass(/text-warning/);
});

test("voiding is disabled once a payment exists, with the reason shown", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);
  const total = parsePounds(await labeledRowValue(dialog, S.invoiceTotalLabel));

  await dialog.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  const invoice = page.getByRole("dialog");
  await expect(invoice.getByRole("button", { name: S.voidInvoiceAction, exact: true })).toBeDisabled();
  await expect(invoice.getByText(S.voidInvoiceDisabledReason)).toBeVisible();
});

test("the receipt print view shows the print-header note", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);
  const total = parsePounds(await labeledRowValue(dialog, S.invoiceTotalLabel));

  await dialog.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  // Open the receipt print view for the recorded payment.
  await page.getByRole("dialog").getByRole("button", { name: S.printReceiptAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await page.emulateMedia({ media: null });
});
