import { expect, test, type Page } from "@playwright/test";
import { formatEgyptianPhoneForDisplay } from "../src/domain/phone";
import { addDaysToClinicDay, cairoInstant, todayInCairo, type ClockTime } from "../src/domain/time";
import {
  advanceRowTo,
  ASSISTANT_NAME,
  bookFirstOpenSlot,
  DOCTOR,
  doctorSection,
  openDoctorDay,
  emptySlotTiles,
  gotoRealDay,
  gotoSeededDay,
  labeledRowValue,
  lockOverlay,
  openAuditLog,
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
  bookNewPatientWithPhone,
  MSG,
  openMessagesPage,
  openSendSheetFromRow,
  recordWindowOpen,
  fillNewPlan,
  PLAN,
  putRows,
  readStore,
  reloadAs,
  syncSettled,
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

test("@screenshot settings-staff", async ({ page }) => {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  await shoot(page, "settings-staff", false);
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

/** Complete the seeded arrived visit and open its (unpaid) invoice. */
async function openFreshInvoice(page: Page) {
  await selectPractitioner(page, SLOTS_DR);
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(karim).toContainText(S.statusInRoom);

  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();
  await karim.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  return page.getByRole("dialog");
}

// The shared money helper drops the fraction when the piastres part is zero
// and adds thousands separators, so this tolerates both "400" and "400.50".
function parsePounds(text: string): number {
  const match = text.match(/([\d,]+)(?:\.(\d+))?/);
  const whole = Number((match?.[1] ?? "0").replace(/,/g, ""));
  const fraction = match?.[2] ? Number(`0.${match[2]}`) : 0;
  return whole + fraction;
}

async function recordHalfPayment(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const total = parsePounds(await labeledRowValue(dialog, S.invoiceTotalLabel));
  // Not exact: the button's own accessible name now also carries the amount due.
  await dialog.getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill((total / 2).toFixed(2));
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPartial)).toBeVisible();
}

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
  await page.getByRole("dialog").getByRole("button", { name: S.printReceiptAction, exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText(S.printHeaderWarning)).toBeVisible();
  await shoot(page, "receipt-print", true);
  await page.emulateMedia({ media: null });
});

test("@screenshot audit-sheet", async ({ page }) => {
  // The real day: audit rows are stamped "now", so only today's log shows
  // them (see support.ts's gotoRealDay). Three bookings, then one arrival
  // (default dot), one cancellation (danger) and one no-show (warn).
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  for (const name of [PATIENTS.mona, PATIENTS.omar, PATIENTS.karim]) {
    await openBookingSheet(page);
    const booking = page.getByRole("dialog");
    await booking.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
    await pickSearchResult(booking, name);
    await booking.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
    await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
    await expect(rowFor(page, name)).toContainText(S.statusBooked);
  }
  await rowFor(page, PATIENTS.mona).locator("button").filter({ hasText: PATIENTS.mona }).click();
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusArrived);
  await rowFor(page, PATIENTS.omar).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.cancelMenuLabel, exact: true }).click();
  await page.getByRole("button", { name: S.cancelReasonPatient, exact: true }).click();
  await expect(rowFor(page, PATIENTS.omar)).toContainText(S.statusCancelled);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.noShowMenuLabel, exact: true }).click();
  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.statusNoShow);
  await openAuditLog(page);
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

