import { expect, test, type Page } from "@playwright/test";
import { cairoInstant, todayInCairo, type ClockTime } from "../src/domain/time";
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
  SLOTS_DR,
  QUEUE_DR,
} from "./support";
import { registrationStrings } from "../src/auth/registrationStrings";
import { galleryStrings } from "../src/gallery/strings";

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
async function shoot(page: Page, surface: string, fullPage: boolean): Promise<void> {
  const project = test.info().project.name;
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
// and stepped forward so the wall-clock figures read like a real morning:
// منى seen 09:00–09:18 (diagnosis filled; her invoice still unpaid — the one
// attention item), كريم arrived 09:05 and waiting past the alert line,
// ياسمين (a seeded past visit) called in at 09:42, عمر booked for later.
// Every visit is built through the app's own write paths.
test("@screenshot doctor-day", async ({ page }) => {
  const day = todayInCairo();
  const at = (time: ClockTime) => new Date(cairoInstant(day, time));
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  for (const name of [PATIENTS.mona, PATIENTS.karim, PATIENTS.yasmin, PATIENTS.omar]) {
    await bookFirstOpenSlot(page, name);
  }

  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.mona, S.statusArrived);
  await advanceRowTo(page, PATIENTS.mona, S.statusInRoom);
  await page.clock.setSystemTime(at("09:05"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await page.clock.setSystemTime(at("09:18"));
  await advanceRowTo(page, PATIENTS.mona, S.statusCompleted);
  await rowFor(page, PATIENTS.mona).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByPlaceholder(S.visitFormDiagnosisPlaceholder).fill("التهاب حلق");
  await form.getByPlaceholder(S.visitFormDiagnosisPlaceholder).blur();
  await expect(form.getByText(S.visitFormSavedIndicator)).toBeVisible();
  await form.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(form).toBeHidden();
  await page.clock.setSystemTime(at("09:30"));
  await advanceRowTo(page, PATIENTS.yasmin, S.statusArrived);
  await page.clock.setSystemTime(at("09:42"));
  await advanceRowTo(page, PATIENTS.yasmin, S.statusInRoom);

  await openDoctorDay(page);
  await expect(doctorSection(page, DOCTOR.heroLabel)).toContainText(PATIENTS.yasmin);
  await expect(doctorSection(page, DOCTOR.waitingHeading)).toContainText(DOCTOR.waitingAboveThreshold);
  await expect(doctorSection(page, DOCTOR.attentionHeading).getByRole("listitem")).toHaveCount(1);
  await shoot(page, "doctor-day", true);
});
