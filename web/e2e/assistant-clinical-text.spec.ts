import { expect, test, type Page } from "@playwright/test";
import {
  ASSISTANT_NAME,
  closeSheet,
  DEV_SEED_PINS,
  karimProfileFixture,
  openProfileFromSearch,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  planSheet,
  PROFILE,
  profileEvents,
  profileTab,
  reloadAs,
  S,
} from "./support";

// What the front desk reads of a patient's history (domain/clinicalAccess.ts):
// karimProfileFixture's history, read by the seeded assistant and by the
// doctor (the owner in v1). The assistant sees each visit and prescription
// with its date, doctor and status only; the doctor sees everything.

/** Clinical text karimProfileFixture's history carries: complaints, diagnoses, drugs and the doctor's note. */
const CLINICAL_TEXT = [
  "التهاب وتر الرضفة",
  "خشونة بسيطة",
  "ألم في الركبة اليمنى",
  "تيبس الصبح",
  "Diclofenac",
  "Paracetamol",
  "تحسن ملحوظ في ثني الركبة",
];

const timeline = (page: Page) => page.getByRole("region", { name: PROFILE.timelineLabel, exact: true });
const eventRow = (page: Page, title: string) => profileEvents(page).filter({ hasText: title });

/** The plan stat (`.pt-stat.plan`) on the profile's hero. */
const planStat = (page: Page) =>
  page
    .getByRole("region", { name: PATIENTS.karim, exact: true })
    .getByRole("button", { name: new RegExp(`^${PROFILE.statPlan}\\s*${PROFILE.planOngoing}$`) });

test("the assistant reads the profile's visits and prescription with date, doctor and status only", async ({ page }) => {
  await karimProfileFixture(page);
  await reloadAs(page, { name: ASSISTANT_NAME, pin: DEV_SEED_PINS.assistant });
  await openProfileFromSearch(page, PATIENTS.karim, PATIENTS.karim);

  // Every event but the doctor's note: four visits (three completed, one cancelled), the prescription, a message, two payments.
  await expect(profileTab(page, PROFILE.tabAll)).toHaveText(`${PROFILE.tabAll}8`);
  await expect(profileTab(page, PROFILE.tabNotes)).toHaveText(`${PROFILE.tabNotes}0`);
  await expect(profileEvents(page)).toHaveCount(8);

  const completed = eventRow(page, `${PROFILE.visitTitle} — ${PROFILE.visitCompletedStatus}`);
  await expect(completed).toHaveCount(3);
  // Each names its doctor (the fixture's past visits belong to both seeded doctors).
  for (const row of await completed.all()) {
    await expect(row).toContainText(/د\. (أحمد المصري|سلمى إبراهيم)/);
  }
  await expect(eventRow(page, `${PROFILE.visitTitle} — ${S.statusCancelled}`)).toBeVisible();
  const rx = profileEvents(page).filter({ has: page.getByText(PROFILE.rxTitle, { exact: true }) });
  await expect(rx).toContainText(/د\. \S.* · /);
  await expect(rx).toContainText(PROFILE.rxPrinted);

  for (const text of CLINICAL_TEXT) {
    await expect(timeline(page)).not.toContainText(text);
  }
  // A visit or prescription opens nothing for the front desk; a payment still opens its invoice.
  await expect(completed.getByRole("button")).toHaveCount(0);
  await expect(rx.getByRole("button")).toHaveCount(0);
  await expect(eventRow(page, "دفعة · 100 ج.م فيزا").getByRole("button")).toHaveCount(1);

  // The plan opens without its diagnosis.
  await planStat(page).click();
  const plan = planSheet(page);
  await expect(plan.getByText("1 / 3 جلسة", { exact: true })).toBeVisible();
  await expect(plan).toContainText("استعادة كامل حركة الركبة");
  await expect(plan).not.toContainText("التهاب وتر الرضفة");
  await closeSheet(plan);
});

test("the doctor reads the same profile in full", async ({ page }) => {
  await karimProfileFixture(page);
  await reloadAs(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await openProfileFromSearch(page, PATIENTS.karim, PATIENTS.karim);

  await expect(profileTab(page, PROFILE.tabAll)).toHaveText(`${PROFILE.tabAll}9`);
  await expect(profileTab(page, PROFILE.tabNotes)).toHaveText(`${PROFILE.tabNotes}1`);
  for (const text of CLINICAL_TEXT) {
    await expect(timeline(page)).toContainText(text);
  }
  await expect(eventRow(page, `${PROFILE.rxTitle} · دوائين`).getByRole("button")).toHaveCount(1);

  await planStat(page).click();
  const plan = planSheet(page);
  await expect(plan).toContainText("التهاب وتر الرضفة");
  await closeSheet(plan);
});