// The doctor's day mid-morning on the real day, with the page clock pinned
// and stepped forward so the wall-clock figures read like a real morning.
// Every visit is built through the app's own write paths, and every service
// is picked by name (see bookFirstOpenSlot), so desktop and mobile render
// identical data.
//
// First, on the seeded Monday (?seedDay=1): ياسمين's seeded completed visit
// gets a complaint and diagnosis (her full last-visit block below), and
// كريم's seeded arrived visit is seen and closed (his visit with this
// practitioner and its unpaid invoice — the brief's count and invoice line).
// Then on the real day: منى seen 09:00–09:18 with no diagnosis and nothing
// paid (one attention item of each kind), عمر arrived 09:05 and waiting past
// the alert line, ياسمين called in at 09:28, كريم arrived 09:33 (the short
// waiter, and next), هدى booked for later.
test("@screenshot doctor-day", async ({ page }) => {
  const day = todayInCairo();
  const at = (time: ClockTime) => new Date(cairoInstant(day, time));
  const service = "كشف عام";
  await page.clock.install({ time: at("08:30") });

  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await fillVisitForm(page, PATIENTS.yasmin, "آلام أسفل الظهر بعد رفع حاجة تقيلة", "شد عضلي حاد");
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
  await fillVisitForm(page, PATIENTS.karim, "ألم في الركبة اليمنى", "التهاب أوتار");

  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  for (const name of [PATIENTS.mona, PATIENTS.yasmin, PATIENTS.karim, PATIENTS.omar, PATIENTS.hoda]) {
    await bookFirstOpenSlot(page, name, service);
  }

  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.mona, S.statusArrived);
  await advanceRowTo(page, PATIENTS.mona, S.statusInRoom);
  await page.clock.setSystemTime(at("09:05"));
  await advanceRowTo(page, PATIENTS.omar, S.statusArrived);
  await page.clock.setSystemTime(at("09:18"));
  await advanceRowTo(page, PATIENTS.mona, S.statusCompleted);
  await page.clock.setSystemTime(at("09:25"));
  await advanceRowTo(page, PATIENTS.yasmin, S.statusArrived);
  await page.clock.setSystemTime(at("09:28"));
  await advanceRowTo(page, PATIENTS.yasmin, S.statusInRoom);
  await page.clock.setSystemTime(at("09:33"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await page.clock.setSystemTime(at("09:42"));

  await openDoctorDay(page);
  const hero = doctorSection(page, DOCTOR.heroLabel);
  await expect(hero).toContainText(PATIENTS.yasmin);
  await expect(hero).toContainText("شد عضلي حاد");
  const brief = doctorSection(page, DOCTOR.briefNextHeading);
  await expect(brief).toContainText(PATIENTS.karim);
  await expect(brief).toContainText(DOCTOR.totalVisitsOne);
  await expect(brief).toContainText(DOCTOR.invoiceUnpaid);
  const waiting = doctorSection(page, DOCTOR.waitingHeading);
  await expect(waiting.getByRole("listitem")).toHaveCount(2);
  await expect(waiting).toContainText(DOCTOR.waitingAboveThreshold);
  const attention = doctorSection(page, DOCTOR.attentionHeading);
  await expect(attention.getByRole("listitem")).toHaveCount(2);
  await expect(attention).toContainText(DOCTOR.attentionMissingDiagnosisTitle);
  await expect(attention).toContainText(DOCTOR.invoiceUnpaid);
  await shoot(page, "doctor-day", true);
});

/** Opens a day-grid row's visit form, fills both fields (each autosaves on blur), and closes it. */
async function fillVisitForm(page: Page, patientName: string, complaint: string, diagnosis: string): Promise<void> {
  await rowFor(page, patientName).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const form = page.getByRole("dialog");
  for (const [label, placeholder, value] of [
    [S.visitFormComplaintLabel, S.visitFormComplaintPlaceholder, complaint],
    [S.visitFormDiagnosisLabel, S.visitFormDiagnosisPlaceholder, diagnosis],
  ] as const) {
    const field = form.getByPlaceholder(placeholder);
    await field.fill(value);
    await field.blur();
    // Each field's own "اتحفظ" sits next to its own label, so the second
    // save is waited for on its own rather than on the first one's indicator.
    const labelRow = form.locator("div").filter({ has: page.getByText(label, { exact: true }) }).last();
    await expect(labelRow.getByText(S.visitFormSavedIndicator)).toBeVisible();
  }
  await form.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(form).toBeHidden();
}

const KARIM_BIRTH_YEAR = 1992;
const KARIM_PHONE = "+201001234567";
const KARIM_AGE = Number(todayInCairo().slice(0, 4)) - KARIM_BIRTH_YEAR;

/**
 * Fixture data the app has no screen for yet (a patient's birth year and
 * phone; a visit on another day), written straight into IndexedDB the way
 * other specs reach the store. Patients and practitioners are picked by
 * name. Resolves to how many rows each step updated.
 */
async function adjustKarimFixture(page: Page): Promise<{ patients: number; visits: number }> {
  return page.evaluate(
    async ({ patientName, practitionerName, birthYear, phone, shiftDays }) => {
      const req = indexedDB.open("clintra");
      const database: IDBDatabase = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const all = <T,>(store: IDBObjectStore): Promise<T[]> =>
        new Promise((resolve, reject) => {
          const getAll = store.getAll();
          getAll.onsuccess = () => resolve(getAll.result as T[]);
          getAll.onerror = () => reject(getAll.error);
        });
      const put = (store: IDBObjectStore, row: unknown): Promise<void> =>
        new Promise((resolve, reject) => {
          const request = store.put(row);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      type Row = Record<string, unknown>;
      try {
        const tx = database.transaction(["patients", "practitioners", "visits"], "readwrite");
        const patients = (await all<Row>(tx.objectStore("patients"))).filter((row) => row.full_name === patientName);
        const practitioners = (await all<Row>(tx.objectStore("practitioners"))).filter(
          (row) => row.full_name === practitionerName,
        );
        for (const patient of patients) {
          await put(tx.objectStore("patients"), { ...patient, birth_year: birthYear, phone });
        }
        const shiftMs = shiftDays * 86_400_000;
        const shiftInstant = (value: unknown) =>
          typeof value === "string" ? new Date(new Date(value).getTime() + shiftMs).toISOString() : value;
        const visits = (await all<Row>(tx.objectStore("visits"))).filter(
          (row) =>
            patients.some((patient) => patient.id === row.patient_id) &&
            practitioners.some((practitioner) => practitioner.id === row.practitioner_id) &&
            row.status === "completed",
        );
        for (const visit of visits) {
          const [year, month, date] = String(visit.visit_date).split("-").map(Number);
          const day = new Date(Date.UTC(year, month - 1, date) + shiftMs).toISOString().slice(0, 10);
          await put(tx.objectStore("visits"), {
            ...visit,
            visit_date: day,
            scheduled_at: shiftInstant(visit.scheduled_at),
            unique_scheduled_at: shiftInstant(visit.unique_scheduled_at),
            arrived_at: shiftInstant(visit.arrived_at),
            started_at: shiftInstant(visit.started_at),
            ended_at: shiftInstant(visit.ended_at),
          });
        }
        return { patients: patients.length, visits: visits.length };
      } finally {
        database.close();
      }
    },
    {
      patientName: PATIENTS.karim,
      practitionerName: QUEUE_DR,
      birthYear: KARIM_BIRTH_YEAR,
      phone: KARIM_PHONE,
      shiftDays: -21,
    },
  );
}

// The visit workspace (screen 10) for كريم, in the room on the real day
// since 09:00, with a two-visit history on two different days. On the
// seeded Monday first: his seeded queue visit (completed with سلمى) gets a
// diagnosis and is then moved three weeks earlier, he gets a birth year and
// a phone, and his seeded arrived slots visit is seen, closed, diagnosed and
// given two drugs. Every service and patient is picked by name and the
// clock is pinned, so desktop and mobile render the same data.
async function karimWorkspaceWithHistory(page: Page): Promise<void> {
  const day = todayInCairo();
  const at = (time: ClockTime) => new Date(cairoInstant(day, time));
  await page.clock.install({ time: at("08:30") });

  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, QUEUE_DR);
  await fillVisitForm(page, PATIENTS.karim, "ألم في الركبة بعد الجري", "إجهاد عضلي");
  expect(await adjustKarimFixture(page)).toEqual({ patients: 1, visits: 1 });
  await selectPractitioner(page, SLOTS_DR);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
  await fillVisitForm(page, PATIENTS.karim, "ألم في الركبة اليمنى", "التهاب أوتار");
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const earlier = page.getByRole("dialog");
  await addDrug(earlier, "Diclofenac 50mg", "قرص مرتين يوميًا بعد الأكل", "5 أيام");
  await addDrug(earlier, "Voltaren Gel", "دهان موضعي على الركبة", "");
  await earlier.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(earlier).toBeHidden();

  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");
  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  // Half a minute past, so the seconds the taps above took never round the
  // session length down to 13 on a slower run.
  await page.clock.setSystemTime(new Date(at("09:14").getTime() + 30_000));
}

/** Fills the workspace's two fields and three drugs, waiting for each save. */
async function fillWorkspace(scope: ReturnType<Page["getByRole"]>): Promise<void> {
  for (const [key, placeholder, value] of [
    ["complaint", S.visitFormComplaintPlaceholder, "ألم مستمر في الركبة اليمنى من 5 أيام، يزيد مع الحركة"],
    ["diagnosis", S.visitFormDiagnosisPlaceholder, "التهاب وتر الرضفة، حاد"],
  ] as const) {
    const field = scope.getByPlaceholder(placeholder);
    await field.fill(value);
    await field.blur();
    // Each field's own "اتحفظ" hint (Field's `${id}-hint`).
    await expect(scope.locator(`#visit-form-${key}-hint`)).toHaveText(S.visitFormSavedIndicator);
  }
  await addDrug(scope, "Diclofenac 50mg", "قرص مرتين يوميًا بعد الأكل", "7 أيام");
  await addDrug(scope, "Paracetamol 500mg", "قرص عند الألم، بحد أقصى 4 مرات يوميًا", "");
  await addDrug(scope, "Voltaren Gel", "دهان موضعي 3 مرات يوميًا على الركبة", "أسبوعين");
  const history = scope.getByRole("region", { name: VISIT.historyTwo, exact: true });
  await expect(history).toBeVisible();
  // Each row leads with its d/m date run.
  const dates = await history
    .getByRole("listitem")
    .evaluateAll((rows) => rows.map((row) => row.querySelector("bdi")?.textContent ?? ""));
  expect(new Set(dates).size).toBe(2);
  await expect(scope).toContainText(`${KARIM_AGE} ${VISIT.ageUnit}`);
  await expect(scope).toContainText(formatEgyptianPhoneForDisplay(KARIM_PHONE));
  await expect(scope.getByText(S.visitFormSavedIndicator)).toHaveCount(0);
}

async function addDrug(
  scope: ReturnType<Page["getByRole"]>,
  name: string,
  instructions: string,
  duration: string,
  optional: { form?: string; note?: string } = {},
): Promise<void> {
  await scope.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
  await scope.getByLabel(VISIT.rxNameLabel, { exact: true }).fill(name);
  await scope.getByLabel(VISIT.rxFormLabel, { exact: true }).fill(optional.form ?? "");
  await scope.getByLabel(VISIT.rxInstructionsLabel, { exact: true }).fill(instructions);
  await scope.getByLabel(VISIT.rxDurationLabel, { exact: true }).fill(duration);
  await scope.getByLabel(VISIT.rxNoteLabel, { exact: true }).fill(optional.note ?? "");
  await scope.getByRole("button", { name: VISIT.rxAddConfirm, exact: true }).click();
  await expect(
    scope.getByRole("region", { name: VISIT.rxHeading, exact: true }).getByRole("listitem").filter({ hasText: name }),
  ).toBeVisible();
  await expect(scope.getByRole("button", { name: VISIT.rxAdd, exact: true })).toBeVisible();
}

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

// The printed prescription (screen 16) for كريم's visit above: his
// diagnosis and three drugs, two with a form and one with a note, as the
// prototype's own example, then `extraDrugs` more. window.print is stubbed
// before the fixture's first navigation, so a print leaves the print target
// mounted.
async function karimPrescriptionPreview(page: Page, extraDrugs = 0): Promise<ReturnType<Page["getByRole"]>> {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await karimWorkspaceWithHistory(page);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const workspace = page.getByRole("dialog");
  const diagnosis = workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
  await diagnosis.fill("التهاب وتر الرضفة");
  await diagnosis.blur();
  await expect(workspace.locator("#visit-form-diagnosis-hint")).toHaveText(S.visitFormSavedIndicator);
  await addDrug(workspace, "Diclofenac 50mg", "قرص مرتين يوميًا بعد الأكل", "7 أيام", {
    form: "Tablet",
    note: "يوقف مع أي ألم في المعدة",
  });
  await addDrug(workspace, "Paracetamol 500mg", "قرص عند الحاجة، بحد أقصى 4 مرات يوميًا", "", { form: "Tablet" });
  await addDrug(workspace, "Voltaren Gel 1%", "دهان على مكان الألم 3 مرات يوميًا", "14 يوم");
  for (const [index, name] of EXTRA_DRUGS.slice(0, extraDrugs).entries()) {
    await addDrug(workspace, name, "قرص مرة يوميًا بعد الفطار", "30 يوم", index % 3 === 0 ? { form: "Tablet" } : {});
  }

  await workspace.getByRole("button", { name: RX.printButton, exact: true }).click();
  const sheet = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: RX.sheetTitle, exact: true }) });
  await expect(sheet.getByText(RX.previewNote, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("listitem")).toHaveCount(3 + extraDrugs);
  await expect(sheet).toContainText(`${KARIM_AGE} ${RX.ageUnit}`);
  return sheet;
}

