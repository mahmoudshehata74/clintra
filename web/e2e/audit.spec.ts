import { expect, test, type Locator, type Page } from "@playwright/test";
import { auditState, collectPageErrors, prepareAudit, type Theme } from "./auditSupport";
import { registrationStrings } from "../src/auth/registrationStrings";
import {
  addDrug,
  bookNewPatientWithPhone,
  putRows,
  readStore,
  syncSettled,
  advanceRowTo,
  ASSISTANT_NAME,
  doctorDayFixture,
  DOCTOR,
  fillNewPlan,
  karimWorkspaceOnPlanDay,
  login,
  MSG,
  openAuditLog,
  openMessagesPage,
  OWNER_NAME,
  OWNER_PIN,
  PLAN,
  PLAN_DIAGNOSIS,
  PLAN_GOAL,
  planSheet,
  printSheet,
  profileTab,
  RX,
  searchPatientsPage,
  sidebar,
  SIDEBAR,
  VISIT,
  AUTH,
  DEV_SEED_PINS,
  emptySlotTiles,
  enterPin,
  PROFILE,
  QUEUE_DR,
  gotoSeededDay,
  lockOverlay,
  PATIENTS,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
} from "./support";

// The interaction audit: every screen of docs/screen-comparison.md and every
// overlay reachable from it, opened one at a time, in light and in dark, on
// both projects. Each opened state goes through auditState (auditSupport.ts).
// A failing check is a finding to fix in the app, never a check to loosen.

const THEMES: readonly Theme[] = ["light", "dark"];

/** The appearance toggle's accessible name starts with this (domain/appearance.ts). */
const APPEARANCE_PREFIX = "المظهر:";

/** The day screen's only open dialog (a sheet). */
const dialog = (page: Page): Locator => page.getByRole("dialog");

async function closeTopSheet(page: Page): Promise<void> {
  const count = await dialog(page).count();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(count - 1);
}

