import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ASSISTANT_NAME,
  AUTH,
  correctVisit,
  CORRECTION,
  DEV_SEED_PINS,
  gotoSeededDay,
  karimInRoom,
  lockOverlay,
  login,
  openVisitSheet,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  PROFILE,
  QUEUE_DR,
  readStore,
  rowFor,
  S,
  selectPractitioner,
  syncSettled,
  VISIT,
  visitSheet,
} from "./support";

// Corrections after completion (docs/design-clinical-corrections.md): once
// the visit is closed its form reads only; its doctor or the owner changes it
// by "تعديل" with a reason, the timeline and the workspace show "تم
// التعديل" with the history, and nobody who does not read clinical text sees
// either.

const COMPLAINT = "التهاب في الحلق من يومين";
const DIAGNOSIS = "التهاب في الحلق";
const CORRECTED = "التهاب اللوزتين";
const REASON = "التشخيص اتغير بعد نتيجة المسحة";

const diagnosisField = (scope: Locator) => scope.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
const correctionForm = (scope: Locator) => scope.getByRole("form", { name: CORRECTION.formTitle });
const historySheet = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: CORRECTION.historyTitle, exact: true }) });

async function switchUser(page: Page, as: { name: string; pin?: string }): Promise<void> {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, as);
}

/** كريم seen by the owner (his doctor): the form filled in the room, then the visit closed from the workspace. */
async function completedKarim(page: Page): Promise<Locator> {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  await workspace.getByPlaceholder(S.visitFormComplaintPlaceholder).fill(COMPLAINT);
  await diagnosisField(workspace).fill(DIAGNOSIS);
  // Closing straight from the field: the field's save lands before the visit closes.
  await workspace.getByRole("button", { name: VISIT.closeVisit, exact: true }).click();
  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.statusCompleted);
  await expect(workspace.getByRole("button", { name: CORRECTION.correctAction, exact: true })).toBeVisible();
  return workspace;
}

test("closing the visit keeps what was typed; the form then reads only, with تعديل for its doctor", async ({ page }) => {
  const workspace = await completedKarim(page);

  await expect(diagnosisField(workspace)).toHaveValue(DIAGNOSIS);
  await expect(workspace.getByPlaceholder(S.visitFormComplaintPlaceholder)).toHaveValue(COMPLAINT);
  await expect(diagnosisField(workspace)).toHaveAttribute("readonly", "");
  await expect(workspace.getByPlaceholder(S.visitFormComplaintPlaceholder)).toHaveAttribute("readonly", "");
  // Nothing corrected yet: no chip, no history.
  await expect(workspace.getByText(CORRECTION.correctedChip, { exact: true })).toHaveCount(0);
});

