import { expect, test } from "@playwright/test";
import { gotoSeededDay, PATIENTS, rowFor, S, selectPractitioner, QUEUE_DR } from "./support";

test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, QUEUE_DR);
  await expect(page.getByText(S.queueSummaryCurrentTurnLabel)).toBeVisible();
});

test("the queue renders one numbered row per visit", async ({ page }) => {
  // Six seeded queue visits: two completed, one in_room, one arrived, one
  // booked, one no-show (see seed.ts).
  await expect(page.getByRole("listitem")).toHaveCount(6);
  await expect(page.getByText(S.statusInRoom, { exact: true })).toBeVisible();
});

test("the next-in-line accent sits on the earliest waiting row once nothing is in_room", async ({ page }) => {
  // Complete the in_room visit so the "current turn" is free — now the accent
  // must mark the earliest still-waiting row (position 4, the arrived visit).
  const inRoom = rowFor(page, PATIENTS.yasmin);
  await expect(inRoom).toContainText(S.statusInRoom);
  await inRoom.locator("button").filter({ hasText: PATIENTS.yasmin }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();

  const nextBadge = page.getByText(S.queueNextBadge, { exact: true });
  await expect(nextBadge).toHaveCount(1);
  await expect(rowFor(page, PATIENTS.omar)).toContainText(S.queueNextBadge);
});

test("average consult minutes render in Western digits, and the expected-wait line is computed", async ({ page }) => {
  // The seed completes two consultations (10 and 12 min; median 11) and writes
  // avg_consult_minutes = 11, so the average shows immediately — in Western
  // digits per Decision B, never Arabic-Indic.
  const summary = page.locator("p.text-muted").filter({ hasText: S.queueSummaryAverageLabel }).first();
  const summaryText = await summary.innerText();
  expect(summaryText).toContain("11");
  expect(summaryText).not.toMatch(/[٠-٩]/); // no Arabic-Indic digits

  // With two completions on record, waiting rows show a computed estimate, not
  // the pre-threshold "لسه بدري نحسب المتوقع" line. (That pre-threshold branch
  // needs a <2-completion fixture, which the demo seed never produces; it is
  // covered by the queueSummary unit tests.)
  await expect(page.getByText(S.queueExpectedWaitPrefix, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(S.queueExpectedWaitUnknown)).toHaveCount(0);
});