test("@screenshot prescription-preview", async ({ page }) => {
  const sheet = await karimPrescriptionPreview(page);
  await sheet.evaluate((element) => element.scrollTo(0, 0));
  await expect.poll(() => sheet.evaluate((element) => element.scrollTop)).toBe(0);
  await shoot(page, "prescription-preview", false);
});

const EXTRA_DRUGS = [
  "Omeprazole 20mg",
  "Vitamin D3 50000 IU",
  "Calcium 600mg",
  "Esomeprazole 40mg",
  "Cetirizine 10mg",
  "Metformin 500mg",
  "Atorvastatin 20mg",
  "Folic Acid 5mg",
  "Magnesium 250mg",
];

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

// Screen 19, the messages page and the send sheet. Three new patients with
// phones booked on the real day by the owner, the clock pinned; messages
// opened at fixed times — ليلى by WhatsApp at 09:00 (then marked sent), سامح
// by SMS at 09:05 with the appointment reminder, نادية by WhatsApp at 09:10
// with the follow-up — and the appointment reminder then overridden by the
// owner and selected. window.open is recorded, never followed; an sms: link
// stays a request the page does not leave for.
const MESSAGE_PATIENTS = [
  { name: "ليلى مراد", phone: "01001234567" },
  { name: "سامح عادل", phone: "01112345678" },
  { name: "نادية فؤاد", phone: "01223456789" },
] as const;

