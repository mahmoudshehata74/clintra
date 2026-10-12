import { expect, test, type Locator, type Page } from "@playwright/test";
import { describeAuditVerb } from "../src/domain/auditVerb";
import { cairoInstant, todayInCairo, type ClockTime } from "../src/domain/time";
import { prescriptionPrintStrings as RX } from "../src/screens/prescription/strings";
import {
  advanceRowTo,
  ASSISTANT_NAME,
  AUTH,
  bookFirstOpenSlot,
  DEV_SEED_PINS,
  gotoRealDay,
  gotoSeededDay,
  lockOverlay,
  login,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
  VISIT,
} from "./support";

// The printed prescription (screen 16), opened from the visit workspace's
// `.rx-section`. window.print is replaced, before navigation, by a counter
// (the existing print specs' stub, counting), so each print request can be
// asserted to open the dialog exactly once and the print target stays
// mounted for inspection. The page clock is pinned to a morning before the
// seeded slots schedule opens, as in visit-workspace.spec.ts.
const TODAY = todayInCairo();
const at = (time: ClockTime) => new Date(cairoInstant(TODAY, time));
const SERVICE = "كشف عام";
const [YEAR, MONTH, DAY] = TODAY.split("-").map(Number);
const TODAY_ON_PAPER = `${DAY} / ${MONTH} / ${YEAR}`;

type Drug = { name: string; form?: string; instructions: string; duration?: string };
const AMOXICILLIN: Drug = { name: "Amoxicillin 500mg", form: "Capsule", instructions: "كبسولة كل 8 ساعات", duration: "5 أيام" };
const IBUPROFEN: Drug = { name: "Ibuprofen 400mg", instructions: "قرص بعد الأكل عند الألم" };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const counted = window as unknown as { printCalls: number };
    counted.printCalls = 0;
    window.print = () => {
      counted.printCalls += 1;
    };
  });
});

const printCalls = (page: Page) => page.evaluate(() => (window as unknown as { printCalls: number }).printCalls);

/** How many audit_log rows read "طبع الوصفة" (domain/auditVerb.ts), straight from the store. */
async function printAuditCount(page: Page): Promise<number> {
  const rows = await page.evaluate(async () => {
    const req = indexedDB.open("clintra");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const store = database.transaction("audit_log", "readonly").objectStore("audit_log");
      return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      });
    } finally {
      database.close();
    }
  });
  return rows.filter(
    (row) => describeAuditVerb(row as unknown as Parameters<typeof describeAuditVerb>[0]) === "طبع الوصفة",
  ).length;
}

/** كريم booked, arrived at 09:00 and in the room, on the real day, by `as` (the owner by default). */
async function karimInRoom(page: Page, as: { name: string; pin: string } = { name: OWNER_NAME, pin: OWNER_PIN }) {
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, as);
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, SERVICE);
  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
}

const visitSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: VISIT.visitSheetTitle }) });
const printSheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: RX.sheetTitle, exact: true }) });
const rxSection = (scope: Locator) => scope.getByRole("region", { name: VISIT.rxHeading, exact: true });

async function openVisitSheet(page: Page): Promise<Locator> {
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const sheet = visitSheet(page);
  await expect(sheet.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
  return sheet;
}

async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(sheet).toBeHidden();
}

async function addDrug(scope: Locator, drug: Drug): Promise<void> {
  await scope.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
  await scope.getByLabel(VISIT.rxNameLabel, { exact: true }).fill(drug.name);
  await scope.getByLabel(VISIT.rxFormLabel, { exact: true }).fill(drug.form ?? "");
  await scope.getByLabel(VISIT.rxInstructionsLabel, { exact: true }).fill(drug.instructions);
  await scope.getByLabel(VISIT.rxDurationLabel, { exact: true }).fill(drug.duration ?? "");
  await scope.getByRole("button", { name: VISIT.rxAddConfirm, exact: true }).click();
  await expect(rxSection(scope).getByRole("listitem").filter({ hasText: drug.name })).toBeVisible();
  await expect(scope.getByRole("button", { name: VISIT.rxAdd, exact: true })).toBeVisible();
}

async function openPrintSheet(page: Page, workspace: Locator, label: string): Promise<Locator> {
  await rxSection(workspace).getByRole("button", { name: label, exact: true }).click();
  const sheet = printSheet(page);
  await expect(sheet.getByText(RX.previewNote, { exact: true })).toBeVisible();
  return sheet;
}

