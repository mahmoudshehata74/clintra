import { expect, test, type Page } from "@playwright/test";
import { todayInCairo } from "../src/domain/time";
import { gotoSeededDay, PATIENTS, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

/**
 * Per-device number series (docs/schema.md's v16 additions): this device
 * mints invoice and receipt numbers only inside its own series, and every
 * number on screen carries that series. The seeded device is series 1 —
 * every other spec's numbers read exactly as before — so these tests set
 * the device row's series straight in IndexedDB, the way other specs reach
 * the store. A raw write is not seen by Dexie's live queries, but minting
 * reads the device row fresh on every completion and payment.
 */
test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
});

/** Sets this device's series; resolves to how many device rows it updated (0 until the app has written its row). */
async function setDeviceSeries(page: Page, series: number | null): Promise<number> {
  return page.evaluate(async (series) => {
    const req = indexedDB.open("clintra");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const store = database.transaction("device", "readwrite").objectStore("device");
      const rows: Record<string, unknown>[] = await new Promise((resolve, reject) => {
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      });
      for (const row of rows) {
        await new Promise((resolve, reject) => {
          const put = store.put({ ...row, series });
          put.onsuccess = () => resolve(undefined);
          put.onerror = () => reject(put.error);
        });
      }
      return rows.length;
    } finally {
      database.close();
    }
  }, series);
}

async function useSeries(page: Page, series: number | null): Promise<void> {
  await expect.poll(() => setDeviceSeries(page, series)).toBe(1);
}

/** The seeded arrived visit: arrived -> in_room. */
async function bringKarimIn(page: Page) {
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(karim).toContainText(S.statusInRoom);
  return karim;
}

async function openKarimInvoice(page: Page) {
  const karim = rowFor(page, PATIENTS.karim);
  await karim.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  return page.getByRole("dialog");
}

async function startCashPayment(page: Page, amount: string) {
  await page.getByRole("dialog").getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill(amount);
  await payment.getByRole("button", { name: S.paymentMethodCash, exact: true }).click();
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  return payment;
}

test("a series-2 device numbers its invoice and receipt in series B", async ({ page }) => {
  await useSeries(page, 2);
  const karim = await bringKarimIn(page);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // in_room -> completed
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();

  const invoice = await openKarimInvoice(page);
  await expect(invoice.getByText(`INV-${todayInCairo().slice(0, 4)}-B-0001`, { exact: true })).toBeVisible();

  await startCashPayment(page, "1");
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();
  await expect(page.getByRole("dialog").getByText("RCP-B-1", { exact: true })).toBeVisible();
});

test("a device that does not know its series yet says so, and neither completes the visit nor records a payment", async ({ page }) => {
  const karim = await bringKarimIn(page);

  // Completing: the day screen's toast explains, and the visit stays in the room with no invoice.
  await useSeries(page, null);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.deviceSeriesUnknownError)).toBeVisible();
  await expect(karim).toContainText(S.statusInRoom);
  await expect(page.getByText(S.completedToastMessage)).toHaveCount(0);

  // Recording a payment: the payment sheet's own error line explains, and the invoice stays unpaid.
  await useSeries(page, 1);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();
  await openKarimInvoice(page);
  await useSeries(page, null);
  const payment = await startCashPayment(page, "1");
  await expect(payment.getByText(S.deviceSeriesUnknownError)).toBeVisible();
  // Nothing was recorded: the sheet stays open on its confirm button.
  await expect(payment.getByRole("button", { name: S.paymentConfirmButton, exact: true })).toBeVisible();
});
