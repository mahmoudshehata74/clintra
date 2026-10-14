import { expect, test, type Locator, type Page } from "@playwright/test";
import { todayInCairo } from "../src/domain/time";
import {
  addDrug,
  advanceRowTo,
  ASSISTANT_NAME,
  AUTH,
  closeSheet,
  DEV_SEED_PINS,
  type Drug,
  gotoSeededDay,
  invoiceHead,
  invoiceTotals,
  karimInRoom,
  lockOverlay,
  login,
  openAuditLog,
  openPrintSheet,
  openVisitSheet,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  rowFor,
  RX,
  rxSection,
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
// seeded slots schedule opens (karimInRoom), as in visit-workspace.spec.ts.
const [YEAR, MONTH, DAY] = todayInCairo().split("-").map(Number);
const TODAY_ON_PAPER = `${DAY} / ${MONTH} / ${YEAR}`;
// domain/auditVerb.ts's verb for the first print.
const PRINT_VERB = "طبع الوصفة";

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

/** With every sheet closed: the audit screen lists the first print exactly once. */
async function expectPrintedOnceInAudit(page: Page): Promise<void> {
  await openAuditLog(page);
  const audit = page.getByRole("dialog");
  await expect(audit.getByText(PRINT_VERB, { exact: true })).toHaveCount(1);
  await expect(audit.getByRole("listitem").filter({ hasText: PRINT_VERB })).toContainText(PATIENTS.karim);
}

async function switchUser(page: Page, as: { name: string; pin?: string }): Promise<void> {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, as);
}

/** Whether the element is the topmost one at its own centre (what a tap there would hit). */
const isTopmostAtCentre = (element: Locator) =>
  element.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
  });

/** A sheet's drag handle: the element just before its dialog panel (Sheet.tsx). */
const handleOf = (sheet: Locator) => sheet.locator("xpath=preceding-sibling::div[1]");

/**
 * A PDF of the current page: the size its first /MediaBox lays out on, in
 * points, and how many pages it has (its /Type /Page objects). One PDF per
 * call: making one fires afterprint, which unmounts the print target.
 */
async function printedPdf(page: Page): Promise<{ width: number; height: number; pages: number }> {
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString("latin1");
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
  expect(match).not.toBeNull();
  const pages = pdf.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
  return { width: Number(match![1]), height: Number(match![2]), pages };
}

/** The page size a PDF of the current page lays out on, in points. */
async function pdfPageSize(page: Page): Promise<{ width: number; height: number }> {
  const { width, height } = await printedPdf(page);
  return { width, height };
}

