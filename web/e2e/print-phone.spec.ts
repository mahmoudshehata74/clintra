import { expect, test, type Locator } from "@playwright/test";
import { karimPrescriptionPreview, printSheet, S, selectPractitioner, SLOTS_DR, gotoSeededDay } from "./support";

// A clinic phone on a printed page's preview keeps its digit groups on one
// line. On a phone-width prescription preview it used to break as
// "02 2123" / "4567".
const PHONE = /^\d{2,4}( \d{3,4}){1,2}$/;

async function expectPhonesOnOneLine(scope: Locator): Promise<void> {
  const lines = await scope.locator("bdi").evaluateAll(
    (runs, pattern) =>
      runs
        .filter((run) => new RegExp(pattern).test(run.textContent?.trim() ?? ""))
        .map((run) => {
          const range = document.createRange();
          range.selectNodeContents(run);
          return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
        }),
    PHONE.source,
  );
  expect(lines.length, "phone runs found").toBeGreaterThan(0);
  expect(lines.every((count) => count === 1), `lines per phone run: ${lines.join(", ")}`).toBe(true);
}

test("the prescription preview keeps the clinic phone on one line", async ({ page }) => {
  await karimPrescriptionPreview(page);
  await expectPhonesOnOneLine(printSheet(page));
});

test("tomorrow's sheet keeps the clinic phone on one line", async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(S.daySheetTitle)).toBeVisible();
  await expectPhonesOnOneLine(sheet);
});