test("a correction needs a reason; with one it saves, and the chip and history show before and after", async ({ page }) => {
  const workspace = await completedKarim(page);

  await workspace.getByRole("button", { name: CORRECTION.correctAction, exact: true }).click();
  const form = correctionForm(workspace);
  await diagnosisField(form).fill(CORRECTED);
  await form.getByRole("button", { name: CORRECTION.save, exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText(CORRECTION.errorReasonRequired);
  await form.getByLabel(CORRECTION.reasonLabel, { exact: true }).fill("لا");
  await form.getByRole("button", { name: CORRECTION.save, exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText(CORRECTION.errorReasonRequired);

  await form.getByLabel(CORRECTION.reasonLabel, { exact: true }).fill(REASON);
  await form.getByRole("button", { name: CORRECTION.save, exact: true }).click();
  await expect(form).toBeHidden();
  await expect(diagnosisField(workspace)).toHaveValue(CORRECTED);
  await expect(workspace.getByText(CORRECTION.correctedChip, { exact: true })).toBeVisible();

  await workspace.getByRole("button", { name: `${CORRECTION.historyAction} (1)`, exact: true }).click();
  const history = historySheet(page);
  const entry = history.getByRole("listitem");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(`${CORRECTION.correctedByPrefix} ${OWNER_NAME}`);
  await expect(entry).toContainText(`${CORRECTION.reasonPrefix} ${REASON}`);
  await expect(entry).toContainText(CORRECTION.fieldDiagnosis);
  await expect(entry).toContainText(`${CORRECTION.before}: ${DIAGNOSIS}`);
  await expect(entry).toContainText(`${CORRECTION.after}: ${CORRECTED}`);
  // The complaint did not change, so it is not listed.
  await expect(entry).not.toContainText(CORRECTION.fieldComplaint);
  await page.keyboard.press("Escape");
  await expect(history).toBeHidden();

  // Unchanged text is refused.
  await workspace.getByRole("button", { name: CORRECTION.correctAction, exact: true }).click();
  await correctionForm(workspace).getByLabel(CORRECTION.reasonLabel, { exact: true }).fill(REASON);
  await correctionForm(workspace).getByRole("button", { name: CORRECTION.save, exact: true }).click();
  await expect(correctionForm(workspace).getByRole("alert")).toHaveText(CORRECTION.errorUnchanged);
  await correctionForm(workspace).getByRole("button", { name: CORRECTION.cancel, exact: true }).click();

  // The patient's timeline marks the visit, and its chip opens the same history.
  await workspace.getByRole("button", { name: PROFILE.historyQuick, exact: true }).click();
  const timeline = page.getByRole("region", { name: PROFILE.timelineLabel, exact: true });
  await timeline.getByRole("button", { name: CORRECTION.correctedChip, exact: true }).click();
  await expect(historySheet(page).getByRole("listitem")).toContainText(`${CORRECTION.after}: ${CORRECTED}`);

  // The audit log names the correction by its patient.
  await syncSettled(page);
  const revisions = await readStore<{ reason: string; new_data: { diagnosis: string } }>(page, "visit_form_revisions");
  expect(revisions.map((revision) => [revision.reason, revision.new_data.diagnosis])).toEqual([[REASON, CORRECTED]]);
});

test("an assistant sees neither تعديل nor the chip, in the workspace or on the timeline", async ({ page }) => {
  const workspace = await completedKarim(page);
  await correctVisit(workspace, { diagnosis: CORRECTED }, REASON);
  await workspace.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(workspace).toBeHidden();

  await switchUser(page, { name: ASSISTANT_NAME, pin: DEV_SEED_PINS.assistant });
  const asAssistant = await openVisitSheet(page);
  await expect(diagnosisField(asAssistant)).toHaveAttribute("readonly", "");
  await expect(asAssistant.getByRole("button", { name: CORRECTION.correctAction, exact: true })).toHaveCount(0);
  await expect(asAssistant.getByText(CORRECTION.correctedChip, { exact: true })).toHaveCount(0);
  await expect(asAssistant.getByRole("button", { name: new RegExp(CORRECTION.historyAction) })).toHaveCount(0);

  await asAssistant.getByRole("button", { name: PROFILE.historyQuick, exact: true }).click();
  const timeline = page.getByRole("region", { name: PROFILE.timelineLabel, exact: true });
  // His visits read as the front desk reads them (he has more than one), none with a chip.
  await expect(timeline.getByText(`${PROFILE.visitTitle} — ${PROFILE.visitCompletedStatus}`).first()).toBeVisible();
  await expect(timeline.getByRole("button", { name: CORRECTION.correctedChip, exact: true })).toHaveCount(0);
});

test("the owner corrects another doctor's completed visit", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, QUEUE_DR);
  await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const workspace = visitSheet(page);
  await expect(diagnosisField(workspace)).toHaveAttribute("readonly", "");

  await correctVisit(workspace, { diagnosis: "متابعة ضغط" }, "إضافة تشخيص منسي");
  await expect(diagnosisField(workspace)).toHaveValue("متابعة ضغط");
  await expect(workspace.getByRole("button", { name: `${CORRECTION.historyAction} (1)`, exact: true })).toBeVisible();
});

test("a correction made offline shows at once and reaches the server once back online", async ({ page }) => {
  const workspace = await completedKarim(page);
  await syncSettled(page);

  await page.context().setOffline(true);
  await correctVisit(workspace, { diagnosis: CORRECTED }, REASON);
  await expect(diagnosisField(workspace)).toHaveValue(CORRECTED);

  await page.context().setOffline(false);
  await syncSettled(page);
  const ops = await readStore<{ entity: string; synced_at: string | null; group_id?: string }>(page, "sync_ops");
  const correction = ops.filter((op) => op.entity === "visit_form_revisions");
  expect(correction).toHaveLength(1);
  expect(correction[0].synced_at).not.toBeNull();
  const group = ops.filter((op) => op.group_id !== undefined && op.group_id === correction[0].group_id);
  expect(group.map((op) => op.entity).sort()).toEqual(["visit_form_data", "visit_form_revisions"]);
});
