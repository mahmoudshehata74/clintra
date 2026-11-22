import { shotDirectory } from "./browserArtifacts";
import { expect, test } from "@playwright/test";
import { reportsStrings as R } from "../src/screens/reports/strings";
import { gotoSeededDay, OWNER_NAME, OWNER_PIN, SEEDED_DAY, sidebar, SIDEBAR } from "./support";

test("cash-close report terminology @screenshot", async ({ page }, info) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await sidebar(page).getByRole("button", { name: SIDEBAR.navReports, exact: true }).click();
  await page.getByLabel(R.fromLabel, { exact: true }).fill(SEEDED_DAY);
  await page.getByLabel(R.toLabel, { exact: true }).fill(SEEDED_DAY);
  await page.getByRole("group", { name: R.reportsNavLabel, exact: true })
    .getByRole("button", { name: R.titleCashClose, exact: true }).click();
  const report = page.getByRole("region", { name: R.titleCashClose, exact: true });
  await expect(report).toBeVisible();
  await page.screenshot({ path: `${shotDirectory("e2e/copy-shots")}/reports-cash-close-${info.project.name}.png`, fullPage: true });
});
