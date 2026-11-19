import { expect, test, type Browser } from "@playwright/test";
import {
  advanceRowTo,
  AUTH,
  correctVisit,
  CORRECTION,
  invoiceHead,
  invoiceTotals,
  labeledRowValue,
  lockOverlay,
  login,
  openAuditLog,
  parsePounds,
  PROFILE,
  readStore,
  rowFor,
  S,
  sidebar,
  SIDEBAR,
} from "../e2e/support";
import { addDaysToClinicDay, cairoInstant, todayInCairo, weekdayOf } from "../src/domain/time";
import { bookDirect, bookNew, eventually, firstEmptySlotTime, firstPullLanded, nudge, queueOrderOf, queueToday, walkIn, openDevice, pushed, rowCount, rowStatus, seriesLetter, setUpClinic, type Device } from "./liveSupport";
import { CORRECTION_STALE_LABEL, MODE_SWITCH_REFUSED_LABEL, QUEUE_REORDER_REFUSED_LABEL } from "../src/sync/reviewSummary";
import { provisionOrg, removeLiveOrgs, startApi, stopApi, type LiveOrg } from "./liveServer";

// Two devices of one freshly provisioned organization, each its own browser
// context, against the real API on clintra_test (README.md here). Every
// check waits for the sync engine by nudging it, never by sleeping.

const STATUSES = [S.statusBooked, S.statusArrived, S.statusInRoom, S.statusCompleted, S.statusCancelled, S.statusNoShow];

let org: LiveOrg;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await removeLiveOrgs();
  await startApi();
  org = await provisionOrg();
});