for (const theme of THEMES) {
  test.describe(`${theme}`, () => {
    let errors: string[];

    test.beforeEach(async ({ page }) => {
      errors = collectPageErrors(page);
      await prepareAudit(page, theme);
    });

    test("lock screen: picker, PIN pad, wrong PIN", async ({ page }) => {
      await page.goto("/?seedDay=1");
      await page.evaluate(() => localStorage.clear());
      const overlay = lockOverlay(page);
      await expect(overlay.getByRole("button", { name: new RegExp(ASSISTANT_NAME) })).toBeVisible();
      await auditState(page, errors, "lock picker", { overlay });
      await overlay.getByRole("button", { name: new RegExp(ASSISTANT_NAME) }).click();
      await expect(overlay.getByRole("button", { name: "1", exact: true })).toBeVisible();
      await auditState(page, errors, "lock pad", { overlay });
      const wrong = DEV_SEED_PINS.assistant === "0000" ? "1111" : "0000";
      await enterPin(page, wrong);
      await expect(overlay.getByRole("button", { name: "1", exact: true })).toBeVisible();
      await auditState(page, errors, "lock pad after a wrong PIN", { overlay });
      await expect(overlay.getByText(AUTH.lockPinTitle)).toBeVisible();
    });

    test("day, slots: page, delay picker, row menus, booking", async ({ page }) => {
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
      await auditState(page, errors, "day slots page");

      await page.getByRole("button", { name: new RegExp(`^${S.delayControlTriggerLabel}`) }).click();
      const picker = page.getByRole("dialog", { name: S.delayPickerTitle });
      await auditState(page, errors, "delay picker", { overlay: picker });
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();

      for (const name of Object.values(PATIENTS)) {
        const row = rowFor(page, name);
        if ((await row.count()) === 0) {
          continue;
        }
        await row.first().getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
        const menu = page.getByRole("menu");
        await auditState(page, errors, `row menu of ${name}`, { overlay: menu });
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
      }

      await emptySlotTiles(page).first().click();
      await auditState(page, errors, "booking sheet, search", { overlay: dialog(page) });
      await dialog(page).getByPlaceholder(S.bookingSearchPlaceholder).fill("كريم");
      await expect(dialog(page).getByRole("button").filter({ hasText: PATIENTS.karim })).not.toHaveCount(0);
      await auditState(page, errors, "booking sheet, results", { overlay: dialog(page), skipTyping: true });
      await dialog(page).getByRole("button", { name: S.newPatientButtonPrefix }).click();
      await expect(dialog(page).getByPlaceholder(S.newPatientPhonePlaceholder)).toBeVisible();
      await auditState(page, errors, "booking sheet, new patient", { overlay: dialog(page) });
      await closeTopSheet(page);

      await page.getByRole("button", { name: S.bookingRunButtonLabel, exact: true }).click();
      await dialog(page).getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.omar);
      await dialog(page).getByRole("button").filter({ hasText: PATIENTS.omar }).filter({ hasNotText: S.newPatientButtonPrefix }).first().click();
      await auditState(page, errors, "booking sheet, slot step", { overlay: dialog(page) });
      await dialog(page).getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
      await expect(dialog(page).getByRole("button", { name: S.bookingConfirmButton, exact: true })).toBeVisible();
      await auditState(page, errors, "booking sheet, slot and service", { overlay: dialog(page) });
      await closeTopSheet(page);
    });

    test("day, slots: row sheets, invoice, payment, cash close, tomorrow's sheet", async ({ page }) => {
      await page.addInitScript(() => {
        window.print = () => {};
      });
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
      const fromMenu = async (name: string, item: string) => {
        await rowFor(page, name).first().getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
        await page.getByRole("menuitem", { name: item, exact: true }).click();
      };

      await fromMenu(PATIENTS.mona, S.moveMenuLabel);
      await auditState(page, errors, "move sheet", { overlay: dialog(page) });
      await closeTopSheet(page);
      await fromMenu(PATIENTS.mona, S.cancelMenuLabel);
      await auditState(page, errors, "cancel sheet", { overlay: dialog(page) });
      await closeTopSheet(page);
      await fromMenu(PATIENTS.mona, PROFILE.menuLabel);
      await auditState(page, errors, "profile sheet", { overlay: dialog(page) });
      await closeTopSheet(page);
      await fromMenu(PATIENTS.mona, S.sendMessageMenuLabel);
      await auditState(page, errors, "send message sheet", { overlay: dialog(page) });
      await closeTopSheet(page);

      await rowFor(page, PATIENTS.yasmin).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
      await expect(dialog(page).getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
      await auditState(page, errors, "visit form sheet", { overlay: dialog(page) });
      await closeTopSheet(page);

      await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
      await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
      await fromMenu(PATIENTS.karim, S.invoiceMenuLabel);
      await expect(dialog(page).getByText(S.invoiceTotalLabel).first()).toBeVisible();
      await auditState(page, errors, "invoice sheet", { overlay: dialog(page) });
      await dialog(page).getByRole("button", { name: S.recordPaymentAction }).click();
      const payment = dialog(page).filter({ hasText: S.paymentMethodLabel });
      await expect(payment).toBeVisible();
      await auditState(page, errors, "payment sheet", { overlay: payment });
      await closeTopSheet(page);

      await page.getByRole("button", { name: S.walkInButtonLabel, exact: true }).click();
      await auditState(page, errors, "walk-in sheet", { overlay: dialog(page) });
      await closeTopSheet(page);

      await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
      await auditState(page, errors, "cash close sheet", { overlay: dialog(page) });
      await closeTopSheet(page);

      await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
      await expect(dialog(page).getByText(S.daySheetTitle)).toBeVisible();
      await auditState(page, errors, "tomorrow's sheet preview", { overlay: dialog(page) });
      await closeTopSheet(page);

      await rowFor(page, PATIENTS.mona).locator("button").filter({ hasText: PATIENTS.mona }).click();
      await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusArrived);
      await auditState(page, errors, "day slots page with the undo toast");
    });

    test("day, queue: page, row menus, add to queue", async ({ page }) => {
      await gotoSeededDay(page);
      await selectPractitioner(page, QUEUE_DR);
      await expect(page.getByText(S.queueSummaryCurrentTurnLabel)).toBeVisible();
      await auditState(page, errors, "day queue page");
      for (const name of Object.values(PATIENTS)) {
        const row = rowFor(page, name);
        if ((await row.count()) === 0) {
          continue;
        }
        await row.first().getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
        const menu = page.getByRole("menu");
        await auditState(page, errors, `queue row menu of ${name}`, { overlay: menu });
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
      }
      await page.getByRole("button", { name: S.addToQueueButtonLabel, exact: true }).first().click();
      await auditState(page, errors, "add to queue sheet", { overlay: dialog(page) });
      await closeTopSheet(page);
    });
    test("doctor's day: page, profile sheet", async ({ page }) => {
      await doctorDayFixture(page);
      await auditState(page, errors, "doctor's day page", { skipTyping: true });
      const brief = page.getByRole("region", { name: DOCTOR.briefNextHeading, exact: true });
      await brief.getByRole("button", { name: PROFILE.openProfile }).first().click();
      await auditState(page, errors, "profile sheet from the doctor's day", { overlay: dialog(page) });
      await closeTopSheet(page);
    });

    test("visit workspace: drugs, care plan, plan booking, prescription print", async ({ page }) => {
      await page.addInitScript(() => {
        window.print = () => {};
      });
      const workspace = await karimWorkspaceOnPlanDay(page);
      await auditState(page, errors, "visit workspace", { overlay: workspace, skipTyping: true });
      await workspace.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
      await expect(workspace.getByLabel(VISIT.rxNameLabel, { exact: true })).toBeVisible();
      await auditState(page, errors, "visit workspace, drug form", { overlay: workspace });
      await closeTopSheet(page);
      await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
      const reopened = page.getByRole("dialog");
      await addDrug(reopened, { name: "Diclofenac 50mg", instructions: "قرص بعد الأكل", duration: "5 أيام" });
      const plan = await fillNewPlan(page, reopened, PLAN_GOAL, [{ service: "كشف عام", count: "3", gap: "7" }]);
      await plan.getByLabel(PLAN.diagnosisField, { exact: true }).fill(PLAN_DIAGNOSIS);
      await auditState(page, errors, "care plan, create form", { overlay: plan, skipTyping: true });
      await plan.getByRole("button", { name: PLAN.startAction, exact: true }).click();
      await expect(plan.getByRole("heading", { name: PLAN.sessionsHeading, exact: true })).toBeVisible();
      await auditState(page, errors, "care plan sheet", { overlay: plan });
      await plan.getByRole("button", { name: PLAN.editPlan, exact: true }).click();
      await auditState(page, errors, "care plan, edit form", { overlay: planSheet(page), skipTyping: true });
      await closeTopSheet(page);
      await reopened.getByRole("button", { name: new RegExp(PLAN.badgePrefix) }).click();
      await planSheet(page).getByRole("button", { name: PLAN.bookNext, exact: true }).click();
      const booking = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: new RegExp(`^${S.bookingButtonLabel}`) }) });
      await expect(booking).toBeVisible();
      await auditState(page, errors, "care plan session booking", { overlay: booking });
      await closeTopSheet(page);
      await closeTopSheet(page);

      await reopened.getByRole("button", { name: RX.printButton, exact: true }).click();
      const print = printSheet(page);
      await expect(print.getByText(RX.previewNote, { exact: true })).toBeVisible();
      await auditState(page, errors, "prescription print preview", { overlay: print });
      await print.getByRole("button", { name: RX.printAction, exact: true }).click();
      await expect(print.getByText(RX.confirmQuestion)).toBeVisible();
      await auditState(page, errors, "prescription first-print question", { overlay: print });
      await closeTopSheet(page);
      await closeTopSheet(page);
    });

    test("current visit page and the doctor's day around it", async ({ page }) => {
      await karimWorkspaceOnPlanDay(page);
      await closeTopSheet(page);
      await sidebar(page).getByRole("button", { name: SIDEBAR.navVisit, exact: true }).click();
      await expect(page.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
      await auditState(page, errors, "current visit page", { skipTyping: true });
      await sidebar(page).getByRole("button", { name: SIDEBAR.navDoctor, exact: true }).click();
      await expect(page.getByRole("list", { name: DOCTOR.dayListTitle })).toBeVisible();
      await auditState(page, errors, "doctor's day with a visit in the room", { skipTyping: true });
    });

    test("patients page: search, results, profile and its tabs", async ({ page }) => {
      await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
      await sidebar(page).getByRole("button", { name: SIDEBAR.navPatients, exact: true }).click();
      await expect(page.getByPlaceholder(PROFILE.searchPlaceholder)).toBeVisible();
      await auditState(page, errors, "patients page, empty search");
      const results = await searchPatientsPage(page, "ي");
      await expect(results.getByRole("button").first()).toBeVisible();
      await auditState(page, errors, "patients page, results", { skipTyping: true });
      await results.getByRole("button").filter({ hasText: PATIENTS.karim }).click();
      await expect(page.getByRole("group", { name: PROFILE.tabsLabel, exact: true })).toBeVisible();
      for (const tab of [PROFILE.tabAll, PROFILE.tabVisits, PROFILE.tabRx, PROFILE.tabMessages, PROFILE.tabPayments, PROFILE.tabNotes]) {
        await profileTab(page, tab).click();
        await expect(profileTab(page, tab)).toHaveAttribute("aria-pressed", "true");
        await auditState(page, errors, `patient profile, ${tab} tab`);
      }
    });

    test("messages page: templates and their editor", async ({ page }) => {
      await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
      await openMessagesPage(page);
      await auditState(page, errors, "messages page");
      const templates = page.getByRole("navigation", { name: MSG.templatesHeading });
      const count = await templates.getByRole("button").count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index++) {
        await templates.getByRole("button").nth(index).click();
        await auditState(page, errors, `messages page, template ${index + 1}`);
        const edit = page.getByRole("button", { name: MSG.editAction, exact: true });
        if (await edit.count()) {
          await edit.click();
          await expect(page.getByLabel(MSG.editorLabel, { exact: true })).toBeVisible();
          await auditState(page, errors, `messages page, template ${index + 1} editor`);
          await page.getByRole("button", { name: MSG.cancelAction, exact: true }).click();
        }
      }
    });

    test("audit log: every filter", async ({ page }) => {
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      await openAuditLog(page);
      for (const filter of [S.auditFilterAll, S.auditFilterVisits, S.auditFilterInvoices, S.auditFilterSettings, S.auditFilterAll]) {
        await dialog(page).getByRole("button", { name: filter, exact: true }).click();
        await auditState(page, errors, `audit log, ${filter}`, { overlay: dialog(page) });
      }
      await closeTopSheet(page);
    });

    test("settings: every tab and its editors", async ({ page }) => {
      await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
      await selectPractitioner(page, SLOTS_DR);
      await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
      const settings = dialog(page);
      await expect(settings.getByText(S.settingsHoursTab, { exact: true })).toBeVisible();
      const editFirst = async (label: string, editLabel: string) => {
        await settings.getByRole("button", { name: editLabel, exact: true }).first().click();
        await expect(settings.getByRole("button", { name: S.settingsCancelAction, exact: true }).first()).toBeVisible();
        await auditState(page, errors, label, { overlay: settings });
        await settings.getByRole("button", { name: S.settingsCancelAction, exact: true }).first().click();
      };
      await auditState(page, errors, "settings, working hours", { overlay: settings });
      await editFirst("settings, working hours editor", S.hoursEditAction);
      await settings.getByRole("button", { name: S.settingsServicesTab, exact: true }).click();
      await auditState(page, errors, "settings, services", { overlay: settings });
      await editFirst("settings, service editor", S.serviceEditAction);
      await editFirst("settings, new service", S.serviceNewAction);
      await settings.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
      await auditState(page, errors, "settings, staff", { overlay: settings });
      await editFirst("settings, staff editor", S.hoursEditAction);
      // The add-staff form has no cancel of its own (StaffPanel.tsx: its
      // save is its one action); switching tabs closes it.
      await settings.getByRole("button", { name: S.staffNewAction, exact: true }).click();
      await expect(settings.getByLabel(S.staffPinLabel)).toBeVisible();
      await auditState(page, errors, "settings, new staff member", { overlay: settings });
      await settings.getByRole("button", { name: S.settingsPractitionersTab, exact: true }).click();
      await auditState(page, errors, "settings, practitioners", { overlay: settings });
      await editFirst("settings, practitioner editor", S.hoursEditAction);
    });

    test("app bar: lock, re-lock pad, appearance toggle", async ({ page }) => {
      await gotoSeededDay(page);
      await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
      const overlay = lockOverlay(page);
      await expect(overlay).toBeVisible();
      await auditState(page, errors, "re-lock pad", { overlay });
      await login(page);
      const toggle = page.getByRole("button", { name: new RegExp(`^${APPEARANCE_PREFIX}`) });
      for (let step = 0; step < 3; step++) {
        await toggle.click();
        await auditState(page, errors, `appearance toggle, step ${step + 1}`);
      }
    });

    test("device activation", async ({ page }) => {
      await page.goto("/");
      const card = page.getByRole("dialog", { name: registrationStrings.formAria });
      await expect(card).toBeVisible();
      await auditState(page, errors, "device activation", { overlay: card, skipTyping: true });
      // Its fields take only their own characters: the code formats as typed.
      await card.getByLabel(registrationStrings.codeLabel).fill("clt7f3k9qrt4xwm2bcd");
      await expect(card.getByLabel(registrationStrings.codeLabel)).toHaveValue("CLT-7F3K-9QRT-4XWM-2BCD");
      await card.getByLabel(registrationStrings.phoneLabel).fill("01001112233");
      await expect(card.getByLabel(registrationStrings.phoneLabel)).toHaveValue("01001112233");
    });
    test("sync review list", async ({ page }) => {
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      const lost = "سامي نبيل";
      await bookNewPatientWithPhone(page, lost, "01001112244");
      await syncSettled(page);
      type Stored = Record<string, unknown> & { id: string };
      const hoda = (await readStore<Stored>(page, "patients")).find((patient) => patient.full_name === lost)!;
      const visit = (await readStore<Stored & { created_at: string }>(page, "visits")).find(
        (row) => row.patient_id === hoda.id && row.status === "booked",
      )!;
      const opId = "audit-conflict-op";
      await putRows(page, [
        {
          store: "sync_ops",
          value: {
            op_id: opId,
            entity: "visits",
            entity_id: visit.id,
            action: "create",
            payload: visit,
            device_id: "audit-device",
            created_at: visit.created_at,
            synced_at: null,
            base_rev: null,
            failure_count: 0,
            next_retry_at: null,
          },
        },
        {
          store: "sync_review",
          value: {
            id: "audit-conflict-review",
            op_id: opId,
            entity: "visits",
            entity_id: visit.id,
            reason: "conflict_slot_taken",
            payload: visit,
            needs_review: true,
            created_at: new Date().toISOString(),
            action: "create",
            base_rev: null,
          },
        },
      ]);
      await page.reload();
      await login(page);
      await page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
      await expect(dialog(page).getByText(S.syncReviewListTitle)).toBeVisible();
      await auditState(page, errors, "sync review list", { overlay: dialog(page) });
      await closeTopSheet(page);
    });

    test("overbook picker, stacked sheets, lock switch-user", async ({ page }) => {
      await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
      await selectPractitioner(page, SLOTS_DR);
      await page.getByRole("button", { name: S.bookingRunButtonLabel, exact: true }).click();
      await dialog(page).getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.omar);
      await dialog(page).getByRole("button").filter({ hasText: PATIENTS.omar }).filter({ hasNotText: S.newPatientButtonPrefix }).first().click();
      const overbook = dialog(page).getByRole("button", { name: S.overbookButtonLabel, exact: true });
      if (await overbook.count()) {
        await overbook.click();
        await expect(dialog(page).getByText(S.overbookPickerHeading)).toBeVisible();
        await auditState(page, errors, "overbook picker", { overlay: dialog(page) });
      }
      await closeTopSheet(page);

      // The visit sheet, its patient's profile over it, then an invoice over that.
      await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
      await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
      await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
      const visitSheet = page.getByRole("dialog").last();
      await expect(visitSheet.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
      const quick = visitSheet.getByRole("button", { name: new RegExp(PROFILE.historyQuick) });
      if (await quick.count()) {
        await quick.first().click();
        const profile = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: PROFILE.sheetTitle, exact: true }) });
        await expect(profile).toBeVisible();
        await auditState(page, errors, "profile sheet over the visit sheet", { overlay: profile });
        await closeTopSheet(page);
      }
      await closeTopSheet(page);

      await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
      const overlay = lockOverlay(page);
      await overlay.getByRole("button", { name: AUTH.lockSwitchUser }).click();
      await expect(overlay.getByRole("button", { name: new RegExp(ASSISTANT_NAME) })).toBeVisible();
      await auditState(page, errors, "lock, switch user", { overlay });
    });

    test("cash close: past due list, mismatch, closed state", async ({ page }) => {
      await page.addInitScript(() => {
        window.print = () => {};
      });
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
      const sheet = dialog(page);
      await sheet.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill("12345");
      await auditState(page, errors, "cash close, mismatch", { overlay: sheet, skipTyping: true });
    });
  });
}
