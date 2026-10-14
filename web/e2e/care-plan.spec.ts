import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDaysToClinicDay, todayInCairo } from "../src/domain/time";
import {
  ASSISTANT_NAME,
  AUTH,
  closeSheet,
  dayMonth,
  DEV_SEED_PINS,
  fillNewPlan,
  fillPlanGroup,
  karimInRoom,
  lockOverlay,
  login,
  MSG,
  openAuditLog,
  openVisitSheet,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  PLAN,
  planSheet,
  putRows,
  readStore,
  reloadAs,
  syncSettled,
  rowFor,
  S,
  sendSheet,
  visitSheet,
  type PlanGroupInput,
} from "./support";

// Screen 17 on the real day (the audit lines are today's), from كريم's visit
// in the room at 09:00 (karimInRoom: the owner, who is the slots doctor).
// Most tests use the same four-session plan: one comprehensive exam, then
// three general checkups a week apart.

const GOAL = "استعادة الحركة";
const FOUR_SESSIONS: PlanGroupInput[] = [
  { service: "فحص شامل", count: "1", gap: "0" },
  { service: "كشف عام", count: "3", gap: "7" },
];

const today = () => todayInCairo();

const sessions = (sheet: Locator) => sheet.getByRole("list", { name: PLAN.sessionsHeading, exact: true }).getByRole("listitem");
const sessionRow = (sheet: Locator, n: number) => sessions(sheet).nth(n - 1);
const hero = (sheet: Locator) => sheet.getByRole("region", { name: PLAN.sheetTitle, exact: true });

/** كريم's row on the day grid at a time ("09:00" is the visit the plan starts from). */
const karimAt = (page: Page, time: string) => rowFor(page, PATIENTS.karim).filter({ hasText: time });

/** The day grid's one-tap advance on one of كريم's rows. */
async function advance(row: Locator, status: string): Promise<void> {
  await row.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(row).toContainText(status);
}

/** Starts the plan from a filled form and waits for the plan itself. */
async function startPlan(sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: PLAN.startAction, exact: true }).click();
  await expect(sheet.getByRole("heading", { name: PLAN.sessionsHeading, exact: true })).toBeVisible();
}

/** كريم's in-room visit with the four-session plan created from it, the plan's sheet open. */
async function karimWithPlan(page: Page): Promise<{ workspace: Locator; sheet: Locator }> {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  const sheet = await fillNewPlan(page, workspace, GOAL, FOUR_SESSIONS);
  await sheet.getByLabel(PLAN.diagnosisField, { exact: true }).fill("التهاب وتر");
  await startPlan(sheet);
  return { workspace, sheet };
}

/** Opens the plan from the workspace's `.plan-badge`. */
async function openPlanFromBadge(page: Page, workspace: Locator): Promise<Locator> {
  await workspace.getByRole("button", { name: new RegExp(PLAN.badgePrefix) }).click();
  const sheet = planSheet(page);
  await expect(sheet.getByRole("heading", { name: PLAN.sessionsHeading, exact: true })).toBeVisible();
  return sheet;
}

const bookingSheet = (page: Page) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: new RegExp(`^${S.bookingButtonLabel}`) }) });

/** "احجز الجلسة التالية", then the 09:30 slot on the suggested day (today), waiting for the sheet to close. */
async function bookNextAt0930(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: PLAN.bookNext, exact: true }).click();
  const booking = bookingSheet(page);
  await booking.getByRole("button", { name: "09:30", exact: true }).click();
  await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(booking).toBeHidden();
}

async function switchUser(page: Page, as: { name: string; pin: string }): Promise<void> {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, as);
}

const OWNER = { name: OWNER_NAME, pin: OWNER_PIN };
const ASSISTANT = { name: ASSISTANT_NAME, pin: DEV_SEED_PINS.assistant };