test.afterAll(async () => {
  await stopApi();
  await removeLiveOrgs([org.orgId]);
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
  // A must hold the schedule before it goes offline, or it has no slot to book.
  await eventually([a], () => firstPullLanded(a), true, "A's first pull lands");
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
  // Stopping the API before A's first pull lands would leave A with no slots to book.
  await eventually([a], () => firstPullLanded(a), true, "A's first pull lands");
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

/** The audit sheet's rows on `device` that carry every one of `texts`. */
function auditRows(device: Device, ...texts: string[]) {
  let rows = device.page.getByRole("dialog").getByRole("listitem");
  for (const text of texts) {
    rows = rows.filter({ hasText: text });
  }
  return rows;
}

/** How many audit rows on `device` carry every one of `texts`, read from a freshly opened audit sheet. */
async function auditRowCount(device: Device, ...texts: string[]): Promise<number> {
  await openAuditLog(device.page);
  const count = await auditRows(device, ...texts).count();
  await device.page.keyboard.press("Escape");
  await expect(device.page.getByRole("dialog")).toBeHidden();
  return count;
}

test("the assistant's actions on A appear in B's audit log under the assistant's name, and B's invoice names its creator", async ({ browser }) => {
  // The assistant scenario 8 added; signed in on A, the owner on B.
  const assistant = { name: "Live Assistant", pin: "1357" };
  const [a, b] = await twoDevices(browser);
  await eventually([a, b], async () => (await readStore<{ display_name: string | null }>(a.page, "memberships")).some((row) => row.display_name === assistant.name), true);
  await a.page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(a.page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(a.page, assistant);

  await bookNew(a, "مريض سجل");
  await completeVisit(a, "مريض سجل");
  await openInvoice(a, "مريض سجل");
  await payInFull(a);
  await a.page.keyboard.press("Escape");

  await eventually([a, b], () => auditRowCount(b, "أنشأ حجز", "مريض سجل", assistant.name), 1, "B lists A's booking once, as the assistant's");
  await eventually([a, b], () => auditRowCount(b, "قفل الزيارة", "مريض سجل", assistant.name), 1, "B lists A's completion");
  await eventually([a, b], () => auditRowCount(b, "سجّل دفعة", assistant.name), 1, "B lists A's payment");
  await eventually([a, b], () => rowStatus(b, "مريض سجل", STATUSES), S.statusCompleted);
  const sheet = await openInvoice(b, "مريض سجل");
  await expect(sheet.getByText(new RegExp(`^${S.invoiceCreatedPrefix} \\d{2}:\\d{2} · ${assistant.name}$`))).toBeVisible();
  await b.page.keyboard.press("Escape");

  // Offline on A: the row waits on A and reaches B once A is back.
  await a.context.setOffline(true);
  await bookNew(a, "مريض سجل أوفلاين");
  await a.context.setOffline(false);
  await eventually([a, b], () => auditRowCount(b, "أنشأ حجز", "مريض سجل أوفلاين", assistant.name), 1, "A's offline booking reaches B's audit log once");
  await closeAll(a, b);
});

/** Who `name`'s day row on `device` says recorded it (the "سجّله …" byline), or null. */
async function recordedBy(device: Device, name: string): Promise<string | null> {
  const text = (await rowFor(device.page, name).first().innerText().catch(() => "")) ?? "";
  const line = text.split("\n").find((part) => part.startsWith(`${S.recordedByPrefix} `));
  return line ? line.slice(S.recordedByPrefix.length + 1).trim() : null;
}

test("the assistant's booking on A reads as the assistant's on B", async ({ browser }) => {
  const assistant = { name: "Live Assistant", pin: "1357" };
  const [a, b] = await twoDevices(browser);
  await eventually([a, b], async () => (await readStore<{ display_name: string | null }>(a.page, "memberships")).some((row) => row.display_name === assistant.name), true);
  await a.page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(a.page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(a.page, assistant);

  await bookNew(a, "مريض بتوقيع");
  await eventually([a, b], () => rowCount(b, "مريض بتوقيع"), 1, "B receives A's booking");
  await eventually([a, b], () => recordedBy(b, "مريض بتوقيع"), assistant.name, "B's byline names the assistant, not the token's owner");
  await eventually([a, b], () => pushed(a), true);
  await eventually([a, b], () => recordedBy(a, "مريض بتوقيع"), assistant.name, "A keeps the assistant after its own pull");
  await closeAll(a, b);
});

// Corrections after completion (docs/design-clinical-corrections.md): the
// correction group against the real server, and two devices correcting one
// form.
const CORRECTED_PATIENT = "مريض بتعديل";
const FIRST_REASON = "نسيت أكتب التشخيص";

/** Opens `name`'s visit sheet from its row and waits for the workspace. */
async function openVisitOn(device: Device, name: string) {
  await rowFor(device.page, name).first().getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const sheet = device.page.getByRole("dialog");
  await expect(sheet.getByPlaceholder(S.visitFormDiagnosisPlaceholder)).toBeVisible();
  return sheet;
}

/** The diagnosis `name`'s visit sheet shows on `device`, read with the sheet open and closed again. */
async function diagnosisOn(device: Device, name: string): Promise<string> {
  const sheet = await openVisitOn(device, name);
  const value = await sheet.getByPlaceholder(S.visitFormDiagnosisPlaceholder).inputValue();
  await sheet.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(sheet).toBeHidden();
  return value;
}

test("A corrects a completed visit's form: B shows تم التعديل and the history with A's reason", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await bookNew(a, CORRECTED_PATIENT);
  await completeVisit(a, CORRECTED_PATIENT);

  // Its form was never filled: the correction starts it (three ops, one group).
  const onA = await openVisitOn(a, CORRECTED_PATIENT);
  await correctVisit(onA, { complaint: "صداع", diagnosis: "صداع نصفي" }, FIRST_REASON);
  await onA.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await eventually([a], () => pushed(a), true, "A's correction is accepted");

  await eventually([a, b], () => rowStatus(b, CORRECTED_PATIENT, STATUSES), S.statusCompleted, "B has the completed visit");
  await eventually([a, b], () => diagnosisOn(b, CORRECTED_PATIENT), "صداع نصفي", "B shows the corrected text");
  const onB = await openVisitOn(b, CORRECTED_PATIENT);
  await expect(onB.getByText(CORRECTION.correctedChip, { exact: true })).toBeVisible();
  await onB.getByRole("button", { name: `${CORRECTION.historyAction} (1)`, exact: true }).click();
  const history = b.page.getByRole("dialog").filter({ has: b.page.getByRole("heading", { name: CORRECTION.historyTitle, exact: true }) });
  await expect(history.getByRole("listitem")).toContainText(`${CORRECTION.reasonPrefix} ${FIRST_REASON}`);
  await expect(history.getByRole("listitem")).toContainText(`${CORRECTION.after}: صداع نصفي`);
  await closeAll(a, b);
});

test("both offline correct the same visit: A's arrives first, B is asked to review once with its text kept, and shows A's version", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await eventually([a, b], () => diagnosisOn(b, CORRECTED_PATIENT), "صداع نصفي", "B has the first correction");
  await eventually([a, b], () => diagnosisOn(a, CORRECTED_PATIENT), "صداع نصفي", "A has the first correction");

  await a.context.setOffline(true);
  await b.context.setOffline(true);
  const onA = await openVisitOn(a, CORRECTED_PATIENT);
  await correctVisit(onA, { diagnosis: "صداع توتري" }, "التشخيص اتراجع");
  await onA.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  const onB = await openVisitOn(b, CORRECTED_PATIENT);
  await correctVisit(onB, { diagnosis: "صداع عنقودي" }, "رأي استشاري تاني");
  await onB.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();

  await a.context.setOffline(false);
  await eventually([a], () => pushed(a), true, "A's correction reaches the server first");
  await b.context.setOffline(false);
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).count(), 1, "B is asked to review");
  await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const review = b.page.getByRole("dialog");
  await expect(review.getByText(`تعديل نموذج زيارة — ${CORRECTION_STALE_LABEL}`)).toHaveCount(1);
  await expect(review).toContainText(`${CORRECTION.fieldDiagnosis}: صداع عنقودي`);
  await expect(review).toContainText(`${CORRECTION.reasonPrefix} رأي استشاري تاني`);
  await expect(review.getByRole("button", { name: S.syncReviewOpenVisit, exact: true })).toHaveCount(1);
  await review.getByRole("button", { name: S.syncReviewAcknowledgeAction, exact: true }).click();
  await expect(review).toBeHidden();

  await eventually([a, b], () => diagnosisOn(b, CORRECTED_PATIENT), "صداع توتري", "B shows A's version");
  expect(await readStore<{ id: string }>(b.page, "visit_form_revisions")).toHaveLength(2);
  await eventually([a, b], () => pushed(b), true, "nothing of B's correction is left to send");
  await closeAll(a, b);
});

