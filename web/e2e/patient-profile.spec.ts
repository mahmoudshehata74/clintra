import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDaysToClinicDay } from "../src/domain/time";
import {
  ASSISTANT_NAME,
  closeSheet,
  DEV_SEED_PINS,
  DOCTOR,
  doctorSection,
  gotoSeededDay,
  karimProfileFixture,
  openDoctorDay,
  openProfileFromSearch,
  openVisitSheet,
  PATIENTS,
  planSheet,
  printSheet,
  PROFILE,
  profileAt,
  PROFILE_DAY,
  profileEvents,
  profileSheet,
  profileTab,
  putRows,
  readStore,
  reloadAs,
  rowFor,
  RX,
  S,
  searchPatientsPage,
  sidebar,
  SIDEBAR,
  syncSettled,
  VISIT,
  visitSheet,
} from "./support";

// Screen 18, the patient profile, as a page (the rail's "المرضى", with
// search) and as a sheet opened from a visit. The history is
// karimProfileFixture's: nine events on four days.

/** An event row in the timeline by its title (`.t`). */
const eventRow = (scope: Page | Locator, title: string) => profileEvents(scope).filter({ hasText: title });

/** A message row by its exact first line. */
const messageRow = (page: Page, line: string) => profileEvents(page).filter({ has: page.getByText(line, { exact: true }) });

/** `.pt-stat.plan`, by its key and value. */
const planStat = (hero: Locator) => hero.getByRole("button", { name: new RegExp(`^${PROFILE.statPlan}\\s*${PROFILE.planOngoing}$`) });

/** The invoice sheet showing `number` — not the profile, whose payment rows name it too. */
const invoiceSheet = (page: Page, number: string) =>
  page
    .getByRole("dialog")
    .filter({ hasText: number })
    .filter({ hasNot: page.getByRole("region", { name: PROFILE.timelineLabel, exact: true }) });

test("the profile's hero, tabs and timeline match the patient's history", async ({ page }) => {
  await karimProfileFixture(page);
  await openProfileFromSearch(page, PATIENTS.karim, PATIENTS.karim);

  const hero = page.getByRole("region", { name: PATIENTS.karim, exact: true });
  await expect(hero.getByRole("heading", { name: `${PATIENTS.karim}34 سنة · ذكر` })).toBeVisible();
  await expect(hero).toContainText("0111 234 5678");
  await expect(hero).toContainText(`${PROFILE.firstVisitLabel} 9 / 9 / 2026`);
  await expect(hero).toContainText(`${PROFILE.statVisits}3`);
  await expect(planStat(hero)).toBeVisible();
  await expect(hero).toContainText(`${PROFILE.statBalance}150`);

  // Each tab filters to its kind, its count the rows it shows.
  const expected: [string, number][] = [
    [PROFILE.tabAll, 9],
    [PROFILE.tabVisits, 4],
    [PROFILE.tabRx, 1],
    [PROFILE.tabMessages, 1],
    [PROFILE.tabPayments, 2],
    [PROFILE.tabNotes, 1],
  ];
  for (const [label, count] of expected) {
    const tab = profileTab(page, label);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    await expect(tab).toHaveText(`${label}${count}`);
    await expect(profileEvents(page)).toHaveCount(count);
  }
  await expect(eventRow(page, PROFILE.noteTitle)).toContainText("تحسن ملحوظ في ثني الركبة");

  await profileTab(page, PROFILE.tabAll).click();
  const timeline = page.getByRole("region", { name: PROFILE.timelineLabel, exact: true });
  await expect(timeline.getByRole("heading")).toHaveText([
    "12 أكتوبر · قبل يومين",
    "7 أكتوبر · قبل 7 أيام",
    "30 سبتمبر · قبل أسبوعين",
    `9 سبتمبر · قبل 5 أسابيع · ${PROFILE.planStartSuffix}`,
  ]);
  await expect(eventRow(page, "جلسة كشف عام · 1 من 3")).toContainText("التهاب وتر الرضفة · شكوى: ألم في الركبة اليمنى · وصف دوائين");
  await expect(eventRow(page, "زيارة — خشونة بسيطة")).toBeVisible();
  await expect(eventRow(page, `${PROFILE.rxTitle} · دوائين`)).toContainText(`Diclofenac 50mg، Paracetamol 500mg · ${PROFILE.rxPrinted}`);
  await expect(eventRow(page, "متابعة بعد الزيارة · واتساب")).toContainText(PROFILE.msgSent);
  await expect(eventRow(page, "دفعة · 100 ج.م فيزا")).toContainText("فاتورة INV-2026-0002 · سارة حسن");

  // A cancelled visit reads muted: the field surface instead of the card.
  const cancelled = eventRow(page, `${PROFILE.visitTitle} — ${S.statusCancelled}`).getByRole("button");
  const completed = eventRow(page, "زيارة — خشونة بسيطة").getByRole("button");
  await expect(cancelled).toHaveCSS("background-color", "rgb(246, 249, 247)");
  await expect(completed).toHaveCSS("background-color", "rgb(255, 255, 255)");

  // The plan stat opens the plan.
  await planStat(hero).click();
  await expect(planSheet(page).getByText("1 / 3 جلسة", { exact: true })).toBeVisible();
  await closeSheet(planSheet(page));
});