async function switchUser(page: Page, as: { name: string; pin?: string }): Promise<void> {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, as);
}

/** The page size a PDF of the current page lays out on, from its first /MediaBox, in points. */
async function pdfPageSize(page: Page): Promise<{ width: number; height: number }> {
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString("latin1");
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
  expect(match).not.toBeNull();
  return { width: Number(match![1]), height: Number(match![2]) };
}

// A5 portrait is 148 × 210 mm: 419.5 × 595.3 pt.
function expectA5(size: { width: number; height: number }) {
  expect(Math.abs(size.width - 419.5)).toBeLessThan(1.5);
  expect(Math.abs(size.height - 595.3)).toBeLessThan(1.5);
}

test("the preview shows the prescription as screen 16 lays it out", async ({ page }) => {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  const diagnosis = workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
  await diagnosis.fill("التهاب في الحلق");
  await diagnosis.blur();
  await expect(workspace.getByText(S.visitFormSavedIndicator)).toBeVisible();
  await addDrug(workspace, AMOXICILLIN);
  await addDrug(workspace, IBUPROFEN);

  const sheet = await openPrintSheet(page, workspace, RX.printButton);
  // Seed (src/db/seed.ts): أحمد المصري, "طبيب عام"; the clinic lines as on every printed page.
  await expect(sheet.getByText(`${RX.doctorPrefix} ${SLOTS_DR}`, { exact: true })).toBeVisible();
  await expect(sheet.getByText("طبيب عام", { exact: true })).toBeVisible();
  await expect(
    sheet.getByText("عيادة النور · الفرع الرئيسي · شارع الجمهورية، القاهرة · 02 2123 4567", { exact: true }),
  ).toBeVisible();
  await expect(sheet.getByText(/^RX-\d{4}-\d{4}$/)).toBeVisible();
  await expect(sheet.getByText(TODAY_ON_PAPER, { exact: true })).toBeVisible();
  await expect(sheet).toContainText(`${RX.patientLabel} ${PATIENTS.karim}`);
  await expect(sheet).toContainText(`${RX.diagnosisLabel} التهاب في الحلق`);
  await expect(sheet.getByText(RX.ageLabel)).toHaveCount(0);

  const drugs = sheet.getByRole("listitem");
  await expect(drugs).toHaveCount(2);
  await expect(drugs.nth(0)).toContainText(`1${AMOXICILLIN.name} — ${AMOXICILLIN.form}`);
  await expect(drugs.nth(0)).toContainText(`${AMOXICILLIN.instructions} · ${AMOXICILLIN.duration}`);
  await expect(drugs.nth(1)).toContainText(`2${IBUPROFEN.name}`);
  await expect(drugs.nth(1)).not.toContainText("—");
  await expect(sheet).toContainText(`${RX.signature} · ${RX.doctorPrefix} ${SLOTS_DR}`);
  await expect(sheet).toContainText(RX.stamp);
  // One action: no separate PDF, WhatsApp or SMS button.
  await expect(sheet.getByRole("button", { name: RX.printAction, exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /PDF|واتساب|SMS/ })).toHaveCount(1);

  // Escape dismisses the print sheet only; the visit sheet stays open under it.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(workspace).toBeVisible();
});