async function bookMessagePatients(page: Page): Promise<(time: ClockTime) => Date> {
  const day = todayInCairo();
  const at = (time: ClockTime) => new Date(cairoInstant(day, time));
  await recordWindowOpen(page);
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  for (const patient of MESSAGE_PATIENTS) {
    await bookNewPatientWithPhone(page, patient.name, patient.phone);
  }
  return at;
}

async function sendFromRow(page: Page, name: string, template: string | null, channel: "whatsapp" | "sms"): Promise<void> {
  const sheet = await openSendSheetFromRow(page, name);
  if (template) {
    await sheet.getByRole("group", { name: MSG.sendTemplateLabel }).getByRole("button", { name: template, exact: true }).click();
  }
  if (channel === "sms") {
    await sheet.getByRole("group", { name: MSG.sendChannelLabel }).getByRole("button", { name: MSG.channelSms, exact: true }).click();
  }
  await sheet.getByRole("button", { name: channel === "sms" ? MSG.openSms : MSG.openWhatsApp, exact: true }).click();
  await expect(sheet).toBeHidden();
}

test("@screenshot messages-page", async ({ page }) => {
  const at = await bookMessagePatients(page);
  await page.clock.setSystemTime(at("09:00"));
  await sendFromRow(page, MESSAGE_PATIENTS[0].name, null, "whatsapp");
  await page.clock.setSystemTime(at("09:05"));
  await sendFromRow(page, MESSAGE_PATIENTS[1].name, "تذكير بالموعد", "sms");
  await page.clock.setSystemTime(at("09:10"));
  await sendFromRow(page, MESSAGE_PATIENTS[2].name, "متابعة بعد الزيارة", "whatsapp");

  await openMessagesPage(page);
  const recent = page.getByRole("region", { name: MSG.recentHeading }).getByRole("listitem");
  await expect(recent).toHaveCount(3);
  await recent.filter({ hasText: MESSAGE_PATIENTS[0].name }).getByRole("button", { name: MSG.statusOpened, exact: true }).click();
  await expect(recent.getByRole("button", { name: MSG.statusSent, exact: true })).toHaveCount(1);

  const templates = page.getByRole("navigation", { name: MSG.templatesHeading });
  await templates.getByRole("button", { name: /تذكير بالموعد/ }).click();
  const reminder = page.getByRole("region", { name: `${MSG.previewPrefix} تذكير بالموعد` });
  await reminder.getByRole("button", { name: MSG.editAction, exact: true }).click();
  await reminder
    .getByLabel(MSG.editorLabel, { exact: true })
    .fill(
      [
        "أهلاً {{patient_name}}،",
        "بنفكّرك بموعدك بكرة الساعة {{time}} مع {{doctor_name}}.",
        "لو هتتأخر كلّمنا: {{clinic_phone}}",
      ].join("\n"),
    );
  await reminder.getByRole("button", { name: MSG.saveAction, exact: true }).click();
  await expect(reminder.getByText(MSG.chipOverridden, { exact: true })).toBeVisible();
  await shoot(page, "messages-page", true);
});

