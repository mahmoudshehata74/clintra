import { expect, test, type Page } from "@playwright/test";
import { formatEgyptianPhoneForDisplay } from "../src/domain/phone";
import {
  ASSISTANT_NAME,
  emptySlotTiles,
  gotoRealDay,
  gotoSeededDay,
  invoicePayments,
  labeledRowValue,
  lockOverlay,
  login,
  openBookingSheet,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  pickSearchResult,
  rowFor,
  S,
  selectPractitioner,
  SIDEBAR,
  SLOTS_DR,
  QUEUE_DR,
  VISIT,
  MSG,
  openSendSheetFromRow,
  fillNewPlan,
  PLAN,
  karimProfileFixture,
  openProfileFromSearch,
  PROFILE,
  profileEvents,
  searchPatientsPage,
  openFreshInvoice,
  parsePounds,
  recordHalfPayment,
  karimWorkspaceWithHistory,
  fillWorkspace,
  karimPrescriptionPreview,
  MESSAGE_PATIENTS,
  bookMessagePatients,
  PLAN_GOAL,
  PLAN_DIAGNOSIS,
  karimWorkspaceOnPlanDay,
  doctorDayFixture,
  auditDayFixture,
  messagesPageFixture,
  suggestedMessagesFixture,
  suggestedSection,
  carePlanSheetFixture,
} from "./support";
import { registrationStrings } from "../src/auth/registrationStrings";
import { galleryStrings } from "../src/gallery/strings";
import { prescriptionPrintStrings as RX } from "../src/screens/prescription/strings";

// Opt-in visual-review capture. Every test here is tagged @screenshot, so the
// default interaction run (pnpm test:e2e uses --grep-invert @screenshot) and CI
// skip it entirely; it runs only via `pnpm test:e2e:screenshots`, locally, so a
// human can inspect the PNGs. Output lands in e2e/screenshots/ (gitignored).

const OUT_DIR = "e2e/screenshots";

// A crashing screen renders blank without necessarily failing an assertion, so
// every capture also asserts no uncaught page error fired while reaching it.
const errorsByPage = new WeakMap<Page, Error[]>();

test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (err) => errors.push(err));
  await gotoSeededDay(page);
});

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page) ?? []).toEqual([]);
});

// animations: "disabled" fast-forwards any running finite CSS transition to
// its end state before capturing. Without it a capture taken right after a
// click (e.g. the rail's 150ms active-item colour fade) shows the
// in-between frame, which reads as a faded, half-active control.
//
// A full-page capture also starts from the top: the page's sticky app bar and
// fixed mobile bottom bar are drawn where the viewport sits at capture time,
// so a page left scrolled by an earlier click (a row scrolled into view) once
// put both bars mid-image. Polled rather than assumed, since scrollTo can
// settle a frame later.
async function shoot(page: Page, surface: string, fullPage: boolean): Promise<void> {
  const project = test.info().project.name;
  if (fullPage) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  await page.screenshot({ path: `${OUT_DIR}/${surface}-${project}.png`, fullPage, animations: "disabled" });
}

/** Captures only the named gallery section, not the whole scrollable page. */
async function shootGallerySection(page: Page, surface: string, section: string): Promise<void> {
  const project = test.info().project.name;
  await page
    .locator(`[data-gallery-section="${section}"]`)
    .screenshot({ path: `${OUT_DIR}/${surface}-${project}.png`, animations: "disabled" });
}

test("@screenshot lock-screen-picker", async ({ page }) => {
  // Re-navigate to the fresh, still-locked state (beforeEach logged in).
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await expect(lockOverlay(page).getByText("دخول العيادة")).toBeVisible();
  await shoot(page, "lock-screen-picker", false);
});

test("@screenshot lock-screen-pad", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await lockOverlay(page).getByRole("button", { name: new RegExp(ASSISTANT_NAME) }).click();
  await shoot(page, "lock-screen-pad", false);
});

test("@screenshot day-slots-default", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await shoot(page, "day-slots-default", true);
});

