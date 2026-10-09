import { expect, test, type Page } from "@playwright/test";
import { cairoInstant, todayInCairo, type ClockTime } from "../src/domain/time";
import {
  advanceRowTo,
  AUTH,
  bookFirstOpenSlot,
  DOCTOR,
  doctorSection,
  gotoRealDay,
  login,
  lockOverlay,
  openAuditLog,
  openDoctorDay,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  rowFor,
  S,
  SIDEBAR,
  selectPractitioner,
  sidebar,
  SLOTS_DR,
} from "./support";

// The doctor's day shows today, and its waits/lateness are wall-clock
// figures — so these run on the REAL day (gotoRealDay, no ?seedDay), with
// the page clock pinned to a morning before the seeded slots schedule
// (09:00–14:00) opens, so every slot is still bookable. Visits are built
// through the app's own write paths: the booking sheet, then the day
// screen's one-tap row advances. The seeded owner is the slots-mode
// practitioner (أحمد المصري), so the doctor's day is his.
const TODAY = todayInCairo();
const at = (time: ClockTime) => new Date(cairoInstant(TODAY, time));

async function startAsOwner(page: Page): Promise<void> {
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
}

async function backToDay(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navDay, exact: true }).click();
  await expect(page.getByRole("button", { name: SLOTS_DR, exact: true })).toBeVisible();
}

const hero = (page: Page) => doctorSection(page, DOCTOR.heroLabel);
const brief = (page: Page) => doctorSection(page, DOCTOR.briefNextHeading);
const waitingRoom = (page: Page) => doctorSection(page, DOCTOR.waitingHeading);
const attention = (page: Page) => doctorSection(page, DOCTOR.attentionHeading);
const dayList = (page: Page) => page.getByRole("list", { name: DOCTOR.dayListTitle });

/** منى and كريم booked and arrived, in that slot order; nobody in the room. */
async function twoWaiting(page: Page): Promise<void> {
  await startAsOwner(page);
  await bookFirstOpenSlot(page, PATIENTS.mona);
  await bookFirstOpenSlot(page, PATIENTS.karim);
  await advanceRowTo(page, PATIENTS.mona, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await openDoctorDay(page);
}

test("the doctor's day is in the rail for the owner, who has a practitioner, and not for the assistant", async ({
  page,
}) => {
  await gotoRealDay(page);
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navDay, exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navDoctor, exact: true })).toHaveCount(0);

  // Lock, then switch to the owner from the re-lock pad.
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navDoctor, exact: true })).toBeVisible();

  await openDoctorDay(page);
  await expect(page.getByRole("heading", { level: 1, name: DOCTOR.appBarTitle })).toBeAttached();
  await expect(page.getByRole("banner")).toContainText(SLOTS_DR);
});

test("calling the next patient puts them in the hero and takes them out of the waiting room", async ({ page }) => {
  await twoWaiting(page);
  await expect(hero(page)).toContainText(DOCTOR.heroEmpty);
  await expect(waitingRoom(page).getByRole("listitem")).toHaveCount(2);
  await expect(brief(page)).toContainText(PATIENTS.mona);
  await expect(brief(page)).toContainText(DOCTOR.briefTagArrived);

  await brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true }).click();
  await expect(hero(page)).toContainText(PATIENTS.mona);
  await expect(hero(page)).toContainText(DOCTOR.heroLabel);
  await expect(waitingRoom(page).getByRole("listitem")).toHaveCount(1);
  await expect(waitingRoom(page)).not.toContainText(PATIENTS.mona);
  await expect(waitingRoom(page)).toContainText(PATIENTS.karim);
});

test("calling in is disabled, with its reason shown, while someone is in the room", async ({ page }) => {
  await twoWaiting(page);
  await brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true }).click();
  await expect(hero(page)).toContainText(PATIENTS.mona);

  const briefCall = brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true });
  await expect(brief(page)).toContainText(PATIENTS.karim);
  await expect(briefCall).toBeDisabled();
  await expect(brief(page).getByText(DOCTOR.callInBlockedReason)).toBeVisible();

  const karimRow = dayList(page).getByRole("listitem").filter({ hasText: PATIENTS.karim });
  await expect(karimRow.getByRole("button", { name: DOCTOR.callInShort, exact: true })).toBeDisabled();
  await expect(karimRow.getByText(DOCTOR.callInBlockedReason)).toBeVisible();
});

test("the quick note saves, survives a reload, and is audited without its text", async ({ page }) => {
  await twoWaiting(page);
  await brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true }).click();
  await expect(hero(page)).toContainText(PATIENTS.mona);

  const note = hero(page).getByPlaceholder(DOCTOR.quickNotePlaceholder);
  const save = hero(page).getByRole("button", { name: DOCTOR.quickNoteSave, exact: true });
  await expect(save).toBeDisabled();
  await note.fill("حساسية من البنسلين");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(hero(page).getByText(DOCTOR.quickNoteSaved)).toBeVisible();
  await expect(save).toBeDisabled();

  // Typing again clears the saved status.
  await note.fill("حساسية من البنسلين.");
  await expect(hero(page).getByText(DOCTOR.quickNoteSaved)).toHaveCount(0);
  await note.fill("حساسية من البنسلين");
  await expect(save).toBeDisabled();

  await page.reload();
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await openDoctorDay(page);
  await expect(hero(page).getByPlaceholder(DOCTOR.quickNotePlaceholder)).toHaveValue("حساسية من البنسلين");

  await openAuditLog(page);
  const auditDialog = page.getByRole("dialog");
  await expect(auditDialog.getByText("عدّل ملاحظة الزيارة").first()).toBeVisible();
  await expect(auditDialog).not.toContainText("حساسية من البنسلين");
});