test("a plan is created from the visit: checked first, its preview's days and total, then the badge reads جلسة 1 من 4", async ({ page }) => {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  const diagnosis = workspace.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
  await diagnosis.fill("التهاب وتر الرضفة");
  await diagnosis.blur();
  await expect(workspace.locator("#visit-form-diagnosis-hint")).toHaveText(S.visitFormSavedIndicator);

  await workspace.getByRole("button", { name: PLAN.startPlan, exact: true }).click();
  const sheet = planSheet(page);
  // The diagnosis starts from the visit form's.
  await expect(sheet.getByLabel(PLAN.diagnosisField, { exact: true })).toHaveValue("التهاب وتر الرضفة");

  // Nothing filled in: every message shows, and the form stays.
  await sheet.getByRole("button", { name: PLAN.startAction, exact: true }).click();
  await expect(sheet.getByText(PLAN.errorGoalRequired, { exact: true })).toBeVisible();
  await expect(sheet.getByText(PLAN.errorCountInvalid, { exact: true })).toBeVisible();
  await expect(sheet.getByText(PLAN.errorGapInvalid, { exact: true })).toBeVisible();
  await expect(sheet.getByText(PLAN.createHeading, { exact: true })).toBeVisible();

  await sheet.getByLabel(PLAN.goalField, { exact: true }).fill(GOAL);
  await fillPlanGroup(sheet, 1, FOUR_SESSIONS[0]);
  await sheet.getByRole("button", { name: PLAN.addGroup, exact: true }).click();
  await fillPlanGroup(sheet, 2, FOUR_SESSIONS[1]);
  await expect(sheet.getByText(PLAN.errorGoalRequired, { exact: true })).toBeHidden();

  // The preview: the exam today, then a checkup every 7 days; 500 + 3 × 300.
  const preview = sheet.getByRole("list", { name: PLAN.previewHeading, exact: true }).getByRole("listitem");
  await expect(preview).toHaveCount(4);
  for (const [index, [service, offset]] of ([["فحص شامل", 0], ["كشف عام", 7], ["كشف عام", 14], ["كشف عام", 21]] as const).entries()) {
    await expect(preview.nth(index)).toContainText(service);
    await expect(preview.nth(index)).toContainText(dayMonth(addDaysToClinicDay(today(), offset)));
  }
  await expect(sheet.getByRole("region", { name: PLAN.previewHeading, exact: true })).toContainText("1,400 ج.م");

  await startPlan(sheet);
  await expect(hero(sheet)).toContainText(PATIENTS.karim);
  await expect(hero(sheet)).toContainText(`${PLAN.goalLabel} ${GOAL}`);
  await expect(hero(sheet)).toContainText("التهاب وتر الرضفة");
  await expect(hero(sheet)).toContainText("4 جلسات");
  await expect(hero(sheet)).toContainText("0 / 4 جلسة");
  await expect(hero(sheet)).toContainText(`${PLAN.totalLabel} 1,400 ج.م`);
  await expect(hero(sheet)).toContainText(`${PLAN.paidLabel} 0 ج.م`);
  await expect(sessions(sheet)).toHaveCount(4);
  await expect(sessions(sheet).filter({ hasText: PLAN.stateSuggested })).toHaveCount(4);
  await closeSheet(sheet);

  const badge = workspace.getByRole("button", { name: new RegExp(PLAN.badgePrefix) });
  await expect(badge).toContainText(`${PLAN.badgePrefix} ${GOAL}`);
  await expect(badge).toContainText("جلسة 1 من 4");
  await expect(workspace.getByRole("button", { name: PLAN.startPlan, exact: true })).toHaveCount(0);
});

