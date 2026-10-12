import { expect, test, type Locator, type Page } from "@playwright/test";
import { cairoInstant, todayInCairo, type ClockTime } from "../src/domain/time";
import {
  advanceRowTo,
  ASSISTANT_NAME,
  AUTH,
  bookFirstOpenSlot,
  DEV_SEED_PINS,
  DOCTOR,
  doctorSection,
  gotoRealDay,
  gotoSeededDay,
  lockOverlay,
  login,
  openDoctorDay,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  rowFor,
  S,
  SEEDED_DAY,
  selectPractitioner,
  sidebar,
  SIDEBAR,
  SLOTS_DR,
  VISIT,
} from "./support";

// The visit workspace (screen 10) in the visit-form sheet and on the
// "الزيارة الحالية" page. The page clock is pinned to a morning before the
// seeded slots schedule (09:00–14:00) opens, as in doctor-day.spec.ts, so
// every slot is bookable and the session length is exact. Visits are built
// through the app's own write paths.
const TODAY = todayInCairo();
const at = (time: ClockTime) => new Date(cairoInstant(TODAY, time));
const SERVICE = "كشف عام";

type Drug = { name: string; instructions: string; duration?: string };
const AMOXICILLIN: Drug = { name: "Amoxicillin 500mg", instructions: "كبسولة كل 8 ساعات", duration: "5 أيام" };
const IBUPROFEN: Drug = { name: "Ibuprofen 400mg", instructions: "قرص بعد الأكل عند الألم" };

/** كريم booked, arrived at 09:00 and in the room, on the real day, by `as` (the owner by default). */
async function karimInRoom(page: Page, as: { name: string; pin: string } = { name: OWNER_NAME, pin: OWNER_PIN }) {
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, as);
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, SERVICE);
  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.karim, S.statusArrived);
  await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
}

/** Opens a day-grid row's visit form (the "التسجيل" pill) and waits for its workspace. */
async function openVisitSheet(page: Page, patientName: string): Promise<Locator> {
  await rowFor(page, patientName).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
  return sheet;
}

async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
  await expect(sheet).toBeHidden();
}

const rxSection = (scope: Locator) => scope.getByRole("region", { name: VISIT.rxHeading, exact: true });
const rxItem = (scope: Locator, name: string) => rxSection(scope).getByRole("listitem").filter({ hasText: name });

async function fillRxForm(scope: Locator, drug: Drug): Promise<void> {
  await scope.getByLabel(VISIT.rxNameLabel, { exact: true }).fill(drug.name);
  await scope.getByLabel(VISIT.rxInstructionsLabel, { exact: true }).fill(drug.instructions);
  await scope.getByLabel(VISIT.rxDurationLabel, { exact: true }).fill(drug.duration ?? "");
}

async function addDrug(scope: Locator, drug: Drug): Promise<void> {
  await scope.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
  await fillRxForm(scope, drug);
  await scope.getByRole("button", { name: VISIT.rxAddConfirm, exact: true }).click();
  await expect(rxItem(scope, drug.name)).toBeVisible();
  await expect(scope.getByRole("button", { name: VISIT.rxAdd, exact: true })).toBeVisible();
}

async function switchUser(page: Page, as: { name: string; pin?: string }): Promise<void> {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, as);
}

/** Writes what markPrescriptionPrinted writes — printed_at and the diagnosis snapshot — straight into IndexedDB, the way other specs reach the store. */
async function markEveryPrescriptionPrinted(page: Page): Promise<number> {
  return page.evaluate(async (printedAt) => {
    const req = indexedDB.open("clintra");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const store = database.transaction("prescriptions", "readwrite").objectStore("prescriptions");
      const rows: Record<string, unknown>[] = await new Promise((resolve, reject) => {
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      });
      for (const row of rows) {
        await new Promise((resolve, reject) => {
          const put = store.put({ ...row, printed_at: printedAt, diagnosis: null });
          put.onsuccess = () => resolve(undefined);
          put.onerror = () => reject(put.error);
        });
      }
      return rows.length;
    } finally {
      database.close();
    }
  }, at("09:10").toISOString());
}