/** Opens the owner's settings on its working-hours tab. */
async function openHours(device: Device) {
  await sidebar(device.page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = device.page.getByRole("dialog");
  await expect(settings.getByRole("button", { name: S.settingsHoursTab, exact: true })).toHaveAttribute("aria-pressed", "true");
  return settings;
}

test("the owner's switch to queue on A reaches B from tomorrow, today unchanged", async ({ browser }) => {
  const today = todayInCairo();
  const tomorrow = addDaysToClinicDay(today, 1);
  const todayName = S.weekdayNames[weekdayOf(today)];
  const tomorrowName = S.weekdayNames[weekdayOf(tomorrow)];
  const [a, b] = await twoDevices(browser);
  // Both fresh devices pulled the same day: the same empty slots on each.
  const emptySlots = (device: Device) => device.page.locator("button[data-slot-time]").count();
  await eventually([a, b], async () => {
    const onA = await emptySlots(a);
    return onA > 0 && onA === (await emptySlots(b));
  }, true, "both devices show today's grid");
  const emptyOnB = await emptySlots(b);

  // Tomorrow becomes a working day too, then the doctor switches to queue.
  const settingsA = await openHours(a);
  const tomorrowRowA = settingsA.getByRole("listitem").filter({ hasText: tomorrowName });
  await tomorrowRowA.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await tomorrowRowA.getByRole("button", { name: S.hoursAddWorkingDayAction, exact: true }).click();
  await expect(tomorrowRowA).not.toContainText(S.hoursModeDayOff);
  const switchA = settingsA.getByRole("group", { name: S.hoursModeSwitchLabel, exact: true });
  await switchA.getByRole("button", { name: S.hoursModeQueue, exact: true }).click();
  await expect(tomorrowRowA).toContainText(S.hoursModeQueue);
  await a.page.keyboard.press("Escape");

  const switchedRows = async (device: Device) =>
    (await readStore<{ mode: string; next_mode: string | null; next_mode_from: string | null }>(device.page, "schedules"))
      .map((row) => `${row.mode}>${row.next_mode}@${row.next_mode_from}`)
      .sort();
  await eventually([a, b], () => pushed(a), true);
  await eventually([a, b], () => switchedRows(b), [`slots>queue@${tomorrow}`, `slots>queue@${tomorrow}`], "B gets both rows switched from tomorrow");
  expect(await switchedRows(a)).toEqual(await switchedRows(b));

  // B: today's grid as it was, tomorrow's weekday in queue.
  expect(await emptySlots(b)).toBe(emptyOnB);
  await expect(b.page.getByText(S.queueSummaryCurrentTurnLabel)).toHaveCount(0);
  const settingsB = await openHours(b);
  const switchB = settingsB.getByRole("group", { name: S.hoursModeSwitchLabel, exact: true });
  await expect(switchB.getByRole("button", { name: S.hoursModeQueue, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(settingsB.getByRole("listitem").filter({ hasText: tomorrowName })).toContainText(S.hoursModeQueue);
  await expect(settingsB.getByRole("listitem").filter({ hasText: todayName })).toContainText(
    new RegExp(`${S.hoursModeSlots} [0-9]+${S.minutesShortUnit}`),
  );
  await b.page.keyboard.press("Escape");
  await closeAll(a, b);
});

/** Sets the open invoice's first line to `price` pounds and saves the edit. */
async function editFirstLinePrice(device: Device, price: string) {
  const sheet = device.page.getByRole("dialog");
  await sheet.getByRole("button", { name: S.editItemsAction, exact: true }).click();
  const editor = sheet.locator("[data-invoice-items-editor]");
  await editor.getByRole("textbox", { name: new RegExp(`^${S.invoiceItemUnitPriceLabel} `) }).first().fill(price);
  await editor.getByRole("button", { name: S.editItemsSaveAction, exact: true }).click();
  await expect(editor).toBeHidden();
}

/** The invoice's total as the device shows it, read from a freshly opened sheet. */
async function invoiceTotalOn(device: Device, name: string): Promise<number> {
  const sheet = await openInvoice(device, name);
  const total = parsePounds(await labeledRowValue(invoiceTotals(sheet), S.invoiceTotalLabel));
  await device.page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  return total;
}

test("an invoice's items edited on A: B shows the new total", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await bookNew(a, "مريض تعديل بنود");
  await completeVisit(a, "مريض تعديل بنود");
  await openInvoice(a, "مريض تعديل بنود");
  await editFirstLinePrice(a, "777.50");
  await a.page.keyboard.press("Escape");
  await eventually([a], () => pushed(a), true, "A pushes the edit");
  await eventually([a, b], () => rowStatus(b, "مريض تعديل بنود", STATUSES), S.statusCompleted);
  await eventually([a, b], () => invoiceTotalOn(b, "مريض تعديل بنود"), 777.5, "B shows A's new total");
  await closeAll(a, b);
});

test("an edit on B offline after A recorded a payment is put up for review on B", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await bookNew(a, "مريض دفع قبل التعديل");
  await completeVisit(a, "مريض دفع قبل التعديل");
  await eventually([a, b], () => rowStatus(b, "مريض دفع قبل التعديل", STATUSES), S.statusCompleted, "the invoice reaches B");
  await eventually([a, b], () => rowFor(b.page, "مريض دفع قبل التعديل").getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).count(), 1);

  await b.context.setOffline(true);
  await openInvoice(b, "مريض دفع قبل التعديل");
  await editFirstLinePrice(b, "999");
  await b.page.keyboard.press("Escape");

  const sheet = await openInvoice(a, "مريض دفع قبل التعديل");
  await sheet.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = a.page.getByRole("dialog").filter({ hasText: S.paymentMethodLabel });
  await payment.getByRole("textbox").first().fill("10");
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(a.page.getByText(S.invoiceStatusPartial).first()).toBeVisible();
  await a.page.keyboard.press("Escape");
  await eventually([a], () => pushed(a), true, "A's payment reaches the server first");

  await b.context.setOffline(false);
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).count(), 1, "B is asked to review");
  await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  await expect(b.page.getByRole("dialog")).toContainText("الفاتورة دي اتدفع فيها، مينفعش تتعدّل");
  await b.page.keyboard.press("Escape");
  await eventually([a, b], () => invoiceTotalOn(a, "مريض دفع قبل التعديل").then((total) => total !== 999), true, "A never gets B's edit");
  await closeAll(a, b);
});