/** The print target's page, as laid out under print media. */
const paper = (page: Page) => page.locator(".rx-print-target > div");

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
    sheet.getByText(`عيادة النور · الفرع الرئيسي · شارع الجمهورية، القاهرة · ${RX.clinicPhonePrefix} 02 2123 4567`, { exact: true }),
  ).toBeVisible();
  await expect(sheet.getByText(/^RX-\d{4}-\d{4}$/)).toBeVisible();
  await expect(sheet.getByText(TODAY_ON_PAPER, { exact: true })).toBeVisible();
  await expect(sheet).toContainText(`${RX.patientLabel} ${PATIENTS.karim}`);
  await expect(sheet).toContainText(`${RX.diagnosisLabel} التهاب في الحلق`);
  await expect(sheet.getByText(RX.ageLabel)).toHaveCount(0);

  const drugs = sheet.getByRole("listitem");
  await expect(drugs).toHaveCount(2);
  await expect(drugs.nth(0)).toContainText(`1${AMOXICILLIN.name} — ${AMOXICILLIN.form}`);
  await expect(drugs.nth(0)).toContainText(`${AMOXICILLIN.instructions} · ${VISIT.rxDurationPrefix} ${AMOXICILLIN.duration}`);
  await expect(drugs.nth(1)).toContainText(`2${IBUPROFEN.name}`);
  await expect(drugs.nth(1)).not.toContainText("—");
  await expect(sheet).toContainText(`${RX.signature} · ${RX.doctorPrefix} ${SLOTS_DR}`);
  await expect(sheet).toContainText(RX.stamp);
  // One action: no separate PDF, WhatsApp or SMS button.
  await expect(sheet.getByRole("button", { name: RX.printAction, exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /PDF|واتساب|SMS/ })).toHaveCount(1);

  // Stacked: the visit sheet, its drag handle included, sits under the print
  // sheet's backdrop; only the print sheet's own handle is on top.
  await expect.poll(() => isTopmostAtCentre(handleOf(workspace))).toBe(false);
  await expect.poll(() => isTopmostAtCentre(handleOf(sheet))).toBe(true);

  // Escape dismisses the print sheet only; the visit sheet stays open under it,
  // and is on top again.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(workspace).toBeVisible();
  await expect.poll(() => isTopmostAtCentre(handleOf(workspace))).toBe(true);
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

  // Still editable behind it.
  await closeSheet(sheet);
  await expect(workspace.getByRole("button", { name: VISIT.rxAdd, exact: true })).toBeVisible();
  await expect(rxSection(workspace).getByText(VISIT.rxPrintedLine)).toHaveCount(0);

  sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect(sheet.getByText(RX.confirmQuestion, { exact: true })).toHaveCount(0);
  await expect.poll(() => printCalls(page)).toBe(1);

  // The workspace now shows it printed: read-only, with "اطبع تاني".
  await expect(rxSection(workspace).getByText(VISIT.rxPrintedLine, { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: VISIT.rxAdd, exact: true })).toHaveCount(0);
  await expect(rxSection(workspace).getByRole("button", { name: RX.reprintButton, exact: true })).toBeAttached();

  // A reprint goes straight to the dialog, without asking and without a write.
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(2);
  await expect(sheet.getByText(RX.confirmQuestion, { exact: true })).toHaveCount(0);

  await closeSheet(sheet);
  sheet = await openPrintSheet(page, workspace, RX.reprintButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(3);

  // "Back" wrote nothing and neither did either reprint: one print on record.
  await closeSheet(sheet);
  await closeSheet(workspace);
  await expectPrintedOnceInAudit(page);
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

  // The refusal wrote nothing and the reprint neither: one print on record.
  await closeSheet(sheet);
  await closeSheet(workspace);
  await expectPrintedOnceInAudit(page);
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
  // Plain paper: none of the preview card's frame; the margin is @page's.
  const look = await paper(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: style.borderTopWidth,
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      padding: style.paddingTop,
      maxWidth: style.maxWidth,
      width: element.getBoundingClientRect().width,
      bodyWidth: document.body.getBoundingClientRect().width,
    };
  });
  expect(look).toEqual({
    border: "0px",
    radius: "0px",
    shadow: "none",
    padding: "0px",
    maxWidth: "none",
    width: look.bodyWidth,
    bodyWidth: look.bodyWidth,
  });
  await page.emulateMedia({ media: null });

  const pdf = await printedPdf(page);
  expectA5(pdf);
  expect(pdf.pages).toBe(1);
});

test("a long prescription goes on to a second A5 page, a drug never split", async ({ page }) => {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  for (let n = 1; n <= 12; n += 1) {
    await addDrug(workspace, { name: `Drug ${n} 100mg`, form: "Tablet", instructions: "قرص مرتين يوميًا بعد الأكل", duration: "7 أيام" });
  }
  const sheet = await openPrintSheet(page, workspace, RX.printButton);
  await expect(sheet.getByRole("listitem")).toHaveCount(12);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(1);

  await page.emulateMedia({ media: "print" });
  // Every drug is unbreakable, and the last one shares an unbreakable block with the signature.
  const drugs = paper(page).getByRole("listitem");
  await expect(drugs).toHaveCount(12);
  const breaks = await drugs.evaluateAll((items) => items.map((item) => getComputedStyle(item).breakInside));
  expect(breaks).toEqual(Array(12).fill("avoid"));
  const lastDrugWithSignature = await paper(page).evaluate((root, stamp) => {
    const items = root.querySelectorAll("li");
    const signature = [...root.querySelectorAll("p")].find((p) => p.textContent === stamp);
    let block = items[items.length - 1]?.parentElement ?? null;
    while (block && signature && !block.contains(signature)) {
      block = block.parentElement;
    }
    return block && block !== root ? getComputedStyle(block).breakInside : null;
  }, RX.stamp);
  expect(lastDrugWithSignature).toBe("avoid");
  await page.emulateMedia({ media: null });

  const pdf = await printedPdf(page);
  expectA5(pdf);
  expect(pdf.pages).toBe(2);
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
    await expect(invoiceTotals(invoice).getByText(S.invoiceTotalLabel, { exact: true })).toBeVisible();
    await invoiceHead(invoice).getByRole("button", { name: S.printInvoiceAction, exact: true }).click();
    await expect.poll(() => printCalls(page)).toBe(1);
    expect(await pdfPageSize(page)).toEqual(LETTER);
  });
});
