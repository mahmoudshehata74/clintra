import { expect, test, type Browser } from "@playwright/test";
import { advanceRowTo, invoiceHead, invoiceTotals, labeledRowValue, login, parsePounds, readStore, rowFor, S, sidebar, SIDEBAR } from "../e2e/support";
import { bookNew, eventually, firstEmptySlotTime, nudge, openDevice, pushed, rowCount, rowStatus, seriesLetter, setUpClinic, type Device } from "./liveSupport";
import { provisionOrg, startApi, stopApi, type LiveOrg } from "./liveServer";

// Two devices of one freshly provisioned organization, each its own browser
// context, against the real API on clintra_test (README.md here). Every
// check waits for the sync engine by nudging it, never by sleeping.

const STATUSES = [S.statusBooked, S.statusArrived, S.statusInRoom, S.statusCompleted, S.statusCancelled, S.statusNoShow];

let org: LiveOrg;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await startApi();
  org = await provisionOrg();
});

test.afterAll(async () => {
  await stopApi();
});

/** Opens a visit's invoice from its row's menu. */
async function openInvoice(device: Device, name: string) {
  await rowFor(device.page, name).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await device.page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  const sheet = device.page.getByRole("dialog");
  await expect(invoiceHead(sheet)).toBeVisible();
  return sheet;
}

/** Records the whole remaining amount in cash on an open invoice sheet. */
async function payInFull(device: Device) {
  const sheet = device.page.getByRole("dialog");
  const remaining = await labeledRowValue(invoiceTotals(sheet), S.invoiceRemainingLabel);
  await sheet.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = device.page.getByRole("dialog").filter({ hasText: S.paymentMethodLabel });
  await payment.getByRole("textbox").first().fill(parsePounds(remaining).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(device.page.getByText(S.invoiceStatusPaid).first()).toBeVisible();
}

async function completeVisit(device: Device, name: string) {
  await advanceRowTo(device.page, name, S.statusArrived);
  await advanceRowTo(device.page, name, S.statusInRoom);
  await advanceRowTo(device.page, name, S.statusCompleted);
}

async function twoDevices(browser: Browser): Promise<[Device, Device]> {
  const a = await openDevice(browser, org, "A");
  const b = await openDevice(browser, org, "B");
  return [a, b];
}

async function closeAll(...devices: Device[]) {
  for (const device of devices) {
    expect(device.errors, `${device.name}: uncaught page errors`).toEqual([]);
    await device.context.close();
  }
}

test("set up the clinic; a booking on A appears on B, a status on B appears on A", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await setUpClinic(a);
  await eventually([a, b], async () => (await b.page.locator("button[data-slot-time]").count()) > 0, true, "B gets the schedule");
  await bookNew(a, "مريض أول");
  await eventually([a, b], () => rowCount(b, "مريض أول"), 1, "the booking reaches B once");
  await advanceRowTo(b.page, "مريض أول", S.statusArrived);
  await eventually([a, b], () => rowStatus(a, "مريض أول", STATUSES), S.statusArrived, "the arrival reaches A");
  await closeAll(a, b);
});

test("payment round trip; B's invoice numbers carry its series letter", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await bookNew(a, "مريض دفع");
  await completeVisit(a, "مريض دفع");
  await eventually([a, b], () => rowStatus(b, "مريض دفع", STATUSES), S.statusCompleted, "the completed visit reaches B");
  await eventually([a, b], () => rowFor(b.page, "مريض دفع").getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).count(), 1);
  await openInvoice(b, "مريض دفع");
  await payInFull(b);
  await b.page.keyboard.press("Escape");
  await eventually(
    [a, b],
    async () => {
      const sheet = await openInvoice(a, "مريض دفع");
      const paid = await sheet.getByText(S.invoiceStatusPaid).count();
      await a.page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      return paid > 0;
    },
    true,
    "B's payment reaches A",
  );

  await bookNew(b, "مريض فاتورة ب");
  await completeVisit(b, "مريض فاتورة ب");
  const letter = await seriesLetter(b);
  expect(letter, "B has a series of its own").not.toBe("");
  const sheet = await openInvoice(b, "مريض فاتورة ب");
  await expect(invoiceHead(sheet)).toContainText(new RegExp(`INV-\\d{4}-${letter}-\\d{4}`));
  await closeAll(a, b);
});

test("A offline books three and takes a payment; back online, B shows each once", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await a.context.setOffline(true);
  await expect(a.page.getByRole("button", { name: S.syncLocal, exact: true })).toBeVisible();
  const names = ["مريض أوفلاين 1", "مريض أوفلاين 2", "مريض أوفلاين 3"];
  for (const name of names) {
    await bookNew(a, name);
  }
  await completeVisit(a, names[0]);
  await openInvoice(a, names[0]);
  await payInFull(a);
  await a.page.keyboard.press("Escape");
  await a.context.setOffline(false);
  await eventually([a, b], () => pushed(a), true, "A pushes everything");
  for (const name of names) {
    await eventually([a, b], () => rowCount(b, name), 1, `${name} reaches B once`);
  }
  await eventually([a, b], () => rowStatus(b, names[0], STATUSES), S.statusCompleted);
  const sheet = await openInvoice(b, names[0]);
  await expect(sheet.getByText(S.invoiceStatusPaid).first()).toBeVisible();
  // One payment, once: one receipt number in the invoice's payments.
  await expect(sheet.locator("[data-invoice-payments]").getByText(/RCP-/)).toHaveCount(1);
  await closeAll(a, b);
});