/** Opens the patients screen on `device` and searches for `query`. */
async function searchPatientsOn(device: Device, query: string) {
  await sidebar(device.page).getByRole("button", { name: SIDEBAR.navPatients, exact: true }).click();
  await device.page.getByPlaceholder(PROFILE.searchPlaceholder).fill(query);
}

test("a patient archived on A is hidden on B, and shows there with the archived switch on", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  // A patient whose one visit is cancelled has nothing still to come.
  await bookNew(a, "مريض للأرشيف");
  await rowFor(a.page, "مريض للأرشيف").getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await a.page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true }).click();
  await a.page.getByRole("button", { name: S.cancelReasonPatient, exact: true }).click();
  await expect(rowFor(a.page, "مريض للأرشيف")).toContainText(S.statusCancelled);

  await searchPatientsOn(b, "مريض للأرشيف");
  const resultsOnB = b.page.getByRole("list", { name: PROFILE.resultsLabel, exact: true }).getByRole("button").filter({ hasText: "مريض للأرشيف" });
  await eventually([a, b], () => resultsOnB.count(), 1, "B finds the patient before the archive");

  await searchPatientsOn(a, "مريض للأرشيف");
  await a.page.getByRole("list", { name: PROFILE.resultsLabel, exact: true }).getByRole("button").filter({ hasText: "مريض للأرشيف" }).click();
  await a.page.getByRole("button", { name: PROFILE.archiveAction, exact: true }).click();
  await expect(a.page.getByRole("button", { name: PROFILE.restoreAction, exact: true })).toBeVisible();
  await eventually([a, b], () => pushed(a), true, "A's archive reaches the server");

  await eventually([a, b], () => b.page.getByText(PROFILE.searchNoMatch, { exact: true }).count(), 1, "B hides the archived patient");
  await b.page.getByRole("switch", { name: PROFILE.showArchivedLabel, exact: true }).click();
  await expect(resultsOnB).toContainText(PROFILE.archivedBadge);
  await closeAll(a, b);
});

