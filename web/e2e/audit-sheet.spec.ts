import { expect, test, type Page } from "@playwright/test";
import { gotoRealDay, openBookingSheet, PATIENTS, rowFor, S, selectPractitioner, SLOTS_DR } from "./support";

// The audit sheet filters rows by the screen's day, and audit rows are
// timestamped "now" — so these run on the REAL day (no ?seedDay), where a
// freshly-written row's date matches the day in view. The every-weekday seed
// schedule means today still has an empty, bookable grid to act on.
test.beforeEach(async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
});

function openAudit(page: Page) {
  return page.getByRole("button", { name: S.auditButtonLabel, exact: true }).click();
}

/** Book an existing patient into the first open slot — a visits/create row. */
async function bookExisting(page: Page, name: string) {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
  await dialog.getByRole("button").filter({ hasText: name }).first().click();
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.visitBooked)).toBeVisible();
}

/** Book a brand-new patient — a patients/create row plus a visits/create row. */
async function bookNewPatient(page: Page, name: string) {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
  await dialog.getByRole("button", { name: S.newPatientButtonPrefix }).click();
  await dialog.getByRole("button", { name: S.newPatientSubmitButton, exact: true }).click();
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.visitBooked)).toBeVisible();
}

test("the audit sheet opens from the header with its title and filters", async ({ page }) => {
  await openAudit(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.auditSheetTitle)).toBeVisible();
  await expect(dialog.getByRole("button", { name: S.auditFilterEntityVisits, exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: S.auditFilterActionCreate, exact: true })).toBeVisible();
});

test("each row shows a verb, an entity description and the actor label", async ({ page }) => {
  await bookExisting(page, PATIENTS.mona);
  await openAudit(page);
  const dialog = page.getByRole("dialog");

  // Verb is the prominent ink text; description names the patient; the actor
  // is the muted line (the seeded assistant, سارة حسن / المساعد).
  await expect(dialog.locator("span.text-ink").first()).not.toBeEmpty();
  await expect(dialog.getByText(PATIENTS.mona).first()).toBeVisible();
  await expect(dialog.getByText(/سارة حسن/).first()).toBeVisible();
});

test("the entity and action filters both switch the visible rows", async ({ page }) => {
  await bookExisting(page, PATIENTS.mona); // منى: visits / create
  await rowFor(page, PATIENTS.mona).locator("button").filter({ hasText: PATIENTS.mona }).click(); // منى: visits / update
  await expect(page.getByText(S.attendanceMarked)).toBeVisible();
  await bookNewPatient(page, "عبير اختبار"); // عبير: patients / create AND visits / create
  await openAudit(page);
  const dialog = page.getByRole("dialog");

  // Baseline: both patients represented.
  await expect(dialog.getByText(PATIENTS.mona).first()).toBeVisible();
  await expect(dialog.getByText("عبير اختبار").first()).toBeVisible();

  // Entity filter — منى never appears as a patient row (she already existed).
  await dialog.getByRole("button", { name: S.auditFilterEntityPatients, exact: true }).click();
  await expect(dialog.getByText(PATIENTS.mona)).toHaveCount(0);
  await expect(dialog.getByText("عبير اختبار").first()).toBeVisible();

  await dialog.getByRole("button", { name: S.auditFilterEntityVisits, exact: true }).click();
  await expect(dialog.getByText(PATIENTS.mona).first()).toBeVisible();

  // Action filter (within visits): عبير's visit is a create only, so it
  // vanishes under "update" and returns under "create".
  await dialog.getByRole("button", { name: S.auditFilterActionUpdate, exact: true }).click();
  await expect(dialog.getByText(PATIENTS.mona).first()).toBeVisible();
  await expect(dialog.getByText("عبير اختبار")).toHaveCount(0);

  await dialog.getByRole("button", { name: S.auditFilterActionCreate, exact: true }).click();
  await expect(dialog.getByText("عبير اختبار").first()).toBeVisible();
});

test("a new booking appears in the audit list without a manual refresh", async ({ page }) => {
  await bookExisting(page, PATIENTS.omar);
  // No reload between the write and reading the log.
  await openAudit(page);
  await expect(page.getByRole("dialog").getByText(PATIENTS.omar).first()).toBeVisible();
});
