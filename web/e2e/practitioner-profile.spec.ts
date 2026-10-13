import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addDrug,
  AUTH,
  closeSheet,
  gotoSeededDay,
  karimInRoom,
  lockOverlay,
  login,
  openAuditLog,
  openPrintSheet,
  openVisitSheet,
  OWNER_NAME,
  OWNER_PIN,
  QUEUE_DR,
  RX,
  S,
  selectPractitioner,
  sidebar,
  SIDEBAR,
  SLOTS_DR,
} from "./support";

// The "الأطباء" settings tab (db/practitioners.ts, PractitionersPanel.tsx):
// the owner edits each practitioner's name, title and syndicate number, and
// the printed prescription shows the syndicate number.

const NEW_NAME = "أحمد محمود المصري";
const NEW_TITLE = "استشاري العلاج الطبيعي";
const SYNDICATE = "12345";
// domain/auditVerb.ts's verb for a practitioner profile edit.
const PROFILE_VERB = "عدّل بيانات الطبيب";

async function openPractitionersTab(page: Page): Promise<Locator> {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsPractitionersTab, exact: true }).click();
  await expect(settings.getByRole("button", { name: S.settingsPractitionersTab, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  return settings;
}

const practitionerRow = (settings: Locator, name: string) =>
  settings.getByRole("listitem").filter({ hasText: name });

interface Profile {
  name?: string;
  title?: string;
  syndicate?: string;
}

/** Opens a row's editor, fills what is given, and returns the row. Does not save. */
async function editRow(settings: Locator, name: string, profile: Profile): Promise<Locator> {
  const row = practitionerRow(settings, name);
  await row.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await expect(row.getByLabel(S.practitionerNameLabel, { exact: true })).toHaveValue(name);
  if (profile.name !== undefined) await row.getByLabel(S.practitionerNameLabel, { exact: true }).fill(profile.name);
  if (profile.title !== undefined) await row.getByLabel(S.practitionerTitleLabel, { exact: true }).fill(profile.title);
  if (profile.syndicate !== undefined) {
    await row.getByLabel(S.practitionerSyndicateLabel, { exact: true }).fill(profile.syndicate);
  }
  return row;
}

async function saveRow(row: Locator): Promise<void> {
  await row.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(row.getByRole("button", { name: S.hoursEditAction, exact: true })).toBeVisible();
}

async function relogAsOwner(page: Page): Promise<void> {
  await page.reload();
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
}

test("the owner edits name, title and syndicate number; it persists, prints, and clears", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await karimInRoom(page);
  let workspace = await openVisitSheet(page);
  await addDrug(workspace, { name: "Ibuprofen 400mg", instructions: "قرص بعد الأكل عند الألم" });
  await closeSheet(workspace);

  let settings = await openPractitionersTab(page);
  let row = practitionerRow(settings, SLOTS_DR);
  // Seed: "طبيب عام", no syndicate number.
  await expect(row).toContainText("طبيب عام");
  await expect(row.getByText(S.practitionerNoSyndicate, { exact: true })).toBeVisible();

  row = await editRow(settings, SLOTS_DR, { name: NEW_NAME, title: NEW_TITLE, syndicate: SYNDICATE });
  await expect(row.getByLabel(S.practitionerSyndicateLabel, { exact: true })).toHaveAttribute("dir", "ltr");
  await row.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  // Renamed: the row is now found by its new name.
  row = practitionerRow(settings, NEW_NAME);
  await expect(row.getByRole("button", { name: S.hoursEditAction, exact: true })).toBeVisible();
  await expect(row).toContainText(NEW_TITLE);
  await expect(row).toContainText(`${S.practitionerSyndicatePrefix} ${SYNDICATE}`);
  await expect(row.getByText(S.practitionerNoSyndicate)).toHaveCount(0);

  // Survives a reload.
  await relogAsOwner(page);
  settings = await openPractitionersTab(page);
  row = practitionerRow(settings, NEW_NAME);
  await expect(row).toContainText(NEW_TITLE);
  await expect(row).toContainText(`${S.practitionerSyndicatePrefix} ${SYNDICATE}`);
  await closeSheet(settings);

  // The printed prescription's `.doc-spec` line.
  await selectPractitioner(page, NEW_NAME);
  workspace = await openVisitSheet(page);
  let preview = await openPrintSheet(page, workspace, RX.printButton);
  await expect(preview.getByText(`${RX.doctorPrefix} ${NEW_NAME}`, { exact: true })).toBeVisible();
  await expect(preview.getByText(`${NEW_TITLE} · ${RX.syndicatePrefix} ${SYNDICATE}`, { exact: true })).toBeVisible();
  await closeSheet(preview);
  await closeSheet(workspace);

  // Clearing the number hides it; the title stays.
  settings = await openPractitionersTab(page);
  row = await editRow(settings, NEW_NAME, { syndicate: "" });
  await saveRow(row);
  await expect(row.getByText(S.practitionerNoSyndicate, { exact: true })).toBeVisible();
  await closeSheet(settings);
  workspace = await openVisitSheet(page);
  preview = await openPrintSheet(page, workspace, RX.printButton);
  await expect(preview.getByText(NEW_TITLE, { exact: true })).toBeVisible();
  await expect(preview.getByText(RX.syndicatePrefix)).toHaveCount(0);
  await closeSheet(preview);
  await closeSheet(workspace);

  // Two edits on record, under the settings filter, and no field value in either line.
  await openAuditLog(page);
  const audit = page.getByRole("dialog");
  await audit.getByRole("button", { name: S.auditFilterEntitySettings, exact: true }).click();
  await expect(audit.getByText(PROFILE_VERB, { exact: true })).toHaveCount(2);
  await expect(audit).not.toContainText(SYNDICATE);
  await expect(audit).not.toContainText(NEW_TITLE);
  await audit.getByRole("button", { name: S.auditFilterEntityVisits, exact: true }).click();
  await expect(audit.getByText(PROFILE_VERB, { exact: true })).toHaveCount(0);
});

test("an empty name shows the validation message and saves nothing", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  const settings = await openPractitionersTab(page);
  const row = await editRow(settings, QUEUE_DR, { name: "   ", syndicate: SYNDICATE });
  await row.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(row.getByText(S.practitionerNameRequiredError, { exact: true })).toBeVisible();
  await expect(row.getByLabel(S.practitionerNameLabel, { exact: true })).toHaveAttribute("aria-invalid", "true");

  await row.getByRole("button", { name: S.settingsCancelAction, exact: true }).click();
  await expect(row.getByRole("button", { name: S.hoursEditAction, exact: true })).toBeVisible();
  await expect(row.getByText(S.practitionerNoSyndicate, { exact: true })).toBeVisible();
  await closeSheet(settings);

  await relogAsOwner(page);
  const reopened = await openPractitionersTab(page);
  await expect(practitionerRow(reopened, QUEUE_DR).getByText(S.practitionerNoSyndicate, { exact: true })).toBeVisible();
});

