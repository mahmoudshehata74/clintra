import { expect, test, type Page } from "@playwright/test";
import {
  addDrug,
  closeSheet,
  type Drug,
  gotoRealDay,
  karimInRoom,
  openAuditLog,
  openPrintSheet,
  openVisitSheet,
  RX,
  rxSection,
  VISIT,
  openBookingSheet,
  PATIENTS,
  pickSearchResult,
  rowFor,
  S,
  SIDEBAR,
  selectPractitioner,
  sidebar,
  SLOTS_DR,
} from "./support";

// The audit sheet filters rows by the screen's day, and audit rows are
// timestamped "now" — so these run on the REAL day (no ?seedDay), where a
// freshly-written row's date matches the day in view. The every-weekday seed
// schedule means today still has an empty, bookable grid to act on.
test.beforeEach(async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
});

function openAudit(page: Page) {
  return openAuditLog(page);
}

/** Book an existing patient into the first open slot — a visits/create row. */
async function bookExisting(page: Page, name: string) {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
  await pickSearchResult(dialog, name);
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

test("the audit sheet opens from the rail with its title and filters", async ({ page }) => {
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

  // The verb leads the row; description names the patient; the actor is
  // named on the line under it (the seeded assistant, سارة حسن / المساعد).
  await expect(dialog.getByText("سجّل حجز", { exact: true }).first()).toBeVisible();
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

test("the rail's السجل item is active while the audit log is open, and the day card no longer carries its own button", async ({ page }) => {
  const nav = sidebar(page);
  const dayItem = nav.getByRole("button", { name: SIDEBAR.navDay, exact: true });
  const auditItem = nav.getByRole("button", { name: SIDEBAR.navAudit, exact: true });
  // The rail's item is the only "السجل" button on the day screen.
  await expect(page.getByRole("button", { name: SIDEBAR.navAudit, exact: true })).toHaveCount(1);

  await openAudit(page);
  await expect(auditItem).toHaveAttribute("aria-current", "page");
  await expect(dayItem).not.toHaveAttribute("aria-current", "page");

  await page.getByRole("dialog").getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(dayItem).toHaveAttribute("aria-current", "page");
});

test("the head counts the events listed, and the filter groups are labelled", async ({ page }) => {
  await bookExisting(page, PATIENTS.mona);
  await openAudit(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(`1 ${S.auditEventCountUnit}`, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("group", { name: S.auditFilterEntityGroupLabel })).toBeVisible();
  await expect(dialog.getByRole("group", { name: S.auditFilterActionGroupLabel })).toBeVisible();

  await dialog.getByRole("button", { name: S.auditFilterEntityPayments, exact: true }).click();
  await expect(dialog.getByText(`0 ${S.auditEventCountUnit}`, { exact: true })).toBeVisible();
  await expect(dialog.getByText(S.auditSheetEmpty, { exact: true })).toBeVisible();
});

test("a prescription's events are listed under the visits filter, naming the patient and never a drug", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  const amoxicillin: Drug = { name: "Amoxicillin 500mg", instructions: "كبسولة كل 8 ساعات", duration: "5 أيام" };
  const ibuprofen: Drug = { name: "Ibuprofen 400mg", instructions: "قرص بعد الأكل عند الألم" };
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  const rx = rxSection(workspace);
  await addDrug(workspace, amoxicillin); // كتب وصفة + أضاف دواء
  await addDrug(workspace, ibuprofen); // أضاف دواء
  await rx.getByRole("listitem").filter({ hasText: amoxicillin.name }).getByRole("button", { name: new RegExp(amoxicillin.name) }).click();
  await workspace.getByLabel(VISIT.rxDurationLabel, { exact: true }).fill("7 أيام");
  await workspace.getByRole("button", { name: VISIT.rxEditConfirm, exact: true }).click(); // عدّل دواء
  await expect(rx.getByRole("listitem").filter({ hasText: amoxicillin.name })).toContainText("7 أيام");
  await rx.getByRole("listitem").filter({ hasText: ibuprofen.name }).getByRole("button", { name: VISIT.rxRemove, exact: true }).click(); // شال دواء
  await expect(rx.getByRole("listitem")).toHaveCount(1);
  const sheet = await openPrintSheet(page, workspace, RX.printButton);
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click(); // طبع الوصفة
  await expect(rx.getByText(VISIT.rxPrintedLine, { exact: true })).toBeVisible();
  await closeSheet(sheet);
  await closeSheet(workspace);

  await openAudit(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.auditFilterEntityVisits, exact: true }).click();
  for (const [verb, count] of [
    ["كتب وصفة", 1],
    ["أضاف دواء", 2],
    ["عدّل دواء", 1],
    ["شال دواء", 1],
    ["طبع الوصفة", 1],
  ] as const) {
    const rows = dialog.getByRole("listitem").filter({ has: page.getByText(verb, { exact: true }) });
    await expect(rows).toHaveCount(count);
    for (const row of await rows.all()) {
      await expect(row).toContainText(PATIENTS.karim);
    }
  }
  await expect(dialog).not.toContainText(amoxicillin.name);
  await expect(dialog).not.toContainText(ibuprofen.name);
  await expect(dialog).not.toContainText(amoxicillin.instructions);

  // Not under another entity's filter.
  await dialog.getByRole("button", { name: S.auditFilterEntityInvoices, exact: true }).click();
  await expect(dialog.getByText("كتب وصفة", { exact: true })).toHaveCount(0);
});