test("@screenshot settings-hours", async ({ page }) => {
  // Re-navigate as the owner (beforeEach logged in as the assistant).
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.settingsHoursTab, { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(7);
  await shoot(page, "settings-hours", false);
});

// Friday turned into a day off, then its editor open on the usual hours,
// ready to become a working day again.
test("@screenshot settings-hours-working-day", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const friday = page.getByRole("dialog").getByRole("listitem").filter({ hasText: S.weekdayNames[5] });
  await friday.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await friday.getByRole("button", { name: S.hoursMakeDayOffAction, exact: true }).click();
  await expect(friday).toContainText(S.hoursModeDayOff);
  await friday.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await expect(friday.getByRole("button", { name: S.hoursAddWorkingDayAction, exact: true })).toBeVisible();
  await shoot(page, "settings-hours-working-day", false);
});

test("@screenshot settings-services", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.settingsServicesTab, exact: true }).click();
  // One service stopped, so the capture shows both row states and counts.
  const stopped = dialog.getByRole("listitem").filter({ hasText: "فحص شامل" }).getByRole("switch");
  await stopped.click();
  await expect(stopped).toHaveAttribute("aria-checked", "false");
  await shoot(page, "settings-services", false);
});

// "كشف عام"'s form open with a new name, duration and price typed in, not
// yet saved, above its price overrides.
test("@screenshot settings-services-edit", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.settingsServicesTab, exact: true }).click();
  const row = dialog.getByRole("listitem").filter({ hasText: "كشف عام" });
  await row.getByRole("button", { name: S.serviceEditAction, exact: true }).click();
  await row.getByLabel(S.serviceNameLabel, { exact: true }).fill("كشف مفصل");
  await row.getByLabel(S.serviceDurationLabel, { exact: true }).fill("45");
  await row.getByLabel(S.serviceBasePriceLabel, { exact: true }).fill("375");
  await expect(row.getByRole("button", { name: S.serviceOverrideAddAction, exact: true })).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await shoot(page, "settings-services-edit", false);
});

test("@screenshot settings-staff", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  await shoot(page, "settings-staff", false);
});

// The assistant's row in edit mode, its name field first (the rename).
test("@screenshot settings-staff-edit", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  const assistantRow = dialog.getByRole("listitem").filter({ hasText: S.roleAssistant });
  await assistantRow.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await assistantRow.getByLabel(S.staffNameLabel, { exact: true }).fill("مدام سارة");
  await expect(assistantRow.getByRole("button", { name: S.settingsSaveAction, exact: true })).toBeVisible();
  await shoot(page, "settings-staff-edit", false);
});

// The new-staff form while the device is offline: the connection message
// above its save.
test("@screenshot settings-staff-add-offline", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  await dialog.getByRole("button", { name: S.staffNewAction, exact: true }).click();
  await dialog.getByLabel(S.staffNameLabel, { exact: true }).fill("منى الجديدة");
  await dialog.getByLabel(S.staffPhoneLabel, { exact: true }).fill("01099999999");
  await page.context().setOffline(true);
  const message = dialog.getByRole("alert").filter({ hasText: S.staffAddNeedsConnection });
  await expect(message).toBeVisible();
  await message.scrollIntoViewIfNeeded();
  await shoot(page, "settings-staff-add-offline", false);
  await page.context().setOffline(false);
});

// The "الأطباء" tab with one row in edit mode: سلمى إبراهيم given a
// syndicate number first, so both row states show; then أحمد المصري's
// editor open with a new title and number typed in, not yet saved.
test("@screenshot settings-practitioners", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.settingsPractitionersTab, exact: true }).click();

  const salma = dialog.getByRole("listitem").filter({ hasText: QUEUE_DR });
  await salma.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await salma.getByLabel(S.practitionerSyndicateLabel, { exact: true }).fill("45871");
  await salma.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(salma).toContainText(`${S.practitionerSyndicatePrefix} 45871`);

  const ahmed = dialog.getByRole("listitem").filter({ hasText: SLOTS_DR });
  await ahmed.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await ahmed.getByLabel(S.practitionerTitleLabel, { exact: true }).fill("استشاري العلاج الطبيعي");
  await ahmed.getByLabel(S.practitionerSyndicateLabel, { exact: true }).fill("12345");
  await expect(ahmed.getByRole("button", { name: S.settingsSaveAction, exact: true })).toBeVisible();
  await shoot(page, "settings-practitioners", false);
});