test("server stopped and restarted: the chip says so, a reload keeps the data, then it converges", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await stopApi();
  try {
    await bookNew(a, "مريض السيرفر واقف");
    await eventually([a], async () => a.page.getByRole("button", { name: S.syncServerUnreachable, exact: true }).count(), 1, "A shows the server unreachable");
    await a.page.reload();
    await login(a.page, { name: org.ownerName, pin: org.ownerPin });
    await expect(rowFor(a.page, "مريض السيرفر واقف")).toBeVisible();
  } finally {
    await startApi();
  }
  await eventually([a, b], () => pushed(a), true, "A pushes once the server is back");
  await eventually([a, b], () => rowCount(b, "مريض السيرفر واقف"), 1, "the booking reaches B once");
  await eventually([a], async () => a.page.getByRole("button", { name: S.syncOnline, exact: true }).count(), 1, "A's chip is back online");
  await closeAll(a, b);
});

test("both offline book the same slot: one booking survives, the other device names the lost one", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await eventually([a, b], async () => (await firstEmptySlotTime(a)) === (await firstEmptySlotTime(b)), true);
  const time = await firstEmptySlotTime(a);
  await a.context.setOffline(true);
  await b.context.setOffline(true);
  await bookNew(a, "مريض الجهاز أ", time);
  await bookNew(b, "مريض الجهاز ب", time);
  await a.context.setOffline(false);
  await eventually([a], () => pushed(a), true, "A's booking reaches the server first");
  await b.context.setOffline(false);
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).count(), 1, "B is asked to review");
  await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const review = b.page.getByRole("dialog");
  await expect(review).toContainText("مريض الجهاز ب");
  await expect(review).toContainText(time);
  await eventually([a, b], () => rowCount(a, "مريض الجهاز ب"), 0, "A never gets B's booking");
  await eventually([a, b], () => rowCount(b, "مريض الجهاز أ"), 1, "B gets A's booking");
  await closeAll(a, b);
});

test("both offline change the same visit (arrive on A, cancel on B): one state on both", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await bookNew(a, "مريض التعارض");
  await eventually([a, b], () => rowCount(b, "مريض التعارض"), 1);
  await a.context.setOffline(true);
  await b.context.setOffline(true);
  await advanceRowTo(a.page, "مريض التعارض", S.statusArrived);
  await rowFor(b.page, "مريض التعارض").getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await b.page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true }).click();
  await b.page.getByRole("button", { name: S.cancelReasonPatient, exact: true }).click();
  await expect(rowFor(b.page, "مريض التعارض")).toContainText(S.statusCancelled);
  await a.context.setOffline(false);
  await eventually([a], () => pushed(a), true);
  await b.context.setOffline(false);
  await eventually(
    [a, b],
    async () => {
      const onA = await rowStatus(a, "مريض التعارض", STATUSES);
      const onB = await rowStatus(b, "مريض التعارض", STATUSES);
      return onA !== null && onA === onB;
    },
    true,
    "both devices settle on one state",
  );
  await nudge(a);
  await closeAll(a, b);
});

test("adding staff offline is refused clearly", async ({ browser }) => {
  const a = await openDevice(browser, org, "A");
  await a.context.setOffline(true);
  await sidebar(a.page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = a.page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  await settings.getByRole("button", { name: S.staffNewAction, exact: true }).click();
  await expect(settings.getByText(S.staffAddNeedsConnection)).toBeVisible();
  await settings.getByLabel(S.staffNameLabel, { exact: true }).fill("موظف جديد");
  await settings.getByLabel(S.staffPhoneLabel, { exact: true }).fill("01011122233");
  await settings.getByLabel(S.staffPinLabel, { exact: true }).fill("1357");
  await settings.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(settings.getByText(S.staffAddNeedsConnection)).toBeVisible();
  await expect(settings.getByRole("listitem").filter({ hasText: "موظف جديد" })).toHaveCount(0);
  await closeAll(a);
});

test("adding staff online creates them on the server, and the other device gets them", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await sidebar(a.page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = a.page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  await settings.getByRole("button", { name: S.staffNewAction, exact: true }).click();
  await settings.getByLabel(S.staffNameLabel, { exact: true }).fill("Live Assistant");
  await settings.getByLabel(S.staffPhoneLabel, { exact: true }).fill(`011${String(Date.now()).slice(-8)}`);
  await settings.getByLabel(S.staffPinLabel, { exact: true }).fill("1357");
  await settings.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(settings.getByRole("listitem").filter({ hasText: "Live Assistant" })).toBeVisible();
  await eventually(
    [a, b],
    async () => (await readStore<{ display_name: string | null }>(b.page, "memberships")).some((row) => row.display_name === "Live Assistant"),
    true,
    "B gets the new staff member",
  );
  await closeAll(a, b);
});