test("tapping a visit, a prescription or a payment opens its sheet", async ({ page }) => {
  await karimProfileFixture(page);
  await openProfileFromSearch(page, PATIENTS.karim, PATIENTS.karim);

  await eventRow(page, "زيارة — خشونة بسيطة").getByRole("button").click();
  const visit = visitSheet(page);
  await expect(visit.getByPlaceholder(S.visitFormComplaintPlaceholder)).toHaveValue("تيبس الصبح");
  await closeSheet(visit);

  await eventRow(page, `${PROFILE.rxTitle} · دوائين`).getByRole("button").click();
  const print = printSheet(page);
  await expect(print.getByText(RX.previewNote)).toBeVisible();
  await expect(print).toContainText("Diclofenac 50mg");
  await closeSheet(print);

  await eventRow(page, "دفعة · 100 ج.م فيزا").getByRole("button").click();
  const invoice = invoiceSheet(page, "INV-2026-0002");
  await expect(invoice.getByRole("button", { name: `${S.recordPaymentAction} (150 ${S.tileCurrencyUnit})`, exact: true })).toBeVisible();
  await closeSheet(invoice);

  // A message opens nothing.
  await expect(eventRow(page, "متابعة بعد الزيارة · واتساب").getByRole("button")).toHaveCount(0);
});

test("the workspace's quick buttons, the day's menu and the doctor's day open the profile sheet", async ({ page }) => {
  await karimProfileFixture(page);

  const workspace = await openVisitSheet(page);
  await workspace.getByRole("button", { name: PROFILE.historyQuick, exact: true }).click();
  let sheet = profileSheet(page);
  await expect(profileTab(sheet, PROFILE.tabVisits)).toHaveAttribute("aria-pressed", "true");
  await expect(profileEvents(sheet)).toHaveCount(4);
  await closeSheet(sheet);

  await workspace.getByRole("button", { name: PROFILE.invoicesQuick, exact: true }).click();
  sheet = profileSheet(page);
  await expect(profileTab(sheet, PROFILE.tabPayments)).toHaveAttribute("aria-pressed", "true");
  await expect(profileEvents(sheet)).toHaveCount(2);
  // A payment opened from the sheet stacks its invoice above it.
  await eventRow(sheet, "دفعة · 300 ج.م كاش").getByRole("button").click();
  const invoice = invoiceSheet(page, "INV-2026-0001");
  await expect(invoice.getByText(S.invoiceStatusPaid, { exact: true })).toBeVisible();
  await closeSheet(invoice);
  await expect(sheet).toBeVisible();
  await closeSheet(sheet);
  await closeSheet(workspace);

  const row = rowFor(page, PATIENTS.karim);
  await row.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: PROFILE.menuLabel, exact: true }).click();
  sheet = profileSheet(page);
  await expect(profileTab(sheet, PROFILE.tabAll)).toHaveAttribute("aria-pressed", "true");
  await expect(profileEvents(sheet)).toHaveCount(9);
  await closeSheet(sheet);

  // The doctor's day: the next patient's "افتح الملف".
  await page.clock.setSystemTime(new Date(profileAt(PROFILE_DAY, "09:10")));
  await page.getByRole("button", { name: S.bookingRunButtonLabel, exact: true }).click();
  const booking = page.getByRole("dialog");
  await booking.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await booking.getByRole("button").filter({ hasText: PATIENTS.mona }).filter({ hasNotText: S.newPatientButtonPrefix }).first().click();
  await booking.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(booking).toBeHidden();
  await openDoctorDay(page);
  // The next patient's brief (a booked row in "كل اليوم" has its own "افتح الملف").
  await doctorSection(page, DOCTOR.briefNextHeading).getByRole("button", { name: PROFILE.openProfile, exact: true }).click();
  sheet = profileSheet(page);
  await expect(sheet.getByRole("heading", { name: new RegExp(`^${PATIENTS.mona}`) })).toBeVisible();
  await closeSheet(sheet);
});