const REORDER = ["مريض دور 1", "مريض دور 2", "مريض دور 3"];
const moveButton = (device: Device, direction: "up" | "down", name: string) =>
  device.page.getByRole("button", {
    name: direction === "up" ? S.queueMoveUpLabel(name) : S.queueMoveDownLabel(name),
    exact: true,
  });

test("today in queue: a reorder on A shows on B", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await eventually([a], () => firstPullLanded(a), true, "A's first pull lands");
  await queueToday(a, org);
  await eventually([a, b], async () => b.page.getByText(S.queueSummaryCurrentTurnLabel).count(), 1, "B's day turns to queue");

  for (const name of REORDER) {
    await walkIn(a, name);
  }
  await eventually([a, b], () => queueOrderOf(b, REORDER), REORDER, "B has the three waiting in A's order");

  await moveButton(a, "up", REORDER[1]).click();
  const moved = [REORDER[1], REORDER[0], REORDER[2]];
  await expect.poll(() => queueOrderOf(a, REORDER)).toEqual(moved);
  await eventually([a, b], () => queueOrderOf(b, moved), moved, "B shows A's new order");
  await eventually([a, b], () => pushed(a), true);
  await closeAll(a, b);
});

test("both offline reorder the same queue: the later one is put back, asked to review once, and shows the first one's order", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  // The previous scenario left the queue as 2, 1, 3.
  const start = [REORDER[1], REORDER[0], REORDER[2]];
  await eventually([a, b], async () => (await queueOrderOf(a, REORDER)).join() === start.join() && (await queueOrderOf(b, REORDER)).join() === start.join(), true);

  await a.context.setOffline(true);
  await b.context.setOffline(true);
  // A moves the middle one up; B moves it down.
  await moveButton(a, "up", REORDER[0]).click();
  const onA = [REORDER[0], REORDER[1], REORDER[2]];
  await expect.poll(() => queueOrderOf(a, REORDER)).toEqual(onA);
  await moveButton(b, "down", REORDER[0]).click();
  await expect.poll(() => queueOrderOf(b, REORDER)).toEqual([REORDER[1], REORDER[2], REORDER[0]]);

  await a.context.setOffline(false);
  await eventually([a], () => pushed(a), true, "A's reorder reaches the server first");
  await b.context.setOffline(false);
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).count(), 1, "B is asked to review");
  await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const review = b.page.getByRole("dialog");
  await expect(review.getByText(QUEUE_REORDER_REFUSED_LABEL)).toHaveCount(1);
  await expect(review.getByRole("button", { name: S.syncReviewAcknowledgeAction, exact: true })).toHaveCount(1);
  await review.getByRole("button", { name: S.syncReviewAcknowledgeAction, exact: true }).click();
  await expect(review).toBeHidden();

  await eventually([a, b], () => queueOrderOf(b, REORDER), onA, "B shows A's order");
  expect(await queueOrderOf(a, REORDER)).toEqual(onA);
  await closeAll(a, b);
});

