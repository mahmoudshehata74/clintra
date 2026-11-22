import { shotDirectory } from "./browserArtifacts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDrug, closeSheet, karimInRoom, openPrintSheet, openVisitSheet, RX, S, type Drug } from "./support";

// Opt-in visual review of the printed prescription (tagged @screenshot, so
// `pnpm test:e2e` skips it): run with
// `pnpm exec playwright test e2e/rx-shots.spec.ts --project=desktop --grep @screenshot`
// after a build. PNGs land in e2e/rx-shots/<run>/ (gitignored). The 3-drug shots
// are the sheet's preview; the 12-drug shots are paper, laid out under print
// media at the A5 content width (148 − 2 × 12 mm) and cut where Chromium
// breaks the page: at the first unbreakable block that would cross the
// A5 content height (210 − 2 × 12 mm). The 25-drug case is the real print:
// Chromium's own PDF of the A5 pages (rx-25-drugs.pdf in that run folder), which
// alone carries the page-margin header "تابع روشتة …" of every page after
// the first; rasterise it to look at it.
const OUT_DIR = shotDirectory("e2e/rx-shots");
const MM = 96 / 25.4;
const PAGE_WIDTH = Math.round(124 * MM);
const PAGE_HEIGHT = Math.floor(186 * MM);

const drug = (n: number): Drug => ({ name: `Drug ${n} 100mg`, form: "Tablet", instructions: "قرص مرتين يوميًا بعد الأكل", duration: "7 أيام" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
});

async function workspaceWith(page: Page, drugs: number): Promise<Locator> {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  const diagnosis = workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
  await diagnosis.fill("التهاب في الحلق");
  await diagnosis.blur();
  await expect(workspace.getByText(S.visitFormSavedIndicator)).toBeVisible();
  for (let n = 1; n <= drugs; n += 1) {
    await addDrug(workspace, drug(n));
  }
  return workspace;
}

const previewCard = (sheet: Locator) => sheet.getByText(RX.previewNote, { exact: true }).locator("..");

test("@screenshot rx preview, 3 drugs, with and without the diagnosis", async ({ page }) => {
  const workspace = await workspaceWith(page, 3);
  let sheet = await openPrintSheet(page, workspace, RX.printButton);
  await previewCard(sheet).screenshot({ path: `${OUT_DIR}/rx-3-drugs-with-diagnosis.png`, animations: "disabled" });
  await closeSheet(sheet);
  sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("switch", { name: RX.diagnosisSwitchLabel, exact: true }).click();
  await expect(sheet.getByText(RX.diagnosisLabel)).toHaveCount(0);
  await previewCard(sheet).screenshot({ path: `${OUT_DIR}/rx-3-drugs-without-diagnosis.png`, animations: "disabled" });
});

test("@screenshot rx paper, 12 drugs, pages 1 and 2", async ({ page }) => {
  const workspace = await workspaceWith(page, 12);
  const sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await page.setViewportSize({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  await page.emulateMedia({ media: "print" });
  const paper = page.locator(".rx-print-target > div");
  const cut = await paper.evaluate((root, pageHeight) => {
    const top = root.getBoundingClientRect().top;
    const list = root.querySelector("ol");
    const blocks = [...(list ? list.children : []), list?.nextElementSibling ?? null].filter((el) => el !== null);
    const crossing = blocks.find((block) => block.getBoundingClientRect().bottom - top > pageHeight);
    return {
      top: top + window.scrollY,
      breakAt: crossing ? crossing.getBoundingClientRect().top - top : null,
      height: root.getBoundingClientRect().height,
    };
  }, PAGE_HEIGHT);
  expect(cut.breakAt).not.toBeNull();
  await page.screenshot({
    path: `${OUT_DIR}/rx-12-drugs-page-1.png`,
    fullPage: true,
    clip: { x: 0, y: cut.top, width: PAGE_WIDTH, height: cut.breakAt! },
  });
  await page.screenshot({
    path: `${OUT_DIR}/rx-12-drugs-page-2.png`,
    fullPage: true,
    clip: { x: 0, y: cut.top + cut.breakAt!, width: PAGE_WIDTH, height: cut.height - cut.breakAt! },
  });
});

test("@screenshot rx paper, 25 drugs, the printed PDF", async ({ page }) => {
  const workspace = await workspaceWith(page, 25);
  const sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect(page.locator(".rx-print-target")).toHaveCount(1);
  const pdf = await page.pdf({ path: `${OUT_DIR}/rx-25-drugs.pdf`, preferCSSPageSize: true });
  expect(pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(3);
});
