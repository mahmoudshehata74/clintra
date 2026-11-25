import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { shotDirectory } from "./browserArtifacts";
import { gotoSeededDay, OWNER_NAME, OWNER_PIN, putRows, readStore, S, sidebar, SIDEBAR } from "./support";

const shotFolder = process.env.CLINTRA_SHOT_DIR ? shotDirectory(process.env.CLINTRA_SHOT_DIR) : null;
async function capture(page: Page, name: string, project: string) {
  if (shotFolder) await page.screenshot({ path: join(shotFolder, `${name}-${project}.png`), fullPage: true, animations: "disabled" });
}
async function captureThemes(page: Page, name: string, project: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await capture(page, `${name}-${theme}`, project);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
async function expectReadOnlyNavigation(page: Page) {
  const offenders = await page.locator("body").evaluate((body) => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const describe = (element: Element) => `${element.tagName.toLowerCase()}: ${(element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 100) || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "(empty)"}`;
    const controls = [...body.querySelectorAll("*")]
      .filter((element) => visible(element) && !element.closest("[data-support-nav]")
        && !element.closest("[data-support-navigation]")
        && (element.matches("button, a, input, select, textarea, [role=button], [tabindex]")
          || (getComputedStyle(element).cursor === "pointer" && getComputedStyle(element.parentElement ?? body).cursor !== "pointer")));
    const orphanLabels = [...body.querySelectorAll("label, legend")].filter((element) => {
      if (!visible(element)) return false;
      const control = element instanceof HTMLLabelElement ? element.control : element.closest("fieldset")?.querySelector("input, select, textarea");
      return control !== null && control !== undefined && !visible(control);
    });
    return [...controls, ...orphanLabels].map(describe);
  });
  expect(offenders, `Visible support write affordances:\n${offenders.join("\n")}`).toEqual([]);
}

async function writeFakeSessions(page: Page, sessions: unknown[]) {
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some((row) => row.name === "clintra-fake-server"))).toBe(true);
  await page.evaluate(async (value) => {
    const request = indexedDB.open("clintra-fake-server");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction("preferences", "readwrite");
      transaction.objectStore("preferences").put({ key: "support_sessions", value: JSON.stringify(value) });
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    } finally { database.close(); }
  }, sessions);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

test("owner creates a one-time code, sees and ends the support session", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  const [device] = await readStore<{ id: string; token: string | null }>(page, "device");
  await putRows(page, [{ store: "device", value: { ...device, token: "fake-support-owner" } }]);
  await page.route("**/api/health", (route) => route.fulfill({ json: { time: new Date().toISOString() } }));
  let mintPayload: Record<string, unknown> | null = null;
  await page.route("**/api/support/codes", (route) => {
    mintPayload = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { id: mintPayload!.id, expires_at: new Date(Date.now() + 72 * 3600_000).toISOString() } });
  });
  await page.route("**/api/support/devices/*/end", async (route) => {
    await writeFakeSessions(page, []);
    await route.fulfill({ json: { ok: true } });
  });
  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const sheet = page.getByRole("dialog").first();
  await sheet.getByRole("button", { name: "دعم كلينترا" }).click();
  await sheet.getByRole("button", { name: "إنشاء كود دعم" }).click();
  await expect(sheet.getByText(/كود الدعم: CLT-/)).toBeVisible();
  expect(mintPayload).toMatchObject({ support_hours: 24, include_clinical: false });
  expect(mintPayload?.code_hash).toMatch(/^[0-9a-f]{64}$/);
  await captureThemes(page, "owner-code", testInfo.project.name);
  await sheet.getByRole("button", { name: S.settingsHoursTab, exact: true }).click();
  await sheet.getByRole("button", { name: "دعم كلينترا" }).click();
  await expect(sheet.getByText(/كود الدعم: CLT-/)).toHaveCount(0);

  const session = { device_id: crypto.randomUUID(), admin_name: "مسؤول الدعم", expires_at: new Date(Date.now() + 3600_000).toISOString() };
  await writeFakeSessions(page, [session]);
  await expect(page.locator("[data-support-sessions]")).toContainText("فريق كلينترا عنده وصول للقراءة بس لحد");
  await expect(sheet.getByText(/جهاز دعم كلينترا/)).toContainText("مسؤول الدعم");
  await captureThemes(page, "owner-session", testInfo.project.name);
  await sheet.getByRole("button", { name: "إنهاء الدعم دلوقتي" }).click();
  await expect(page.getByRole("dialog").last().getByText("تنهي وصول جهاز الدعم دلوقتي؟")).toBeVisible();
  await captureThemes(page, "owner-end-confirm", testInfo.project.name);
  await page.getByRole("dialog").last().getByRole("button", { name: "تأكيد الإنهاء" }).click();
  await expect(sheet.getByText(/جهاز دعم كلينترا/)).toHaveCount(0);
  await expect(page.locator("[data-support-sessions]")).toHaveCount(0);

  await captureThemes(page, "owner-ended", testInfo.project.name);
  await page.context().setOffline(true);
  await expect(sheet.getByText("إنشاء كود الدعم محتاج اتصال بالإنترنت")).toBeVisible();
  await captureThemes(page, "owner-offline", testInfo.project.name);
});