test("the first print asks; back changes nothing; confirming locks it and prints once; a reprint writes nothing", async ({
  page,
}) => {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  await addDrug(workspace, AMOXICILLIN);

  let sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await expect(sheet.getByText(RX.confirmQuestion, { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: RX.confirmBack, exact: true }).click();
  await expect(sheet.getByText(RX.confirmQuestion, { exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: RX.printAction, exact: true })).toBeVisible();
  expect(await printCalls(page)).toBe(0);
  expect(await printAuditCount(page)).toBe(0);

  // Still editable behind it.
  await closeSheet(sheet);
  await expect(workspace.getByRole("button", { name: VISIT.rxAdd, exact: true })).toBeVisible();
  await expect(rxSection(workspace).getByText(VISIT.rxPrintedLine)).toHaveCount(0);

  sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect(sheet.getByText(RX.confirmQuestion, { exact: true })).toHaveCount(0);
  await expect.poll(() => printCalls(page)).toBe(1);
  expect(await printAuditCount(page)).toBe(1);

  // The workspace now shows it printed: read-only, with "اطبع تاني".
  await expect(rxSection(workspace).getByText(VISIT.rxPrintedLine, { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: VISIT.rxAdd, exact: true })).toHaveCount(0);
  await expect(rxSection(workspace).getByRole("button", { name: RX.reprintButton, exact: true })).toBeAttached();

  // A reprint goes straight to the dialog, without asking and without a write.
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(2);
  await expect(sheet.getByText(RX.confirmQuestion, { exact: true })).toHaveCount(0);
  expect(await printAuditCount(page)).toBe(1);

  await closeSheet(sheet);
  sheet = await openPrintSheet(page, workspace, RX.reprintButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(3);
  expect(await printAuditCount(page)).toBe(1);
});

test("the assistant cannot issue the first print, and can reprint a printed one", async ({ page }) => {
  await karimInRoom(page);
  let workspace = await openVisitSheet(page);
  await addDrug(workspace, AMOXICILLIN);
  await closeSheet(workspace);

  await switchUser(page, { name: ASSISTANT_NAME, pin: DEV_SEED_PINS.assistant });
  workspace = await openVisitSheet(page);
  let sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await expect(sheet.getByRole("alert")).toHaveText(RX.errorNotPrescriber);
  await expect(sheet.getByText(RX.confirmQuestion, { exact: true })).toHaveCount(0);
  expect(await printCalls(page)).toBe(0);
  expect(await printAuditCount(page)).toBe(0);
  await closeSheet(sheet);
  await closeSheet(workspace);

  await switchUser(page, { name: OWNER_NAME, pin: OWNER_PIN });
  workspace = await openVisitSheet(page);
  sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(1);
  await closeSheet(sheet);
  await closeSheet(workspace);

  await switchUser(page, { name: ASSISTANT_NAME });
  workspace = await openVisitSheet(page);
  sheet = await openPrintSheet(page, workspace, RX.reprintButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(2);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  expect(await printAuditCount(page)).toBe(1);
});

test("an empty prescription shows no print button", async ({ page }) => {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  const rx = rxSection(workspace);
  await expect(rx.getByRole("button", { name: RX.printButton, exact: true })).toHaveCount(0);

  await addDrug(workspace, IBUPROFEN);
  await expect(rx.getByRole("button", { name: RX.printButton, exact: true })).toBeVisible();
  // Removing the only drug keeps the numbered prescription, which cannot be printed empty.
  await rx.getByRole("listitem").filter({ hasText: IBUPROFEN.name }).getByRole("button", { name: VISIT.rxRemove }).click();
  await expect(rx.getByRole("listitem")).toHaveCount(0);
  await expect(rx.getByRole("button", { name: RX.printButton, exact: true })).toHaveCount(0);
});

test("the printed prescription alone is on paper, on an A5 page", async ({ page }) => {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  await addDrug(workspace, AMOXICILLIN);
  const sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(1);

  await page.emulateMedia({ media: "print" });
  // The flat print target: no preview note, no sheet, no workspace, no app chrome.
  const doctorName = page.getByText(`${RX.doctorPrefix} ${SLOTS_DR}`, { exact: true });
  await expect(doctorName.filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText(RX.previewNote)).toBeHidden();
  await expect(page.getByRole("button", { name: RX.printAction, exact: true })).toBeHidden();
  await expect(page.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeHidden();
  await expect(page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true })).toBeHidden();
  await page.emulateMedia({ media: null });

  expectA5(await pdfPageSize(page));
});

test.describe("the existing printed pages keep their page size", () => {
  // Without an @page of their own, a PDF of them lays out on Playwright's
  // default page (Letter, 612 × 792 pt) — not on the prescription's A5.
  const LETTER = { width: 612, height: 792 };

  test("tomorrow's sheet", async ({ page }) => {
    await gotoSeededDay(page);
    await selectPractitioner(page, SLOTS_DR);
    await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: S.printDaySheetAction, exact: true }).click();
    await expect.poll(() => printCalls(page)).toBe(1);
    expect(await pdfPageSize(page)).toEqual(LETTER);
  });

  test("the invoice", async ({ page }) => {
    await gotoSeededDay(page);
    await selectPractitioner(page, SLOTS_DR);
    await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
    await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
    await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
    await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
    const invoice = page.getByRole("dialog");
    await expect(invoice.getByText(S.invoiceTotalLabel, { exact: true })).toBeVisible();
    await invoice.getByRole("button", { name: S.printInvoiceAction, exact: true }).click();
    await expect.poll(() => printCalls(page)).toBe(1);
    expect(await pdfPageSize(page)).toEqual(LETTER);
  });
});