/** Sets this device's number series, the way device-series.spec.ts does; resolves to how many device rows it updated. */
async function setDeviceSeries(page: Page, series: number | null): Promise<number> {
  return page.evaluate(async (series) => {
    const req = indexedDB.open("clintra");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const store = database.transaction("device", "readwrite").objectStore("device");
      const rows: Record<string, unknown>[] = await new Promise((resolve, reject) => {
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      });
      for (const row of rows) {
        await new Promise((resolve, reject) => {
          const put = store.put({ ...row, series });
          put.onsuccess = () => resolve(undefined);
          put.onerror = () => reject(put.error);
        });
      }
      return rows.length;
    } finally {
      database.close();
    }
  }, series);
}

test("adding, editing and removing a drug updates the list and its count", async ({ page }) => {
  await karimInRoom(page);
  const sheet = await openVisitSheet(page, PATIENTS.karim);
  const rx = rxSection(sheet);
  await expect(rx.getByRole("listitem")).toHaveCount(0);

  await addDrug(sheet, AMOXICILLIN);
  await expect(rx.getByText(VISIT.rxCountOne, { exact: true })).toBeVisible();
  await expect(rxItem(sheet, AMOXICILLIN.name)).toContainText(`${AMOXICILLIN.instructions} · ${AMOXICILLIN.duration}`);

  await addDrug(sheet, IBUPROFEN);
  await expect(rx.getByText(VISIT.rxCountTwo, { exact: true })).toBeVisible();
  await expect(rx.getByRole("listitem")).toHaveCount(2);

  // Tapping an item opens it for editing in place.
  await rxItem(sheet, AMOXICILLIN.name).getByRole("button", { name: new RegExp(AMOXICILLIN.name) }).click();
  const duration = sheet.getByLabel(VISIT.rxDurationLabel, { exact: true });
  await expect(duration).toHaveValue(AMOXICILLIN.duration!);
  await duration.fill("7 أيام");
  await sheet.getByRole("button", { name: VISIT.rxEditConfirm, exact: true }).click();
  await expect(duration).toHaveCount(0);
  await expect(rxItem(sheet, AMOXICILLIN.name)).toContainText(`${AMOXICILLIN.instructions} · 7 أيام`);

  await rxItem(sheet, IBUPROFEN.name).getByRole("button", { name: VISIT.rxRemove, exact: true }).click();
  await expect(rxItem(sheet, IBUPROFEN.name)).toHaveCount(0);
  await expect(rx.getByText(VISIT.rxCountOne, { exact: true })).toBeVisible();

  // Reopened, the list is what the store holds.
  await closeSheet(sheet);
  const reopened = await openVisitSheet(page, PATIENTS.karim);
  await expect(rxSection(reopened).getByRole("listitem")).toHaveCount(1);
  await expect(rxItem(reopened, AMOXICILLIN.name)).toContainText("7 أيام");
});