test("non-owner cannot see support settings", async ({ page }, testInfo) => {
  await gotoSeededDay(page);
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "دعم كلينترا" })).toHaveCount(0);
  await captureThemes(page, "non-owner", testInfo.project.name);
});

test("support entry cleans the URL, stays read only, and wipes only support data at expiry", async ({ page, context }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  const [organization] = await readStore<Record<string, unknown>>(page, "organizations");
  const locations = await readStore<Record<string, unknown>>(page, "locations");
  const practitioners = await readStore<Record<string, unknown>>(page, "practitioners");
  const memberships = (await readStore<Record<string, unknown>>(page, "memberships")).map((row) => ({ ...row, pin_hash: null, pin_salt: null }));
  const users = await readStore<Record<string, unknown>>(page, "users");
  const owner = memberships.find((row) => row.role === "owner")!;
  const rows: { entity: string; entity_id: string; rev: number; payload: Record<string, unknown> }[] = [];
  for (const entity of ["schedules", "services", "patients", "visits"] as const) {
    for (const row of await readStore<Record<string, unknown>>(page, entity)) rows.push({ entity, entity_id: String(row.id), rev: Number(row.rev ?? 1), payload: entity === "patients" || entity === "visits" ? { ...row, note: null } : row });
  }
  const supportPage = await context.newPage();
  await supportPage.emulateMedia({ colorScheme: "light" });
  const now = new Date();
  await supportPage.clock.install({ time: now });
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  const supportId = crypto.randomUUID();
  let pushes = 0;
  await supportPage.route("**/api/support/exchange", (route) => route.fulfill({ json: {
    token: "fake-support-token", device_id: supportId, org_id: organization.id, location_id: locations[0].id,
    membership_id: owner.id, series: null, organization, locations, practitioners, memberships, users,
    support: { expires_at: expiresAt, include_clinical: false, admin_name: "مسؤول الدعم" },
  } }));
  await supportPage.route("**/api/health", (route) => route.fulfill({ json: { time: now.toISOString() } }));
  await supportPage.route(/\/api\/(sync|audit)\//, (route) => {
    if (route.request().method() === "POST") { pushes++; return route.fulfill({ status: 403, json: { error: "support_read_only" } }); }
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.includes("audit") ? { cursor: "0", has_more: false, rows: [] }
      : { cursor: path.includes("bootstrap") ? "1:" : "1", has_more: false, rows: path.includes("bootstrap") ? rows : [],
        support_sessions: [{ device_id: supportId, admin_name: "مسؤول الدعم", expires_at: expiresAt }] } });
  });
  await supportPage.goto("/?seedDay=1#support=CLT-7F3K-9QRT-4XWM-2BCD");
  await expect(supportPage).toHaveURL(/\?seedDay=1$/);
  await expect(supportPage.locator("[data-support-device]")).toContainText("جهاز دعم — قراءة بس — بينتهي");
  await expect(supportPage.getByText(S.emptySlotQuickActionLabel, { exact: true })).toHaveCount(0);
  await expect(supportPage.locator("header").first()).toContainText("دعم كلينترا — مسؤول الدعم");
  await expect(supportPage.locator("header").first()).not.toContainText(OWNER_NAME);
  await expect(supportPage.locator("header").first().getByRole("button", { name: /قفل|تبديل/ })).toHaveCount(0);
  await expect(supportPage.getByText("منى عبد الله").first()).toBeVisible();
  await expectReadOnlyNavigation(supportPage);
  await captureThemes(supportPage, "support-day", testInfo.project.name);
  await sidebar(supportPage).getByRole("button", { name: SIDEBAR.navPatients, exact: true }).click();
  await supportPage.getByRole("textbox", { name: "دوّر على مريض" }).fill("منى");
  await expect(supportPage.getByRole("list", { name: "نتايج البحث" }).getByText("منى عبد الله")).toBeVisible();
  await expectReadOnlyNavigation(supportPage);
  await captureThemes(supportPage, "support-patients", testInfo.project.name);
  await supportPage.getByRole("list", { name: "نتايج البحث" }).getByRole("button").first().click();
  await expectReadOnlyNavigation(supportPage);
  const profileTabs = supportPage.locator("main:visible [data-support-navigation] button:visible");
  const tabCount = await profileTabs.count();
  expect(tabCount).toBeGreaterThan(0);
  for (let index = 0; index < tabCount; index++) {
    await profileTabs.nth(index).click();
    await expectReadOnlyNavigation(supportPage);
  }
  await captureThemes(supportPage, "support-patient-profile", testInfo.project.name);
  await supportPage.getByRole("button", { name: /رجوع|النتايج|البحث/ }).first().click();
  await sidebar(supportPage).getByRole("button", { name: SIDEBAR.navMessages, exact: true }).click();
  await expectReadOnlyNavigation(supportPage);
  await captureThemes(supportPage, "support-messages", testInfo.project.name);
  await sidebar(supportPage).getByRole("button", { name: SIDEBAR.navReports, exact: true }).click();
  await expectReadOnlyNavigation(supportPage);
  await captureThemes(supportPage, "support-reports", testInfo.project.name);
  await sidebar(supportPage).getByRole("button", { name: SIDEBAR.navAudit, exact: true }).click();
  await expect(supportPage.getByRole("dialog").first()).toBeVisible();
  await expectReadOnlyNavigation(supportPage);
  await captureThemes(supportPage, "support-audit", testInfo.project.name);
  await sidebar(supportPage).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  await expect(supportPage.getByRole("dialog").first()).toBeVisible();
  for (const [tab, name] of [[S.settingsHoursTab, "hours"], [S.settingsServicesTab, "services"], [S.settingsStaffTab, "staff"], [S.settingsPractitionersTab, "practitioners"]] as const) {
    await supportPage.getByRole("dialog").first().getByRole("button", { name: tab, exact: true }).click();
    await expectReadOnlyNavigation(supportPage);
    await captureThemes(supportPage, `support-settings-${name}`, testInfo.project.name);
  }
  await sidebar(supportPage).getByRole("button", { name: SIDEBAR.navVisit, exact: true }).click();
  await expectReadOnlyNavigation(supportPage);
  await captureThemes(supportPage, "support-visit", testInfo.project.name);
  expect(pushes).toBe(0);
  await supportPage.clock.fastForward(60_001);
  await expect(supportPage.getByText("انتهى وصول الدعم")).toBeVisible();
  await expect.poll(() => supportPage.evaluate(async () => (await indexedDB.databases()).some((row) => row.name === "clintra-support"))).toBe(false);
  await expect(page.getByText("منى عبد الله").first()).toBeVisible();
  await captureThemes(supportPage, "support-expired", testInfo.project.name);
  await supportPage.close();
});
