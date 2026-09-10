import { expect, test, type Page } from "@playwright/test";
import { gotoRealDay, gotoSeededDay, openBookingSheet, PATIENTS, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

test.beforeEach(async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
});

function visitFormPill(page: Page, patientName: string) {
  return rowFor(page, patientName).getByRole("button", { name: S.visitFormPillLabel, exact: true });
}

async function openVisitForm(page: Page, patientName: string) {
  await visitFormPill(page, patientName).click();
  return page.getByRole("dialog");
}

test("the pill appears on an in_room row and not on booked or arrived rows", async ({ page }) => {
  // Seeded: منى booked, كريم arrived — neither shows the pill yet.
  await expect(visitFormPill(page, PATIENTS.mona)).toHaveCount(0);
  await expect(visitFormPill(page, PATIENTS.karim)).toHaveCount(0);

  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // arrived -> in_room
  await expect(karim).toContainText(S.statusInRoom);
  await expect(visitFormPill(page, PATIENTS.karim)).toBeVisible();
});

test("typing in a field and blurring saves it, showing the muted saved indicator", async ({ page }) => {
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // arrived -> in_room

  const dialog = await openVisitForm(page, PATIENTS.karim);
  const complaintField = dialog.getByPlaceholder(S.visitFormComplaintPlaceholder);
  await complaintField.fill("ألم في الحلق من يومين");
  await complaintField.blur();
  await expect(dialog.getByText(S.visitFormSavedIndicator)).toBeVisible();

  // Reopen: the value persisted through the sheet's own liveQuery read.
  await dialog.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  const reopened = await openVisitForm(page, PATIENTS.karim);
  await expect(reopened.getByPlaceholder(S.visitFormComplaintPlaceholder)).toHaveValue("ألم في الحلق من يومين");
});

test("completing a visit with an empty form succeeds and shows the muted hint", async ({ page }) => {
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // arrived -> in_room
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // in_room -> completed, form untouched
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();

  await expect(karim).toContainText(S.visitFormEmptyHint);
  // The pill remains for a late edit even after completion.
  await expect(visitFormPill(page, PATIENTS.karim)).toBeVisible();
});

test("completing a visit with a filled form does not show the hint", async ({ page }) => {
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // arrived -> in_room

  const dialog = await openVisitForm(page, PATIENTS.karim);
  const diagnosisField = dialog.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
  await diagnosisField.fill("التهاب الحلق");
  await diagnosisField.blur();
  await expect(dialog.getByText(S.visitFormSavedIndicator)).toBeVisible();
  await dialog.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();

  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // in_room -> completed
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();
  await expect(karim).not.toContainText(S.visitFormEmptyHint);
});

test("tapping a completed row opens the form for a late edit", async ({ page }) => {
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // arrived -> in_room
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click(); // in_room -> completed

  // No advance action is left on a completed row, so tapping the row body
  // itself opens the form, same as the pill.
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
});

test("autosave creates then updates the same row, and the audit sheet shows the field-specific verb and excerpt", async ({
  page,
}) => {
  // Real day (not seeded): audit rows are timestamped now, and the audit
  // sheet filters by the screen's own day — see support.ts's gotoRealDay.
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);

  await openBookingSheet(page);
  const booking = page.getByRole("dialog");
  await booking.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await booking.getByRole("button").filter({ hasText: PATIENTS.mona }).first().click();
  await booking.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.visitBooked)).toBeVisible();

  const mona = rowFor(page, PATIENTS.mona);
  await mona.locator("button").filter({ hasText: PATIENTS.mona }).click(); // booked -> arrived
  await mona.locator("button").filter({ hasText: PATIENTS.mona }).click(); // arrived -> in_room

  const dialog = await openVisitForm(page, PATIENTS.mona);
  const complaintField = dialog.getByPlaceholder(S.visitFormComplaintPlaceholder);
  await complaintField.fill("صداع");
  await complaintField.blur();
  await expect(dialog.getByText(S.visitFormSavedIndicator)).toBeVisible();

  await complaintField.fill("صداع مستمر");
  await complaintField.blur();
  await expect(dialog.getByText(S.visitFormSavedIndicator)).toBeVisible();
  await dialog.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();

  await page.getByRole("button", { name: S.auditButtonLabel, exact: true }).click();
  const audit = page.getByRole("dialog");
  // One "registered" row from the create, one "edited" row from the update —
  // never two "registered" rows, which is what a second-row bug would show.
  await expect(audit.getByText("سجّل شكوى", { exact: true })).toHaveCount(1);
  await expect(audit.getByText("عدّل شكوى", { exact: true })).toHaveCount(1);
  await expect(audit.getByText("صداع مستمر", { exact: false })).toBeVisible();
});