test("unsaved note text survives the idle lock", async ({ page }) => {
  await twoWaiting(page);
  await brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true }).click();
  await expect(hero(page)).toContainText(PATIENTS.mona);

  await hero(page).getByPlaceholder(DOCTOR.quickNotePlaceholder).fill("نص لسه ما اتحفظش");
  await page.clock.fastForward(10 * 60_000 + 1_000);
  await expect(lockOverlay(page)).toBeVisible();
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await expect(hero(page).getByPlaceholder(DOCTOR.quickNotePlaceholder)).toHaveValue("نص لسه ما اتحفظش");
  await expect(hero(page).getByRole("button", { name: DOCTOR.quickNoteSave, exact: true })).toBeEnabled();
});

test("closing the visit shows it as completed in the full day list", async ({ page }) => {
  await twoWaiting(page);
  await brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true }).click();
  await expect(hero(page)).toContainText(PATIENTS.mona);

  await hero(page).getByRole("button", { name: DOCTOR.heroCloseVisit, exact: true }).click();
  await expect(hero(page)).toContainText(DOCTOR.heroEmpty);
  const monaRow = dayList(page).getByRole("listitem").filter({ hasText: PATIENTS.mona });
  await expect(monaRow).toContainText(DOCTOR.dayListFinishedAt);
  await expect(monaRow.getByRole("button", { name: DOCTOR.dayListReview, exact: true })).toBeVisible();
});

test("a completed visit with no diagnosis is in the attention card, and its button opens the visit form", async ({
  page,
}) => {
  await twoWaiting(page);
  await expect(attention(page)).toHaveCount(0);

  await brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true }).click();
  await expect(hero(page)).toContainText(PATIENTS.mona);
  await hero(page).getByRole("button", { name: DOCTOR.heroCloseVisit, exact: true }).click();
  await expect(hero(page)).toContainText(DOCTOR.heroEmpty);

  const item = attention(page).getByRole("listitem").filter({ hasText: DOCTOR.attentionMissingDiagnosisTitle });
  await expect(item).toContainText(PATIENTS.mona);
  await item.getByRole("button", { name: DOCTOR.attentionCompleteNow, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByPlaceholder(S.visitFormDiagnosisPlaceholder)).toBeVisible();
  await expect(dialog).toContainText(PATIENTS.mona);

  await dialog.getByPlaceholder(S.visitFormDiagnosisPlaceholder).fill("نزلة برد");
  await dialog.getByPlaceholder(S.visitFormDiagnosisPlaceholder).blur();
  await expect(dialog.getByText(S.visitFormSavedIndicator)).toBeVisible();
  await dialog.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  // The diagnosis is in; only the unpaid invoice remains, with no button.
  await expect(attention(page).getByRole("listitem").filter({ hasText: DOCTOR.attentionMissingDiagnosisTitle })).toHaveCount(0);
  const invoiceItem = attention(page).getByRole("listitem").filter({ hasText: DOCTOR.attentionInvoicePrefix });
  await expect(invoiceItem).toContainText(DOCTOR.invoiceUnpaid);
  await expect(invoiceItem.getByRole("button")).toHaveCount(0);
});

test("the attention card is absent when there is nothing to show", async ({ page }) => {
  await startAsOwner(page);
  await bookFirstOpenSlot(page, PATIENTS.mona);
  await openDoctorDay(page);
  await expect(dayList(page)).toContainText(PATIENTS.mona);
  await expect(attention(page)).toHaveCount(0);
  await expect(waitingRoom(page)).toContainText(DOCTOR.waitingEmpty);
  await expect(brief(page)).toContainText(DOCTOR.briefTagNotArrived);
  await expect(brief(page).getByRole("button", { name: DOCTOR.callIn, exact: true })).toHaveCount(0);
});

test("leaving for the day screen and back keeps the day screen's own state", async ({ page }) => {
  await twoWaiting(page);
  await backToDay(page);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusArrived);
});

test("on mobile, the last day-list row clears the bottom nav once scrolled to the end", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the rail is a fixed bottom bar only below the sm breakpoint");
  await twoWaiting(page);
  const lastRow = dayList(page).getByRole("listitem").last();
  await expect(lastRow).toContainText(PATIENTS.karim);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() =>
      page.evaluate(
        () => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight,
      ),
    )
    .toBe(true);

  const rowBox = await lastRow.boundingBox();
  const navBox = await sidebar(page).boundingBox();
  expect(rowBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(navBox!.y);
});