/** Sends `name`'s waiting visit to the end of the queue, from its row's menu. */
async function sendToEnd(device: Device, name: string) {
  await rowFor(device.page, name).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await device.page.getByRole("menuitem", { name: S.sendToEndOfQueueMenuLabel, exact: true }).click();
}

test("today in queue: sending a visit to the end on A is applied whole and shows on B", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  // The previous scenario left the queue as 1, 2, 3.
  await eventually([a, b], async () => (await queueOrderOf(a, REORDER)).join() === REORDER.join() && (await queueOrderOf(b, REORDER)).join() === REORDER.join(), true);

  await sendToEnd(a, REORDER[0]);
  const moved = [REORDER[1], REORDER[2], REORDER[0]];
  await expect.poll(() => queueOrderOf(a, REORDER)).toEqual(moved);
  await eventually([a], () => pushed(a), true, "the server accepts A's move");
  await eventually([a, b], () => queueOrderOf(b, moved), moved, "B shows A's order");
  await expect(a.page.getByRole("button", { name: S.syncNeedsReview, exact: true })).toHaveCount(0);
  await closeAll(a, b);
});

test("both offline send a different visit to the end: the later one is put back, asked to review once, and shows the first one's order", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  const start = [REORDER[1], REORDER[2], REORDER[0]];
  await eventually([a, b], async () => (await queueOrderOf(a, REORDER)).join() === start.join() && (await queueOrderOf(b, REORDER)).join() === start.join(), true);
  // The whole day on both, not only these three: a move shifts every visit after the one moved.
  const visitRows = async (device: Device) =>
    (await readStore<{ id: string; rev: number }>(device.page, "visits")).map((row) => `${row.id}@${row.rev}`).sort().join();
  await eventually([a, b], async () => (await visitRows(a)) === (await visitRows(b)), true, "both devices hold the same visits");

  await a.context.setOffline(true);
  await b.context.setOffline(true);
  await sendToEnd(a, REORDER[1]);
  const onA = [REORDER[2], REORDER[0], REORDER[1]];
  await expect.poll(() => queueOrderOf(a, REORDER)).toEqual(onA);
  await sendToEnd(b, REORDER[2]);
  await expect.poll(() => queueOrderOf(b, REORDER)).toEqual([REORDER[1], REORDER[0], REORDER[2]]);

  await a.context.setOffline(false);
  await eventually([a], () => pushed(a), true, "A's move reaches the server first");
  await b.context.setOffline(false);
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).count(), 1, "B is asked to review");
  await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const review = b.page.getByRole("dialog");
  await expect(review.getByText(QUEUE_REORDER_REFUSED_LABEL)).toHaveCount(1);
  await review.getByRole("button", { name: S.syncReviewAcknowledgeAction, exact: true }).click();
  await expect(review).toBeHidden();

  await eventually([a, b], () => queueOrderOf(b, REORDER), onA, "B shows A's order");
  expect(await queueOrderOf(a, REORDER)).toEqual(onA);
  await closeAll(a, b);
});

/** Switches today's doctor to `mode` from tomorrow in the working-hours editor. */
async function switchMode(device: Device, mode: string) {
  const settings = await openHours(device);
  const control = settings.getByRole("group", { name: S.hoursModeSwitchLabel, exact: true }).getByRole("button", { name: mode, exact: true });
  await control.click();
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await device.page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
}

/** The given visits on `device`, as "position scheduled_at" each, in the order given. */
async function visitsOn(device: Device, ids: readonly string[]): Promise<string[]> {
  const visits = await readStore<{ id: string; position: number; scheduled_at: string | null }>(device.page, "visits");
  return ids.map((visitId) => {
    const visit = visits.find((candidate) => candidate.id === visitId);
    return visit ? `${visit.position} ${visit.scheduled_at}` : "missing";
  });
}