test("the assistant finds a patient by name and by phone, and pages through a long history", async ({ page }) => {
  await gotoSeededDay(page);
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navPatients, exact: true })).toBeVisible();

  // Before anything is typed, and with no match.
  await sidebar(page).getByRole("button", { name: SIDEBAR.navPatients, exact: true }).click();
  await expect(page.getByText(PROFILE.searchPrompt, { exact: true })).toBeVisible();
  let results = await searchPatientsPage(page, "زززز");
  await expect(page.getByText(PROFILE.searchNoMatch, { exact: true })).toBeVisible();
  await expect(results).toHaveCount(0);

  // منى with a phone and 120 messages, written straight into the store.
  await syncSettled(page);
  type Stored = Record<string, unknown> & { id: string };
  const mona = (await readStore<Stored>(page, "patients")).find((patient) => patient.full_name === PATIENTS.mona)!;
  const visit = (await readStore<Stored>(page, "visits"))[0];
  const firstDay = addDaysToClinicDay(PROFILE_DAY, -200);
  await putRows(page, [
    { store: "patients", value: { ...mona, phone: "+201001234567" } },
    ...Array.from({ length: 120 }, (_, index) => {
      const at = profileAt(addDaysToClinicDay(firstDay, index), "12:00");
      return {
        store: "messages",
        value: {
          id: `paging-message-${index}`,
          org_id: visit.org_id,
          location_id: visit.location_id,
          patient_id: mona.id,
          visit_id: null,
          template_key: "custom",
          channel: "sms",
          phone: "+201001234567",
          body: `رسالة رقم ${index + 1}`,
          attempted_at: at,
          marked_sent_at: null,
          created_by: visit.created_by,
          created_at: at,
          rev: 1,
        },
      };
    }),
  ]);
  await reloadAs(page, { name: ASSISTANT_NAME, pin: DEV_SEED_PINS.assistant });

  // By phone, in the local form; the row shows it the same way.
  results = await searchPatientsPage(page, "0100 123 4567");
  await expect(results.getByRole("button")).toHaveCount(1);
  await expect(results.getByRole("button")).toContainText(PATIENTS.mona);
  await expect(results.getByRole("button")).toContainText("0100 123 4567");

  // By name, then open it.
  await openProfileFromSearch(page, "منى", PATIENTS.mona);
  await profileTab(page, PROFILE.tabMessages).click();
  await expect(profileTab(page, PROFILE.tabMessages)).toHaveText(`${PROFILE.tabMessages}120`);
  await expect(profileEvents(page)).toHaveCount(100);
  await expect(messageRow(page, "رسالة رقم 120")).toBeVisible();
  await expect(messageRow(page, "رسالة رقم 20")).toHaveCount(0);
  await page.getByRole("button", { name: PROFILE.showOlder, exact: true }).click();
  await expect(profileEvents(page)).toHaveCount(120);
  await expect(messageRow(page, "رسالة رقم 1")).toBeVisible();
  await expect(page.getByRole("button", { name: PROFILE.showOlder, exact: true })).toBeHidden();

  // Back to the results.
  await page.getByRole("button", { name: PROFILE.backToSearch, exact: true }).click();
  await expect(page.getByRole("list", { name: PROFILE.resultsLabel, exact: true })).toContainText(PATIENTS.mona);
});

test("the profile is visible to the visit's sheet stack and closes back to it", async ({ page }) => {
  await karimProfileFixture(page);
  const workspace = await openVisitSheet(page);
  await workspace.getByRole("button", { name: PROFILE.historyQuick, exact: true }).click();
  await expect(profileSheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profileSheet(page)).toBeHidden();
  await expect(workspace.getByRole("button", { name: VISIT.saveAndContinueLater, exact: true })).toBeVisible();
});