test("the next session is booked from the plan, then done and paid; the reminder waits for a booking", async ({ page }) => {
  const { workspace, sheet } = await karimWithPlan(page);

  // Nothing booked yet: no reminder to send.
  const reminder = sheet.getByRole("button", { name: PLAN.sendReminder, exact: true });
  await expect(reminder).toBeDisabled();
  await expect(sheet.getByText(PLAN.bookFirst, { exact: true })).toBeVisible();

  // The booking sheet opens on the session's patient, service and day (today).
  await sheet.getByRole("button", { name: PLAN.bookNext, exact: true }).click();
  const booking = bookingSheet(page);
  await expect(booking.getByText(PATIENTS.karim, { exact: true })).toBeVisible();
  await expect(booking.getByPlaceholder(S.bookingSearchPlaceholder)).toHaveCount(0);
  await expect(booking.getByRole("button", { name: S.bookingPrefillPrevDay, exact: true })).toBeDisabled();
  await booking.getByRole("button", { name: "09:30", exact: true }).click();
  await expect(booking).toContainText("فحص شامل");
  await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(booking).toBeHidden();

  const booked = `${dayMonth(today())} · 9:30`;
  await expect(sessionRow(sheet, 1)).toContainText(PLAN.stateNext);
  await expect(sessionRow(sheet, 1)).toContainText(`${booked} · ${PLAN.doctorPrefix}`);
  await expect(sheet.getByRole("button", { name: PLAN.bookNext, exact: true })).toBeDisabled();
  await expect(sheet.getByText(`${PLAN.nextBookedPrefix} ${booked}`, { exact: true })).toBeVisible();

  // The reminder is about that visit, on its own template.
  await reminder.click();
  const send = sendSheet(page);
  await expect(send.getByRole("button", { name: "تذكير جلسة خطة", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(send.getByLabel(MSG.sendBodyLabel, { exact: true })).toHaveValue(/جلسة 1 من 4 · فحص شامل/);
  await closeSheet(send);
  await closeSheet(sheet);
  await closeSheet(workspace);

  // The 09:00 visit closes; the session's 09:30 visit is seen and completed.
  await advance(karimAt(page, "09:00"), S.statusCompleted);
  const session = karimAt(page, "09:30");
  await advance(session, S.statusArrived);
  await advance(session, S.statusInRoom);
  await advance(session, S.statusCompleted);

  await session.getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const sessionWorkspace = visitSheet(page);
  await expect(sessionWorkspace.getByRole("button", { name: new RegExp(PLAN.badgePrefix) })).toContainText("جلسة 1 من 4");
  let plan = await openPlanFromBadge(page, sessionWorkspace);
  await expect(sessionRow(plan, 1)).toContainText(PLAN.stateDone);
  await expect(hero(plan)).toContainText("1 / 4 جلسة");
  await expect(hero(plan).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await expect(hero(plan)).toContainText(`${PLAN.paidLabel} 0 ج.م`);
  await closeSheet(plan);
  await closeSheet(sessionWorkspace);

  // A payment on the session's invoice counts toward the plan.
  await session.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: S.recordPaymentAction }).click();
  const payment = page.getByRole("dialog");
  await payment.getByRole("textbox").first().fill("500");
  await payment.getByRole("button", { name: S.paymentMethodCash, exact: true }).click();
  await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
  await expect(page.getByText(S.invoiceStatusPaid).first()).toBeVisible();
  await closeSheet(page.getByRole("dialog"));

  await session.getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  plan = await openPlanFromBadge(page, visitSheet(page));
  await expect(hero(plan)).toContainText(`${PLAN.paidLabel} 500 ج.م`);
  // The next session is suggested a week after the done one, and can be booked.
  await expect(sessionRow(plan, 2)).toContainText(`${dayMonth(addDaysToClinicDay(today(), 7))} · مقترح`);
  await expect(plan.getByRole("button", { name: PLAN.bookNext, exact: true })).toBeEnabled();
});

test("sessions are skipped and brought back, the plan edited, stopped and resumed, and each is in the audit log", async ({ page }) => {
  const { workspace, sheet } = await karimWithPlan(page);

  await sessionRow(sheet, 2).getByRole("button", { name: PLAN.skipAction, exact: true }).click();
  await expect(sessionRow(sheet, 2)).toContainText(PLAN.stateSkipped);
  await expect(hero(sheet)).toContainText("3 جلسات");
  await sessionRow(sheet, 2).getByRole("button", { name: PLAN.unskipAction, exact: true }).click();
  await expect(sessionRow(sheet, 2)).toContainText(PLAN.stateSuggested);
  await expect(hero(sheet)).toContainText("4 جلسات");

  // The goal changes and two follow-ups three days apart are added.
  await sheet.getByRole("button", { name: PLAN.editPlan, exact: true }).click();
  await expect(sheet.getByText(PLAN.editHeading, { exact: true })).toBeVisible();
  await sheet.getByLabel(PLAN.goalField, { exact: true }).fill("استعادة كامل الحركة");
  await sheet.getByRole("button", { name: PLAN.addSessions, exact: true }).click();
  await fillPlanGroup(sheet, 1, { service: "استشارة متابعة", count: "2", gap: "3" });
  await sheet.getByRole("button", { name: PLAN.saveAction, exact: true }).click();
  await expect(sessions(sheet)).toHaveCount(6);
  await expect(hero(sheet)).toContainText("6 جلسات");
  await expect(hero(sheet)).toContainText("استعادة كامل الحركة");
  await expect(workspace.getByRole("button", { name: new RegExp(PLAN.badgePrefix) })).toContainText("استعادة كامل الحركة");

  // Stopped: no booking; resumed: the booking is back.
  await sheet.getByRole("button", { name: PLAN.editPlan, exact: true }).click();
  await sheet.getByRole("button", { name: PLAN.stopPlan, exact: true }).click();
  await expect(sheet.getByRole("button", { name: PLAN.resumePlan, exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: PLAN.cancelAction, exact: true }).click();
  await expect(sheet.getByText(PLAN.stoppedLine, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: PLAN.bookNext, exact: true })).toHaveCount(0);

  await sheet.getByRole("button", { name: PLAN.editPlan, exact: true }).click();
  await sheet.getByRole("button", { name: PLAN.resumePlan, exact: true }).click();
  await expect(sheet.getByRole("button", { name: PLAN.stopPlan, exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: PLAN.cancelAction, exact: true }).click();
  await expect(sheet.getByRole("button", { name: PLAN.bookNext, exact: true })).toBeEnabled();
  await expect(sheet.getByText(PLAN.stoppedLine, { exact: true })).toHaveCount(0);
  await closeSheet(sheet);
  await closeSheet(workspace);

  await openAuditLog(page);
  const audit = page.getByRole("dialog");
  await audit.getByRole("button", { name: S.auditFilterVisits, exact: true }).click();
  for (const [verb, count] of [
    ["بدأ خطة رعاية", 1],
    ["أضاف جلسات للخطة", 6],
    ["أجّل جلسة", 1],
    ["رجّع جلسة", 1],
    ["وقّف الخطة", 1],
    ["رجّع الخطة", 1],
  ] as const) {
    const rows = audit.getByRole("listitem").filter({ has: page.getByText(verb, { exact: true }) });
    await expect(rows).toHaveCount(count);
    for (const row of await rows.all()) {
      await expect(row).toContainText(PATIENTS.karim);
    }
  }
  await expect(audit).not.toContainText(GOAL);
  await expect(audit).not.toContainText("التهاب وتر");
});

test("a second plan for the same patient and doctor is refused, saying why", async ({ page }) => {
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  const sheet = await fillNewPlan(page, workspace, GOAL, FOUR_SESSIONS);
  await sheet.getByLabel(PLAN.diagnosisField, { exact: true }).fill("التهاب وتر");

  // Meanwhile another device's plan for كريم with this doctor syncs in.
  type StoredVisit = {
    id: string;
    org_id: string;
    location_id: string;
    practitioner_id: string;
    patient_id: string;
    service_id: string;
    status: string;
    visit_date: string;
  };
  const karim = (await readStore<{ id: string; full_name: string }>(page, "patients")).find((patient) => patient.full_name === PATIENTS.karim)!;
  const visit = (await readStore<StoredVisit>(page, "visits")).find(
    (candidate) => candidate.patient_id === karim.id && candidate.visit_date === today() && candidate.status === "in_room",
  )!;
  const [template] = await readStore<{ id: string }>(page, "specialty_templates");
  const now = new Date().toISOString();
  await putRows(page, [
    {
      store: "care_plans",
      value: {
        id: "plan-from-another-device",
        org_id: visit.org_id,
        location_id: visit.location_id,
        template_id: template.id,
        patient_id: visit.patient_id,
        practitioner_id: visit.practitioner_id,
        goal: "خطة تانية",
        diagnosis: "تشخيص",
        planned_count: 1,
        total_price: 30000,
        paid: 0,
        status: "active",
        started_at: now,
        expected_end: now,
        rev: 1,
      },
    },
    {
      store: "care_plan_items",
      value: {
        id: "session-from-another-device",
        care_plan_id: "plan-from-another-device",
        service_id: visit.service_id,
        sequence: 1,
        visit_id: null,
        min_gap_days: 0,
        depends_on_item_id: null,
        price: 30000,
        status: "planned",
        rev: 1,
      },
    },
  ]);

  await sheet.getByRole("button", { name: PLAN.startAction, exact: true }).click();
  await expect(sheet.getByRole("alert")).toHaveText(PLAN.errorPlanAlreadyActive);
  await expect(sheet.getByText(PLAN.createHeading, { exact: true })).toBeVisible();
  expect((await readStore<{ id: string }>(page, "care_plans")).map((plan) => plan.id)).toEqual(["plan-from-another-device"]);
});

test("the assistant starts no plan and sees one read-only, but books its next session", async ({ page }) => {
  await karimInRoom(page);
  let workspace = await openVisitSheet(page);
  await expect(workspace.getByRole("button", { name: PLAN.startPlan, exact: true })).toBeVisible();
  await closeSheet(workspace);
  // The lock sits in the app bar, which an open sheet covers on a phone.
  await switchUser(page, ASSISTANT);
  workspace = await openVisitSheet(page);
  await expect(workspace.getByRole("button", { name: PLAN.startPlan, exact: true })).toHaveCount(0);
  await closeSheet(workspace);

  await switchUser(page, OWNER);
  workspace = await openVisitSheet(page);
  const created = await fillNewPlan(page, workspace, GOAL, FOUR_SESSIONS);
  await created.getByLabel(PLAN.diagnosisField, { exact: true }).fill("التهاب وتر");
  await startPlan(created);
  await closeSheet(created);
  await closeSheet(workspace);

  await switchUser(page, ASSISTANT);
  workspace = await openVisitSheet(page);
  const sheet = await openPlanFromBadge(page, workspace);
  await expect(sessions(sheet)).toHaveCount(4);
  await expect(sheet.getByRole("button", { name: PLAN.editPlan, exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: PLAN.skipAction, exact: true })).toHaveCount(0);
  await bookNextAt0930(page, sheet);
  await expect(sessionRow(sheet, 1)).toContainText(PLAN.stateNext);
});

test("a plan whose next session is more than a week overdue, with nothing booked, says the patient has stopped", async ({ page }) => {
  const { sheet } = await karimWithPlan(page);
  await bookNextAt0930(page, sheet);
  await expect(sheet.getByText(/المريض متوقف من/)).toHaveCount(0);

  // The first session's visit, done 20 days ago: the second was due 13 days ago.
  await syncSettled(page);
  type StoredItem = { sequence: number; visit_id: string | null };
  const first = (await readStore<StoredItem>(page, "care_plan_items")).find((item) => item.sequence === 1)!;
  const visit = (await readStore<{ id: string }>(page, "visits")).find((candidate) => candidate.id === first.visit_id)!;
  await putRows(page, [{ store: "visits", value: { ...visit, status: "completed", visit_date: addDaysToClinicDay(today(), -20) } }]);
  await reloadAs(page, OWNER);

  const reopened = await openPlanFromBadge(page, await openVisitSheet(page));
  await expect(reopened.getByRole("status")).toHaveText("المريض متوقف من 13 يوم");
  await expect(sessionRow(reopened, 2)).toContainText(`${dayMonth(addDaysToClinicDay(today(), -13))} · مقترح`);
});