let tomorrowVisits: { late: string; early: string };

test("a switch to queue renumbers tomorrow's visits by time and is applied whole: B gets A's order", async ({ browser }) => {
  const tomorrow = addDaysToClinicDay(todayInCairo(), 1);
  const [a, b] = await twoDevices(browser);
  await eventually([a], () => firstPullLanded(a), true, "A's first pull lands");
  // Scenario 11 left the doctor in queue from tomorrow: back to slots first, so tomorrow's bookings have times.
  await switchMode(a, S.hoursModeSlots);
  await eventually([a], () => pushed(a), true);
  // Booked 10:00 first, then 09:00: their positions follow the booking, not the time.
  const [late, early] = await bookDirect(a, org, tomorrow, ["10:00", "09:00"]);
  tomorrowVisits = { late, early };
  await eventually([a], () => pushed(a), true, "tomorrow's bookings reach the server");
  expect(await visitsOn(a, [early, late])).toEqual([`2 ${cairoInstant(tomorrow, "09:00")}`, `1 ${cairoInstant(tomorrow, "10:00")}`]);

  await switchMode(a, S.hoursModeQueue);
  expect(await visitsOn(a, [early, late])).toEqual(["1 null", "2 null"]);
  await eventually([a], () => pushed(a), true, "the server accepts A's switch whole");
  await eventually([a, b], () => visitsOn(b, [early, late]), ["1 null", "2 null"], "B gets tomorrow in queue order");
  await expect(a.page.getByRole("button", { name: S.syncNeedsReview, exact: true })).toHaveCount(0);
  await closeAll(a, b);
});

test("both offline switch the doctor: the later one is put back whole, asked to review once, and shows the first one's day", async ({ browser }) => {
  const tomorrow = addDaysToClinicDay(todayInCairo(), 1);
  const { late, early } = tomorrowVisits;
  const [a, b] = await twoDevices(browser);
  await eventually([a, b], async () => (await visitsOn(a, [early, late])).join() === "1 null,2 null" && (await visitsOn(b, [early, late])).join() === "1 null,2 null", true);
  // A fresh device's backfill pages in after the bootstrap's visits: both must hold the doctor's rows before going offline.
  const scheduleRows = async (device: Device) =>
    (await readStore<{ id: string; rev: number }>(device.page, "schedules")).map((row) => `${row.id}@${row.rev}`).sort().join();
  await eventually([a, b], async () => {
    const onA = await scheduleRows(a);
    return onA !== "" && onA === (await scheduleRows(b));
  }, true, "both devices hold the same schedule rows");

  await a.context.setOffline(true);
  await b.context.setOffline(true);
  await switchMode(a, S.hoursModeSlots);
  await switchMode(b, S.hoursModeSlots);
  const slotted = [`1 ${cairoInstant(tomorrow, "09:00")}`, `2 ${cairoInstant(tomorrow, "09:30")}`];
  expect(await visitsOn(b, [early, late])).toEqual(slotted);

  await a.context.setOffline(false);
  await eventually([a], () => pushed(a), true, "A's switch reaches the server first");
  await b.context.setOffline(false);
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).count(), 1, "B is asked to review");
  await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const review = b.page.getByRole("dialog");
  await expect(review.getByText(MODE_SWITCH_REFUSED_LABEL)).toHaveCount(1);
  await review.getByRole("button", { name: S.syncReviewAcknowledgeAction, exact: true }).click();
  await expect(review).toBeHidden();

  await eventually([a, b], () => visitsOn(b, [early, late]), await visitsOn(a, [early, late]), "B shows A's day");
  await eventually([a, b], () => pushed(b), true, "nothing of B's switch is left to send");
  await closeAll(a, b);
});

/** The closure's reason A types, read back on B. */
const CLOSURE_REASON = "مؤتمر طبي";

/** Settings → working hours → "إجازات ومواعيد استثنائية" on `device`. */
async function openExceptions(device: Device) {
  const settings = await openHours(device);
  return settings.getByRole("region", { name: S.exceptionsHeading, exact: true });
}