test("an empty name or instructions is refused with its message under the field", async ({ page }) => {
  await karimInRoom(page);
  const sheet = await openVisitSheet(page, PATIENTS.karim);

  await sheet.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
  await sheet.getByRole("button", { name: VISIT.rxAddConfirm, exact: true }).click();
  await expect(sheet.getByText(VISIT.rxErrorNameRequired, { exact: true })).toBeVisible();

  await sheet.getByLabel(VISIT.rxNameLabel, { exact: true }).fill(AMOXICILLIN.name);
  await expect(sheet.getByText(VISIT.rxErrorNameRequired, { exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: VISIT.rxAddConfirm, exact: true }).click();
  await expect(sheet.getByText(VISIT.rxErrorInstructionsRequired, { exact: true })).toBeVisible();
  await expect(rxSection(sheet).getByRole("listitem")).toHaveCount(0);

  // Cancel leaves nothing behind.
  await sheet.getByRole("button", { name: VISIT.rxCancel, exact: true }).click();
  await expect(sheet.getByLabel(VISIT.rxNameLabel, { exact: true })).toHaveCount(0);
  await expect(rxSection(sheet).getByRole("listitem")).toHaveCount(0);
});

test("a device that does not know its series cannot start a prescription, and says so", async ({ page }) => {
  await karimInRoom(page);
  await expect.poll(() => setDeviceSeries(page, null)).toBe(1);
  const sheet = await openVisitSheet(page, PATIENTS.karim);

  await sheet.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
  await fillRxForm(sheet, AMOXICILLIN);
  await sheet.getByRole("button", { name: VISIT.rxAddConfirm, exact: true }).click();
  await expect(rxSection(sheet).getByRole("alert")).toHaveText(S.deviceSeriesUnknownError);
  await expect(rxSection(sheet).getByRole("listitem")).toHaveCount(0);
});

test("an assistant sees no prescription section without a drug, and the doctor's prescription read-only", async ({
  page,
}) => {
  await karimInRoom(page, { name: ASSISTANT_NAME, pin: DEV_SEED_PINS.assistant });
  let sheet = await openVisitSheet(page, PATIENTS.karim);
  await expect(rxSection(sheet)).toHaveCount(0);
  await closeSheet(sheet);

  await switchUser(page, { name: OWNER_NAME, pin: OWNER_PIN });
  sheet = await openVisitSheet(page, PATIENTS.karim);
  await addDrug(sheet, AMOXICILLIN);
  await closeSheet(sheet);

  await switchUser(page, { name: ASSISTANT_NAME });
  sheet = await openVisitSheet(page, PATIENTS.karim);
  await expect(rxItem(sheet, AMOXICILLIN.name)).toContainText(AMOXICILLIN.instructions);
  await expect(rxSection(sheet).getByText(VISIT.rxCountOne, { exact: true })).toBeVisible();
  await expect(rxSection(sheet).getByRole("button")).toHaveCount(0);
  await expect(rxSection(sheet).getByText(VISIT.rxPrintedLine)).toHaveCount(0);
});

test("once printed, the prescription is read-only and says why", async ({ page }) => {
  await karimInRoom(page);
  let sheet = await openVisitSheet(page, PATIENTS.karim);
  await addDrug(sheet, AMOXICILLIN);
  await closeSheet(sheet);

  expect(await markEveryPrescriptionPrinted(page)).toBe(1);
  await page.reload();
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.statusInRoom);

  sheet = await openVisitSheet(page, PATIENTS.karim);
  await expect(rxItem(sheet, AMOXICILLIN.name)).toBeVisible();
  await expect(rxSection(sheet).getByText(VISIT.rxPrintedLine, { exact: true })).toBeVisible();
  await expect(rxSection(sheet).getByRole("button")).toHaveCount(0);
});

test("the visit history shows the previous visit's diagnosis and drugs", async ({ page }) => {
  await page.clock.install({ time: at("08:30") });
  // ياسمين's seeded completed visit (the seeded Monday) gets a diagnosis and three drugs.
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  let sheet = await openVisitSheet(page, PATIENTS.yasmin);
  const diagnosis = sheet.getByPlaceholder(S.visitFormDiagnosisPlaceholder);
  await diagnosis.fill("شد عضلي حاد");
  await diagnosis.blur();
  await expect(sheet.getByText(S.visitFormSavedIndicator)).toBeVisible();
  await addDrug(sheet, IBUPROFEN);
  await addDrug(sheet, { name: "Omeprazole 20mg", instructions: "كبسولة قبل الفطار" });
  await addDrug(sheet, { name: "Vitamin D3", instructions: "قرص يوميًا" });
  await closeSheet(sheet);

  // Today she is back and in the room.
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.yasmin, SERVICE);
  await page.clock.setSystemTime(at("09:00"));
  await advanceRowTo(page, PATIENTS.yasmin, S.statusArrived);
  await advanceRowTo(page, PATIENTS.yasmin, S.statusInRoom);
  sheet = await openVisitSheet(page, PATIENTS.yasmin);

  const [, month, day] = SEEDED_DAY.split("-").map(Number);
  const history = sheet.getByRole("region", { name: VISIT.historyOne, exact: true });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history).toContainText(`${day}/${month}`);
  await expect(history).toContainText("شد عضلي حاد");
  await expect(history).toContainText(`${IBUPROFEN.name}، Omeprazole 20mg +1`);
  await expect(sheet).toContainText(VISIT.visitsOne);
});

