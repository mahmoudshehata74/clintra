import { expect, test, type Page } from "@playwright/test";
import { gotoSeededDay, PATIENTS, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

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

function parsePounds(text: string): number {
  const match = text.match(/(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`no amount in: ${JSON.stringify(text)}`);
  }
  return Number(`${match[1]}.${match[2]}`);
}

test("completing a visit produces an invoice with number, status, items and totals", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);

  // Invoice number (wrapped in an LTR run) in the header.
  await expect(dialog.getByText(S.invoiceNumberLabel)).toBeVisible();
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
  const total = parsePounds(await dialog.locator("p").filter({ hasText: S.invoiceTotalLabel }).innerText());

  await dialog.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentMethodCash, exact: true }).click();
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  // Back on the invoice: partial status, and the remaining row wears amber.
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();
  const remainingRow = page.getByRole("dialog").locator("p").filter({ hasText: S.invoiceRemainingLabel });
  await expect(remainingRow).toHaveClass(/amber/);
});

test("paying the remainder flips status to paid and drops the amber remaining emphasis", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);
  const total = parsePounds(await dialog.locator("p").filter({ hasText: S.invoiceTotalLabel }).innerText());

  // First half.
  await dialog.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  let payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();

  // Remaining half.
  const invoice = page.getByRole("dialog");
  const remaining = parsePounds(await invoice.locator("p").filter({ hasText: S.invoiceRemainingLabel }).innerText());
  await invoice.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill(remaining.toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  await expect(page.getByText(S.invoiceStatusPaid)).toBeVisible();
  const remainingRow = page.getByRole("dialog").locator("p").filter({ hasText: S.invoiceRemainingLabel });
  await expect(remainingRow).not.toHaveClass(/amber/);
});

test("voiding is disabled once a payment exists, with the reason shown", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);
  const total = parsePounds(await dialog.locator("p").filter({ hasText: S.invoiceTotalLabel }).innerText());

  await dialog.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  const invoice = page.getByRole("dialog");
  await expect(invoice.getByRole("button", { name: S.voidInvoiceAction, exact: true })).toBeDisabled();
  await expect(invoice.getByText(S.voidInvoiceDisabledReason)).toBeVisible();
});

test("the receipt print view shows the print-header note", async ({ page }) => {
  const dialog = await completeAndOpenInvoice(page);
  const total = parsePounds(await dialog.locator("p").filter({ hasText: S.invoiceTotalLabel }).innerText());

  await dialog.getByRole("button", { name: S.recordPaymentAction, exact: true }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();

  // Open the receipt print view for the recorded payment.
  await page.getByRole("dialog").getByRole("button", { name: S.printReceiptAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await page.emulateMedia({ media: null });
});