test("cancel discards the edit", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  const settings = await openPractitionersTab(page);
  const row = await editRow(settings, QUEUE_DR, { title: NEW_TITLE, syndicate: SYNDICATE });
  await row.getByRole("button", { name: S.settingsCancelAction, exact: true }).click();

  await expect(row.getByRole("button", { name: S.hoursEditAction, exact: true })).toBeVisible();
  await expect(row).toContainText("طبيبة عامة");
  await expect(row).not.toContainText(NEW_TITLE);
  await expect(row.getByText(S.practitionerNoSyndicate, { exact: true })).toBeVisible();

  // Reopening starts from what is stored, not from the discarded entry.
  await row.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await expect(row.getByLabel(S.practitionerTitleLabel, { exact: true })).toHaveValue("طبيبة عامة");
  await expect(row.getByLabel(S.practitionerSyndicateLabel, { exact: true })).toHaveValue("");
  await expect(row.getByLabel(S.practitionerTitleLabel, { exact: true })).toHaveAttribute(
    "placeholder",
    S.practitionerTitlePlaceholder,
  );
});

test("the assistant can never reach the practitioners tab", async ({ page }) => {
  await gotoSeededDay(page); // the assistant
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: S.settingsButtonLabel, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: S.settingsPractitionersTab, exact: true })).toHaveCount(0);

  // Switching to the owner on the same device brings it back.
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  const settings = await openPractitionersTab(page);
  await expect(practitionerRow(settings, SLOTS_DR)).toBeVisible();
  await expect(practitionerRow(settings, QUEUE_DR)).toBeVisible();
});