test("@screenshot day-slots-with-in-room", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  // Advance the arrived visit so a row wears the loud green in_room fill.
  await rowFor(page, PATIENTS.karim).locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.statusInRoom);
  await shoot(page, "day-slots-with-in-room", true);
});

test("@screenshot day-slots-with-cancelled", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true }).click();
  await page.getByRole("button", { name: S.cancelReasonPatient, exact: true }).click();
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusCancelled);
  await shoot(page, "day-slots-with-cancelled", true);
});

test("@screenshot cancel-prompt", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.cancelPromptTitle)).toBeVisible();
  await shoot(page, "cancel-prompt", false);
});

test("@screenshot move-sheet", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.moveMenuLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.moveSheetHeading)).toBeVisible();
  // The target list loads asynchronously (useLiveQuery) and is tall enough
  // to scroll; wait for a real slot button so the capture isn't racing that
  // load, then pin the dialog's own scroll back to its head before shooting.
  await expect(dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first()).toBeVisible();
  await dialog.evaluate((el) => el.scrollTo(0, 0));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, "move-sheet", false);
});

test("@screenshot day-slots-with-overbook", async ({ page }) => {
  test.setTimeout(120_000);
  await selectPractitioner(page, SLOTS_DR);
  const dialog = page.getByRole("dialog");
  const slotTiles = dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ });
  const overbookButton = dialog.getByRole("button", { name: S.overbookButtonLabel, exact: true });
  const cycle = [PATIENTS.mona, PATIENTS.karim, PATIENTS.yasmin, PATIENTS.omar, PATIENTS.hoda];

  for (let i = 0; i < 12; i++) {
    await openBookingSheet(page);
    await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(cycle[i % cycle.length]);
    await pickSearchResult(dialog, cycle[i % cycle.length]);
    await expect(dialog.getByRole("button", { name: S.bookingBackAction, exact: true })).toBeVisible();
    await expect(slotTiles.first().or(overbookButton)).toBeVisible();
    if (await overbookButton.isVisible()) break;
    await slotTiles.first().click();
    await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await overbookButton.click();
  await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.overbookedRowBadge).first()).toBeVisible();
  await shoot(page, "day-slots-with-overbook", true);
});

test("@screenshot day-queue-default", async ({ page }) => {
  await selectPractitioner(page, QUEUE_DR);
  await expect(page.getByText(S.queueSummaryCurrentTurnLabel)).toBeVisible();
  await shoot(page, "day-queue-default", true);
});

test("@screenshot booking-sheet-empty", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  await shoot(page, "booking-sheet-empty", false);
});

test("@screenshot booking-sheet-with-results", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  await page.getByRole("dialog").getByPlaceholder(S.bookingSearchPlaceholder).fill("م");
  await expect(page.getByRole("dialog").getByText(PATIENTS.mona)).toBeVisible();
  await shoot(page, "booking-sheet-with-results", false);
});

test("@screenshot booking-sheet-empty-results", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  await page.getByRole("dialog").getByPlaceholder(S.bookingSearchPlaceholder).fill("ززززز");
  await expect(page.getByRole("dialog").getByText(S.bookingNoResults)).toBeVisible();
  await shoot(page, "booking-sheet-empty-results", false);
});

test("@screenshot booking-sheet-new-patient-form", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill("مريض جديد");
  await dialog.getByRole("button", { name: S.newPatientButtonPrefix }).click();
  await expect(dialog.getByPlaceholder(S.newPatientNamePlaceholder)).toBeVisible();
  await shoot(page, "booking-sheet-new-patient-form", false);
});

test("@screenshot booking-sheet-service-picker", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await emptySlotTiles(page).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await pickSearchResult(dialog, PATIENTS.mona);
  await expect(dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true })).toBeVisible();
  await shoot(page, "booking-sheet-service-picker", false);
});

test("@screenshot invoice-unpaid", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  await expect(dialog.getByText(S.invoiceStatusUnpaid)).toBeVisible();
  await shoot(page, "invoice-unpaid", false);
});

test("@screenshot invoice-partial", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  await recordHalfPayment(page, dialog);
  await shoot(page, "invoice-partial", false);
});