test("A closes today with a reason: B gets the closure and its reason, its queue stays flagged and it can add no one; A removes it and B can again", async ({ browser }) => {
  const today = todayInCairo();
  const [a, b] = await twoDevices(browser);
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.walkInButtonLabel, exact: true }).count(), 1, "B can add to today's queue");

  const section = await openExceptions(a);
  await section.getByLabel(S.exceptionDateLabel, { exact: true }).fill(today);
  await section.getByLabel(S.exceptionReasonLabel, { exact: true }).fill(CLOSURE_REASON);
  await section.getByRole("button", { name: S.exceptionAddAction, exact: true }).click();
  // Today's queue has bookings: A is shown them and confirms; none is cancelled.
  await expect(section.getByRole("alert")).toContainText(REORDER[0]);
  await section.getByRole("button", { name: S.exceptionConfirmClosure, exact: true }).click();
  await expect(section.getByRole("listitem").filter({ hasText: today })).toContainText(S.exceptionClosedLabel);
  await a.page.keyboard.press("Escape");
  await eventually([a], () => pushed(a), true, "the server accepts A's closure");

  await eventually([a, b], async () => b.page.getByRole("button", { name: S.walkInButtonLabel, exact: true }).count(), 0, "B can add no one on the closed day");
  await expect(rowFor(b.page, REORDER[0])).toContainText(S.outsideHoursRowBadge);
  expect(await rowStatus(b, REORDER[0], STATUSES)).toBe(S.statusArrived);
  // The reason travelled with the row (docs/schema.md's v27 additions).
  await expect(b.page.locator("[data-closed-day-note]")).toContainText(`${S.closureReasonPrefix} ${CLOSURE_REASON}`);

  const again = await openExceptions(a);
  await again.getByRole("listitem").filter({ hasText: today }).getByRole("button", { name: S.exceptionDeleteAction, exact: true }).click();
  await expect(again.getByText(S.exceptionsEmpty)).toBeVisible();
  await a.page.keyboard.press("Escape");
  await eventually([a, b], async () => b.page.getByRole("button", { name: S.walkInButtonLabel, exact: true }).count(), 1, "B can add to the queue again");
  await expect(rowFor(b.page, REORDER[0])).not.toContainText(S.outsideHoursRowBadge);
  await closeAll(a, b);
});

/** The closed day's figure under `label`, read from a freshly opened cash close sheet. */
async function closedFigure(device: Device, label: string): Promise<string | null> {
  await device.page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  const sheet = device.page.getByRole("dialog");
  await expect(sheet.getByText(S.cashCloseSummaryHeading)).toBeVisible();
  const closed = (await sheet.getByText(S.cashCloseClosedAtLabel, { exact: true }).count()) > 0;
  const value = closed ? await labeledRowValue(sheet, label) : null;
  await device.page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  return value;
}

test("A closes the day with an opening float; B shows the same opening and expected", async ({ browser }) => {
  const [a, b] = await twoDevices(browser);
  await a.page.evaluate(() => {
    window.print = () => {};
  });
  await a.page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  const sheet = a.page.getByRole("dialog");
  await sheet.getByLabel(S.cashCloseOpeningLabel, { exact: true }).fill("250.50");
  await sheet.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("0");
  await sheet.getByLabel(S.cashCloseNotePlaceholder).fill("اختبار الرصيد");
  const confirm = sheet.getByRole("button", { name: S.cashCloseConfirmButton, exact: true }).last();
  const toast = a.page.getByText(S.cashCloseToastMessage);
  const blocked = sheet.getByText(S.cashClosePastDueBlockedError);
  await confirm.click();
  await expect(toast.or(blocked)).toBeVisible();
  if (await blocked.isVisible()) {
    // Earlier tests' bookings may already be past due today.
    await sheet.getByLabel(S.cashClosePastDueAcknowledgeLabel).check();
    await confirm.click();
  }
  await expect(toast).toBeVisible();
  await eventually([a], () => pushed(a), true, "A's close reaches the server");

  const expectedOnA = await closedFigure(a, S.cashCloseExpectedLabel);
  expect(await closedFigure(a, S.cashCloseOpeningLabel)).toContain("250.50");
  expect(expectedOnA).not.toBeNull();
  await eventually([a, b], () => closedFigure(b, S.cashCloseOpeningLabel), await closedFigure(a, S.cashCloseOpeningLabel), "B gets A's opening");
  await eventually([a, b], () => closedFigure(b, S.cashCloseExpectedLabel), expectedOnA, "B shows A's expected");
  await closeAll(a, b);
});
