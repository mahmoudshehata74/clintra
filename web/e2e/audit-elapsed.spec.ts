import { expect, test } from "@playwright/test";
import {
  bookFirstOpenSlot,
  gotoRealDay,
  openAuditLog,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  S,
  selectPractitioner,
  SLOTS_DR,
  todayAt,
} from "./support";

// The audit row's elapsed part is a wall-clock figure on the real day, so the
// page clock is pinned: the booking is written at 08:30 and read at 08:30
// (under a minute) and then at 08:37.
test("an audit row reads دلوقتي in its first minute and من 7د after seven", async ({ page }) => {
  await page.clock.install({ time: todayAt("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");

  await openAuditLog(page);
  const row = page.getByRole("dialog").getByRole("listitem").filter({ hasText: PATIENTS.karim }).first();
  await expect(row).toContainText(`08:30 · ${S.untilNow}`);
  await expect(row).not.toContainText(`${S.auditElapsedPrefix} 0`);

  await page.clock.setSystemTime(todayAt("08:37"));
  await page.keyboard.press("Escape");
  await openAuditLog(page);
  await expect(row).toContainText(`08:30 · ${S.auditElapsedPrefix} 7د`);
});