test("@screenshot invoice-paid", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  await recordHalfPayment(page, dialog);
  const invoice = page.getByRole("dialog");
  const remaining = parsePounds(await labeledRowValue(invoice, S.invoiceRemainingLabel));
  await invoice.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill(remaining.toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPaid)).toBeVisible();
  await shoot(page, "invoice-paid", false);
});

test("@screenshot payment-prompt", async ({ page }) => {
  const dialog = await openFreshInvoice(page);
  // Not exact: the button's own accessible name now also carries the amount due.
  await dialog.getByRole("button", { name: S.recordPaymentAction }).click();
  await expect(page.getByRole("dialog").getByText(S.paymentMethodLabel)).toBeVisible();
  await shoot(page, "payment-prompt", false);
});

test("@screenshot receipt-print", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/?seedDay=1"); // re-navigate so the init script applies
  await login(page);
  const dialog = await openFreshInvoice(page);
  await recordHalfPayment(page, dialog);
  await invoicePayments(page.getByRole("dialog")).getByRole("button", { name: S.printReceiptAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await shoot(page, "receipt-print", true);
  await page.emulateMedia({ media: null });
});

test("@screenshot audit-sheet", async ({ page }) => {
  await auditDayFixture(page);
  await shoot(page, "audit-sheet", false);
});

test("@screenshot cash-close-past-due", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.cashClosePastDueSectionTitle)).toBeVisible();
  await shoot(page, "cash-close-past-due", false);
});

test("@screenshot cash-close-matched", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("0");
  await expect(dialog.getByText(S.cashCloseMatchedTitle)).toBeVisible();
  await shoot(page, "cash-close-matched", false);
});

test("@screenshot cash-close-diff", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("5");
  await expect(dialog.getByText(S.cashCloseDifferenceLabel).last()).toBeVisible();
  await shoot(page, "cash-close-diff", false);
});

test("@screenshot cash-close-closed", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("0");
  await dialog.getByRole("button", { name: S.cashCloseConfirmButton, exact: true }).last().click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.cashCloseClosedAtLabel)).toBeVisible();
  await shoot(page, "cash-close-closed", false);
});

/**
 * The day summary printed on close, under print media at A4's size in CSS
 * pixels (210 × 297 mm = 794 × 1123). The page is the same for both
 * projects, so one project writes it, under a name without the project.
 */
