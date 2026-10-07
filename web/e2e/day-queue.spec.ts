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
  // The in_room row's own meta phrase falls back to the plain status text
  // under ?seedDay=1 (elapsedLabel.ts's real-day gate — see PractitionerColumn.tsx).
  await expect(rowFor(page, PATIENTS.yasmin)).toContainText(S.statusInRoom);
  await expect(rowFor(page, PATIENTS.yasmin)).toHaveAttribute("data-visit-status", "in_room");
});

test("the next-in-line accent sits on the earliest waiting row once nothing is in_room", async ({ page }) => {
  // Complete the in_room visit so the "current turn" is free — now the accent
  // must mark the earliest still-waiting row (position 4, the arrived visit).
  const inRoom = rowFor(page, PATIENTS.yasmin);
  await expect(inRoom).toHaveAttribute("data-visit-status", "in_room");
  await inRoom.locator("button").filter({ hasText: PATIENTS.yasmin }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();

  // The next row carries "التالي" as visually-hidden text for assistive
  // technology (QueueRow.tsx) — present in its content either way.
  await expect(rowFor(page, PATIENTS.omar)).toContainText(S.queueNextBadge);
  // The data attribute stays as an additional, non-visual hook.
  await expect(page.locator('[data-queue-row-kind="next"]')).toHaveCount(1);
  await expect(rowFor(page, PATIENTS.omar)).toHaveAttribute("data-queue-row-kind", "next");
});

test("double-clicking a waiting row's primary button advances exactly one status, not two", async ({ page }) => {
  // The seeded booked visit (هدى), waiting — see seed.ts's queueVisitPlan.
  const hoda = rowFor(page, PATIENTS.hoda);
  await expect(hoda).toContainText(S.statusBooked);
  await expect(hoda).toHaveAttribute("data-visit-status", "booked");

  await hoda.locator("button").filter({ hasText: PATIENTS.hoda }).dblclick();
  await expect(page.getByText(S.attendanceMarked)).toBeVisible();
  await expect(hoda).toContainText(S.statusArrived);
  await expect(hoda).toHaveAttribute("data-visit-status", "arrived");
  await expect(page.getByText(S.inRoomToastMessage)).toHaveCount(0);
});

test("average consult minutes render in Western digits, and the expected-wait line is computed", async ({ page }) => {
  // The seed completes two consultations (10 and 12 min; median 11) and writes
  // avg_consult_minutes = 11, so the average shows immediately — in Western
  // digits per Decision B, never Arabic-Indic. Now rendered in the summary
  // slab's hero caption (DaySlab.tsx), not a standalone per-column paragraph.
  const summary = page.getByText(S.queueSummaryAverageLabel);
  await expect(summary).toContainText("11");
  const summaryText = await summary.innerText();
  expect(summaryText).not.toMatch(/[٠-٩]/); // no Arabic-Indic digits

  // With two completions on record, waiting rows show a computed estimate, not
  // the pre-threshold "لسه بدري نحسب المتوقع" line. (That pre-threshold branch
  // needs a <2-completion fixture, which the demo seed never produces; it is
  // covered by the queueSummary unit tests.)
  await expect(page.getByText(S.queueExpectedWaitPrefix, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(S.queueExpectedWaitUnknown)).toHaveCount(0);
});
