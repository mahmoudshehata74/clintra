import { expect, test } from "@playwright/test";
import {
  addDrug, advanceRowTo, closeSheet, invoiceTotals, karimInRoom, labeledRowValue, openPrintSheet,
  openVisitSheet, OWNER_NAME, OWNER_PIN, parsePounds, PATIENTS, readStore, rowFor, RX, S,
} from "./support";

test("an unenforced clinic completes booking, check-in, clinical work, prescription print, invoice, payment and cash close", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { printCalls: number };
    state.printCalls = 0;
    window.print = () => { state.printCalls += 1; };
  });
  await karimInRoom(page, { name: OWNER_NAME, pin: OWNER_PIN });
  const devices = await readStore<{ identity_enforced_at?: string }>(page, "device");
  expect(devices.every((device) => !device.identity_enforced_at)).toBe(true);
  const workspace = await openVisitSheet(page);
  await workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder).fill("التهاب الحلق");
  await workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder).blur();
  await expect(workspace.getByText(S.visitFormSavedIndicator)).toBeVisible();
  await addDrug(workspace, { name: "Paracetamol 500mg", instructions: "قرص عند اللزوم" });
  const print = await openPrintSheet(page, workspace, RX.printButton);
  await print.getByRole("button", { name: RX.printAction, exact: true }).click();
  await print.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);
  await closeSheet(print);
  await closeSheet(workspace);
  await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  const invoice = page.getByRole("dialog");
  const total = parsePounds(await labeledRowValue(invoiceTotals(invoice), S.invoiceTotalLabel));
  expect(total).toBeGreaterThan(0);
  await invoice.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill(total.toFixed(2));
  await payment.getByRole("button", { name: S.paymentMethodCash, exact: true }).click();
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPaid, { exact: true })).toBeVisible();
  await closeSheet(page.getByRole("dialog"));
  await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  const cash = page.getByRole("dialog");
  await cash.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill(total.toFixed(2));
  await expect(cash.getByText(S.cashCloseMatchedTitle)).toBeVisible();
  await cash.getByRole("button", { name: S.cashCloseConfirmButton, exact: true }).last().click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  expect(await readStore(page, "cash_close")).toHaveLength(1);
  expect(await readStore(page, "payments")).not.toHaveLength(0);
});
