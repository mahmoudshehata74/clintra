import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { reportsStrings as R } from "../src/screens/reports/strings";
import { REPORT_KEYS, REPORT_TITLES } from "../src/screens/reports/reportsModel";
import { AUTH, enterPin, gotoSeededDay, SEEDED_DAY, lockOverlay, OWNER_NAME, OWNER_PIN, QUEUE_DR, S, sidebar, SIDEBAR, SLOTS_DR } from "./support";

// The reports page ("التقارير"): the owner reads every doctor's rows and all
// ten reports; a login tied to one doctor reads that doctor's only; the front
// desk has no entry. Seeded visits sit on SEEDED_DAY, a past day, so
// each test sets the range to it.

const DOCTOR_LOGIN_NAME = "مساعد د. سلمى";
const DOCTOR_LOGIN_PHONE = "01000000077";
const DOCTOR_LOGIN_PIN = "4321";

async function openReports(page: Page) {
  await sidebar(page).getByRole("button", { name: SIDEBAR.navReports, exact: true }).click();
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navReports, exact: true })).toHaveAttribute("aria-current", "page");
}

async function setRange(page: Page, from: string, to: string) {
  await page.getByLabel(R.fromLabel, { exact: true }).fill(from);
  await page.getByLabel(R.toLabel, { exact: true }).fill(to);
}

function reportSection(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

/** The doctor column's distinct values in the open report's table. */
async function doctorsListed(page: Page, title: string): Promise<string[]> {
  const table = reportSection(page, title).getByRole("table");
  const headers = await table.getByRole("columnheader").allInnerTexts();
  const index = headers.indexOf(R.colDoctor);
  expect(index).toBeGreaterThanOrEqual(0);
  const cells = await table.locator(`tbody tr td:nth-child(${index + 1})`).allInnerTexts();
  return [...new Set(cells.map((cell) => cell.trim()))].sort();
}

test("the owner reads all ten reports over every doctor, and downloads one as CSV", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await openReports(page);
  const day = SEEDED_DAY;
  await setRange(page, day, day);

  await expect(page.getByRole("group", { name: R.doctorLabel, exact: true })).toBeVisible();
  const picker = page.getByRole("group", { name: R.reportsNavLabel, exact: true });
  for (const key of REPORT_KEYS) {
    await picker.getByRole("button", { name: REPORT_TITLES[key], exact: true }).click();
    const section = reportSection(page, REPORT_TITLES[key]);
    await expect(section).toBeVisible();
    await expect(section.getByRole("button", { name: R.downloadCsv, exact: true })).toBeVisible();
  }

  await picker.getByRole("button", { name: R.titleVisits, exact: true }).click();
  expect(await doctorsListed(page, R.titleVisits)).toEqual([QUEUE_DR, SLOTS_DR].sort());

  // One doctor picked: only that doctor's rows.
  await page.getByRole("group", { name: R.doctorLabel, exact: true }).getByRole("button", { name: QUEUE_DR, exact: true }).click();
  expect(await doctorsListed(page, R.titleVisits)).toEqual([QUEUE_DR]);

  const downloading = page.waitForEvent("download");
  await reportSection(page, R.titleVisits).getByRole("button", { name: R.downloadCsv, exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`clintra-visits-${day}-${day}.csv`);
  const csv = await readFile((await download.path())!, "utf-8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv.slice(1).split("\r\n")[0]).toBe(
    [R.colPatient, R.colDoctor, R.colVisitDay, R.colStatus, R.colCancelReason, R.colBookedAt, R.colArrivedAt, R.colStartedAt, R.colEndedAt].join(","),
  );
  expect(csv).toContain(QUEUE_DR);
  expect(csv).not.toContain(SLOTS_DR);
});

test("a range over 366 days, or reversed, is refused with a line and no report", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await openReports(page);
  await setRange(page, "2025-01-01", "2026-01-03");
  await expect(page.getByText(R.rangeTooLong)).toBeVisible();
  await expect(page.getByRole("button", { name: R.downloadCsv, exact: true })).toHaveCount(0);
  await setRange(page, "2026-02-01", "2026-01-01");
  await expect(page.getByText(R.rangeReversed)).toBeVisible();
});

test("a login tied to one doctor reads that doctor's rows only, with no doctor filter", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  // The owner adds a login tied to the queue doctor.
  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  await settings.getByRole("button", { name: S.staffNewAction, exact: true }).click();
  await settings.getByLabel(S.staffNameLabel, { exact: true }).fill(DOCTOR_LOGIN_NAME);
  await settings.getByLabel(S.staffPhoneLabel, { exact: true }).fill(DOCTOR_LOGIN_PHONE);
  const scope = settings.getByRole("group", { name: S.staffPractitionerScopeLabel, exact: true }).first();
  await scope.getByRole("button", { name: S.scopeSelf, exact: true }).click();
  await settings.getByRole("group", { name: S.staffPractitionerScopeLabel, exact: true }).last().getByRole("button", { name: QUEUE_DR, exact: true }).click();
  await settings.getByLabel(S.staffPinLabel, { exact: true }).fill(DOCTOR_LOGIN_PIN);
  // The staff form can still report offline after the page itself is ready.
  await expect(settings.getByText(S.staffAddNeedsConnection, { exact: true })).toBeHidden();
  await settings.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(settings.getByText(DOCTOR_LOGIN_NAME)).toBeVisible();
  await settings.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();

  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  const overlay = lockOverlay(page);
  await overlay.getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await overlay.getByRole("button", { name: new RegExp(DOCTOR_LOGIN_NAME) }).click();
  await enterPin(page, DOCTOR_LOGIN_PIN);
  await expect(overlay).toBeHidden();

  await openReports(page);
  const day = SEEDED_DAY;
  await setRange(page, day, day);
  await expect(page.getByRole("group", { name: R.doctorLabel, exact: true })).toHaveCount(0);
  await expect(reportSection(page, R.titleVisits)).toBeVisible();
  expect(await doctorsListed(page, R.titleVisits)).toEqual([QUEUE_DR]);
});

test("the front desk has no reports entry", async ({ page }) => {
  await gotoSeededDay(page); // the seeded assistant, tied to no doctor
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navAudit, exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navReports, exact: true })).toHaveCount(0);
});