test("closing the visit from the workspace completes it, and the session length stops at its final value", async ({
  page,
}) => {
  await karimInRoom(page);
  const sheet = await openVisitSheet(page, PATIENTS.karim);
  const count = sheet.getByText(VISIT.sessionLengthLabel);
  await expect(count).toHaveText(`${VISIT.sessionLengthLabel} ${VISIT.minuteUnderOne}`);

  await page.clock.fastForward(6 * 60_000);
  await expect(count).toHaveText(`${VISIT.sessionLengthLabel} 6 ${VISIT.minuteFew}`);

  await sheet.getByRole("button", { name: VISIT.closeVisit, exact: true }).click();
  await expect(sheet.getByRole("button", { name: VISIT.closeVisit, exact: true })).toHaveCount(0);
  await expect(rowFor(page, PATIENTS.karim)).toContainText(S.statusCompleted);

  // Completed: ended_at − started_at, no longer the live clock.
  await page.clock.fastForward(3 * 60_000);
  await expect(count).toHaveText(`${VISIT.sessionLengthLabel} 6 ${VISIT.minuteFew}`);
});

test("save and continue later commits the field being typed into and closes", async ({ page }) => {
  await karimInRoom(page);
  const sheet = await openVisitSheet(page, PATIENTS.karim);
  await sheet.getByPlaceholder(S.visitFormComplaintPlaceholder).fill("صداع من امبارح");
  await sheet.getByRole("button", { name: VISIT.saveAndContinueLater, exact: true }).click();
  await expect(sheet).toBeHidden();

  const reopened = await openVisitSheet(page, PATIENTS.karim);
  await expect(reopened.getByPlaceholder(S.visitFormComplaintPlaceholder)).toHaveValue("صداع من امبارح");
});

test("the current-visit page is in the rail for the owner and not for the assistant", async ({ page }) => {
  await gotoRealDay(page);
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navVisit, exact: true })).toHaveCount(0);

  await switchUser(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navVisit, exact: true })).toBeVisible();
});

test("the current-visit page is empty until a patient is called in, then shows that visit", async ({ page }) => {
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.mona, SERVICE);
  await advanceRowTo(page, PATIENTS.mona, S.statusArrived);

  await sidebar(page).getByRole("button", { name: SIDEBAR.navVisit, exact: true }).click();
  await expect(page.getByText(VISIT.currentVisitEmpty, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: VISIT.currentVisitTitle })).toBeAttached();

  await page.getByRole("button", { name: VISIT.currentVisitOpenDoctorDay, exact: true }).click();
  const brief = doctorSection(page, DOCTOR.briefNextHeading);
  await brief.getByRole("button", { name: DOCTOR.callIn, exact: true }).click();
  await expect(doctorSection(page, DOCTOR.heroLabel)).toContainText(PATIENTS.mona);

  await sidebar(page).getByRole("button", { name: SIDEBAR.navVisit, exact: true }).click();
  const main = page.getByRole("main");
  await expect(main).toContainText(PATIENTS.mona);
  await expect(main.getByRole("button", { name: VISIT.closeVisit, exact: true })).toBeVisible();
  await expect(main.getByPlaceholder(S.visitFormComplaintPlaceholder)).toBeVisible();
  await expect(page.getByText(VISIT.currentVisitEmpty, { exact: true })).toHaveCount(0);
});

test("half-typed text on the current-visit page survives the idle lock", async ({ page }) => {
  await page.clock.install({ time: at("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.mona, SERVICE);
  await advanceRowTo(page, PATIENTS.mona, S.statusArrived);
  await advanceRowTo(page, PATIENTS.mona, S.statusInRoom);
  await sidebar(page).getByRole("button", { name: SIDEBAR.navVisit, exact: true }).click();

  const main = page.getByRole("main");
  await main.getByRole("button", { name: VISIT.rxAdd, exact: true }).click();
  await main.getByLabel(VISIT.rxNameLabel, { exact: true }).fill("Cetirizine 10mg");
  await page.clock.fastForward(10 * 60_000 + 1_000);
  await expect(lockOverlay(page)).toBeVisible();
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await expect(main.getByLabel(VISIT.rxNameLabel, { exact: true })).toHaveValue("Cetirizine 10mg");
});

test.describe("unchanged entry points", () => {
  test("the doctor's day still opens the same workspace from its hero", async ({ page }) => {
    await karimInRoom(page);
    await openDoctorDay(page);
    await doctorSection(page, DOCTOR.heroLabel).getByRole("button", { name: DOCTOR.heroOpenVisitForm, exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(rxSection(sheet)).toBeVisible();
    await expect(sheet.getByRole("button", { name: VISIT.closeVisit, exact: true })).toBeVisible();
  });
});