test("@screenshot cash-close-summary-print", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "one A4 page, written once, by the desktop project");
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("0");
  await dialog.getByRole("button", { name: S.cashCloseConfirmButton, exact: true }).last().click();
  await expect(page.getByText(S.cashCloseToastMessage)).toBeVisible();
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("Clintra v1.0.0", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${OUT_DIR}/cash-close-summary-print.png`, fullPage: true, animations: "disabled" });
  await page.emulateMedia({ media: null });
});

test("@screenshot gallery-buttons", async ({ page }) => {
  // Re-navigate: the gallery replaces the app outright (main.tsx), so it
  // never goes through beforeEach's seeded/logged-in day screen. It's also
  // a lazy-loaded chunk (main.tsx), so the shot has to wait for it rather
  // than firing immediately after goto.
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
  await shootGallerySection(page, "gallery-buttons", "buttons");
});

test("@screenshot gallery-field", async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
  await shootGallerySection(page, "gallery-field", "field");
});

test("@screenshot gallery-card", async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
  await shootGallerySection(page, "gallery-card", "card");
});

test("@screenshot gallery-badge", async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
  await shootGallerySection(page, "gallery-badge", "badge");
});

test("@screenshot gallery-togglechip", async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
  await shootGallerySection(page, "gallery-togglechip", "togglechip");
});

test("@screenshot gallery-switch", async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
  await shootGallerySection(page, "gallery-switch", "switch");
});

test("@screenshot gallery-sheetpanel", async ({ page }) => {
  await page.goto("/?gallery=1");
  await expect(page.getByRole("heading", { name: galleryStrings.pageTitle })).toBeVisible();
  await shootGallerySection(page, "gallery-sheetpanel", "sheetpanel");
});

test("@screenshot day-sheet-preview", async ({ page }) => {
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  await expect(page.getByRole("dialog").getByText(S.daySheetTitle)).toBeVisible();
  await shoot(page, "day-sheet-preview", false);
});

test("@screenshot day-sheet-print", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/?seedDay=1");
  await login(page);
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: S.printDaySheetAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await shoot(page, "day-sheet-print", true);
  await page.emulateMedia({ media: null });
});

// Device activation: a plain "/" on a device with no real token shows the
// activation card (the seeded demo device never holds one).
test("@screenshot device-activation-form", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("dialog", { name: registrationStrings.formAria });
  await card.getByLabel(registrationStrings.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await expect(card.getByLabel(registrationStrings.phoneLabel)).toBeVisible();
  await shoot(page, "device-activation-form", false);
});

test("@screenshot activation-confirmation", async ({ page }) => {
  const orgId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  await page.route("**/api/devices/register", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { device_id: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "1|screenshot-only-token",
        device_id: body.device_id,
        org_id: orgId,
        location_id: locationId,
        membership_id: crypto.randomUUID(),
        organization: { id: orgId, name: "النور للعلاج الطبيعي", plan_tier: "small", created_at: new Date().toISOString() },
        locations: [{ id: locationId, org_id: orgId, name: "فرع المعادي", address: "شارع 9", phone: "+20221234567", is_active: true }],
        practitioners: [],
        memberships: [],
        users: [],
      }),
    });
  });
  await page.goto("/");
  const card = page.getByRole("dialog", { name: registrationStrings.formAria });
  await card.getByLabel(registrationStrings.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await card.getByLabel(registrationStrings.phoneLabel).fill("01001234567");
  await card.getByRole("button", { name: registrationStrings.submitLabel }).click();
  await expect(card.getByText(`${registrationStrings.confirmationPrefix} النور للعلاج الطبيعي`, { exact: true })).toBeVisible();
  await shoot(page, "activation-confirmation", false);
});

test("@screenshot doctor-day", async ({ page }) => {
  await doctorDayFixture(page);
  await shoot(page, "doctor-day", true);
});

test("@screenshot visit-workspace-sheet", async ({ page }) => {
  await karimWorkspaceWithHistory(page);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await fillWorkspace(sheet);
  // The sheet scrolls inside its own dialog element; capture it from the top.
  await sheet.evaluate((element) => element.scrollTo(0, 0));
  await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBe(0);
  await shoot(page, "visit-workspace-sheet", false);
});

test("@screenshot current-visit", async ({ page }) => {
  await karimWorkspaceWithHistory(page);
  await page.getByRole("navigation", { name: SIDEBAR.navAriaLabel }).getByRole("button", { name: SIDEBAR.navVisit, exact: true }).click();
  const main = page.getByRole("main");
  await fillWorkspace(main);
  await shoot(page, "current-visit", true);
});

test("@screenshot prescription-preview", async ({ page }) => {
  const sheet = await karimPrescriptionPreview(page);
  await sheet.evaluate((element) => element.scrollTo(0, 0));
  await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBe(0);
  await shoot(page, "prescription-preview", false);
});

/**
 * The print target under print media, at A5's size in CSS pixels (148 ×
 * 210 mm = 559 × 794) — what goes on paper, as plain paper. A screenshot
 * does not paginate: a prescription longer than one page is captured as one
 * tall image (fullPage), and its page break shows only on paper (the
 * printed page count is asserted in prescription-print.spec.ts).
 */
async function shootA5Print(page: Page, sheet: ReturnType<Page["getByRole"]>, surface: string): Promise<void> {
  await sheet.getByRole("button", { name: RX.printAction, exact: true }).click();
  await sheet.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect(page.getByText(VISIT.rxPrintedLine, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 559, height: 794 });
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(RX.previewNote)).toBeHidden();
  await expect(page.getByText(RX.stamp, { exact: true }).filter({ visible: true })).toHaveCount(1);
  await shoot(page, surface, true);
  await page.emulateMedia({ media: null });
}

test("@screenshot prescription-print-a5-3-drugs", async ({ page }) => {
  await shootA5Print(page, await karimPrescriptionPreview(page), "prescription-print-a5-3-drugs");
});

test("@screenshot prescription-print-a5-12-drugs", async ({ page }) => {
  await shootA5Print(page, await karimPrescriptionPreview(page, 9), "prescription-print-a5-12-drugs");
});

test("@screenshot messages-page", async ({ page }) => {
  await messagesPageFixture(page);
  await shoot(page, "messages-page", true);
});

// "مقترح النهارده" with one row of each kind (عمر without a phone).
test("@screenshot messages-suggested", async ({ page }) => {
  await suggestedMessagesFixture(page);
  await expect(suggestedSection(page).getByRole("listitem")).toHaveCount(4);
  // The section itself, with the rail hidden for the capture: on mobile the
  // fixed bottom bar would otherwise sit over its rows.
  await suggestedSection(page).screenshot({
    path: `${OUT_DIR}/messages-suggested-${test.info().project.name}.png`,
    animations: "disabled",
    style: `nav[aria-label="${SIDEBAR.navAriaLabel}"] { visibility: hidden; }`,
  });
});

test("@screenshot messages-send-sheet", async ({ page }) => {
  await bookMessagePatients(page);
  const sheet = await openSendSheetFromRow(page, MESSAGE_PATIENTS[0].name);
  await sheet.getByRole("group", { name: MSG.sendTemplateLabel }).getByRole("button", { name: "تذكير جلسة خطة", exact: true }).click();
  await expect(sheet.getByRole("status")).toBeVisible();
  await shoot(page, "messages-send-sheet", false);
});

async function shootTallSheet(page: Page, sheet: ReturnType<Page["getByRole"]>, surface: string, height: number): Promise<void> {
  const { width } = page.viewportSize()!;
  await page.setViewportSize({ width, height });
  await sheet.evaluate((element) => element.scrollTo(0, 0));
  await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBe(0);
  await shoot(page, surface, false);
}

const tallHeight = () => (test.info().project.name === "mobile" ? 2100 : 1500);

test("@screenshot care-plan-create", async ({ page }) => {
  const workspace = await karimWorkspaceOnPlanDay(page);
  const sheet = await fillNewPlan(page, workspace, PLAN_GOAL, [
    { service: "فحص شامل", count: "1", gap: "0" },
    { service: "كشف عام", count: "6", gap: "7" },
  ]);
  await sheet.getByLabel(PLAN.diagnosisField, { exact: true }).fill(PLAN_DIAGNOSIS);
  await expect(sheet.getByRole("list", { name: PLAN.previewHeading, exact: true }).getByRole("listitem")).toHaveCount(7);
  await expect(sheet.getByRole("region", { name: PLAN.previewHeading, exact: true })).toContainText("2,300 ج.م");
  await shootTallSheet(page, sheet, "care-plan-create", tallHeight());
});

test("@screenshot care-plan-sheet", async ({ page }) => {
  const sheet = await carePlanSheetFixture(page);
  await shootTallSheet(page, sheet, "care-plan-sheet", tallHeight());
});

// Screen 18, the patient profile, on karimProfileFixture's day: كريم's
// history on "الكل" — visits, a prescription, a message, payments and a note
// across four days — and the patients page's results for "ر" (كريم, عمر,
// هدى: each name has it at a different place, so the order is fixed).

// The profile is taller than a phone's screen, and a full-page capture
// paints the fixed bottom bar where the viewport ends — mid-timeline — so
// the window grows to the whole page first.
async function shootWholePage(page: Page, surface: string): Promise<void> {
  const { width } = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await shoot(page, surface, true);
}

test("@screenshot patient-profile", async ({ page }) => {
  await karimProfileFixture(page);
  await openProfileFromSearch(page, PATIENTS.karim, PATIENTS.karim);
  await expect(profileEvents(page)).toHaveCount(9);
  await expect(page.getByRole("region", { name: PROFILE.timelineLabel, exact: true })).toContainText(PROFILE.planStartSuffix);
  await shootWholePage(page, "patient-profile");
});

test("@screenshot patient-search", async ({ page }) => {
  await karimProfileFixture(page);
  const results = await searchPatientsPage(page, "ر");
  await expect(results.getByRole("button")).toHaveCount(3);
  await expect(results.getByRole("button").first()).toContainText(formatEgyptianPhoneForDisplay("+201112345678"));
  await shoot(page, "patient-search", true);
});