test("@screenshot messages-send-sheet", async ({ page }) => {
  await bookMessagePatients(page);
  const sheet = await openSendSheetFromRow(page, MESSAGE_PATIENTS[0].name);
  await sheet.getByRole("group", { name: MSG.sendTemplateLabel }).getByRole("button", { name: "تذكير جلسة خطة", exact: true }).click();
  await expect(sheet.getByRole("status")).toBeVisible();
  await shoot(page, "messages-send-sheet", false);
});

// The care plan (screen 17) for كريم on a fixed day, so every capture shows
// the same dates: the plan is created from his visit in the room through
// the form, the five sessions before today are written straight into the
// store as visits of past weeks (three of them paid), and the sixth is
// booked from the plan for today at 09:30 — five done, one booked, four
// suggested, as the prototype shows. The sheet is taller than a screen, so
// the window grows to show all of it.
const PLAN_DAY = "2026-10-14";
const planAt = (time: ClockTime) => new Date(cairoInstant(PLAN_DAY, time));
const PLAN_GOAL = "استعادة كامل حركة الركبة اليمنى";
const PLAN_DIAGNOSIS = "التهاب وتر الرضفة";

/** كريم in the room at 09:00 on PLAN_DAY, as the owner, his workspace open. */
async function karimWorkspaceOnPlanDay(page: Page): Promise<ReturnType<Page["getByRole"]>> {
  await page.clock.install({ time: planAt("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");
  await page.clock.setSystemTime(planAt("09:00"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const workspace = page.getByRole("dialog");
  await expect(workspace.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
  return workspace;
}

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
  const workspace = await karimWorkspaceOnPlanDay(page);
  const created = await fillNewPlan(page, workspace, PLAN_GOAL, [
    { service: "فحص شامل", count: "1", gap: "0" },
    { service: "كشف عام", count: "9", gap: "7" },
  ]);
  await created.getByLabel(PLAN.diagnosisField, { exact: true }).fill(PLAN_DIAGNOSIS);
  await created.getByRole("button", { name: PLAN.startAction, exact: true }).click();
  await expect(created.getByRole("heading", { name: PLAN.sessionsHeading, exact: true })).toBeVisible();

  // Sessions 1–5: visits of the five weeks before PLAN_DAY, done; 1–3 paid.
  await syncSettled(page);
  type Stored = Record<string, unknown> & { id: string };
  const visits = await readStore<Stored>(page, "visits");
  const karim = (await readStore<Stored>(page, "patients")).find((patient) => patient.full_name === PATIENTS.karim)!;
  const today = visits.find((visit) => visit.patient_id === karim.id && visit.visit_date === PLAN_DAY)!;
  const items = (await readStore<Stored & { sequence: number; price: number }>(page, "care_plan_items")).sort(
    (a, b) => a.sequence - b.sequence,
  );
  const rows: { store: string; value: unknown }[] = [];
  for (const [index, item] of items.slice(0, 5).entries()) {
    const day = addDaysToClinicDay(PLAN_DAY, -35 + index * 7);
    const at = cairoInstant(day, "09:00");
    const visitId = `plan-visit-${index + 1}`;
    rows.push({
      store: "visits",
      value: {
        ...today,
        id: visitId,
        visit_date: day,
        position: 1,
        scheduled_at: at,
        unique_scheduled_at: at,
        status: "completed",
        service_id: item.service_id,
        arrived_at: at,
        started_at: at,
        ended_at: cairoInstant(day, "09:30"),
        created_at: at,
      },
    });
    rows.push({ store: "care_plan_items", value: { ...item, visit_id: visitId } });
    if (index < 3) {
      const invoiceId = `plan-invoice-${index + 1}`;
      rows.push({
        store: "invoices",
        value: {
          id: invoiceId,
          org_id: today.org_id,
          location_id: today.location_id,
          number: index + 1,
          issued_year: 2026,
          series: 9,
          patient_id: karim.id,
          practitioner_id: today.practitioner_id,
          visit_id: visitId,
          total: item.price,
          paid: item.price,
          status: "paid",
          issued_at: at,
          rev: 1,
        },
      });
      rows.push({
        store: "payments",
        value: {
          id: `plan-payment-${index + 1}`,
          invoice_id: invoiceId,
          location_id: today.location_id,
          amount: item.price,
          method: "cash",
          receipt_number: String(index + 1),
          series: 9,
          note: null,
          after_close: false,
          created_by: today.created_by,
          created_at: at,
          rev: 1,
        },
      });
    }
  }
  await putRows(page, rows);
  await reloadAs(page, { name: OWNER_NAME, pin: OWNER_PIN });

  // Session 6, booked from the plan for today at 09:30.
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(PLAN.badgePrefix) }).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: PLAN.sheetTitle, exact: true }) });
  await expect(sheet.getByText("5 / 10 جلسة", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: PLAN.bookNext, exact: true }).click();
  const booking = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: new RegExp(`^${S.bookingButtonLabel}`) }) });
  await booking.getByRole("button", { name: "09:30", exact: true }).click();
  await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(booking).toBeHidden();
  await expect(sheet.getByText(PLAN.stateNext, { exact: true })).toBeVisible();
  await expect(sheet.getByText(PLAN.stateSuggested, { exact: true })).toHaveCount(4);
  await expect(sheet).toContainText(`${PLAN.paidLabel} 1,100 ج.م`);
  await shootTallSheet(page, sheet, "care-plan-sheet", tallHeight());
});
