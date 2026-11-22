import { shotDirectory } from "./browserArtifacts";
import { expect, test, type Page } from "@playwright/test";
import { registrationStrings as activation } from "../src/auth/registrationStrings";
import { suspensionStrings } from "../src/sync/organizationSuspension";
import { cairoInstant, todayInCairo, weekdayOf } from "../src/domain/time";
import { bookFirstOpenSlot, lockOverlay, readStore, SIDEBAR, AUTH, enterPin } from "./support";

async function expectSuspensionInFlow(page: Page) {
  const notice = page.locator('[data-organization-suspension]').last();
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(suspensionStrings.banner);
  const geometry = await notice.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    let nextElement = element.nextElementSibling;
    while (nextElement && nextElement.getClientRects().length === 0) nextElement = nextElement.nextElementSibling;
    const next = nextElement!.getBoundingClientRect();
    return { position: getComputedStyle(element).position, bottom: bounds.bottom, nextTop: next.top };
  });
  expect(geometry.position).toBe('static');
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.nextTop + 1);
  return notice;
}

test("a suspended clinic keeps local bookings and resumes on reconnect", async ({ page }, testInfo) => {
  const org_id = crypto.randomUUID();
  const location_id = crypto.randomUUID();
  const practitioner_id = crypto.randomUUID();
  const member = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), org_id, role: "owner", practitioner_id,
    display_name: "منى الشريف", is_active: true, location_scope: "all", practitioner_scope: "all", rev: 1 };
  const today = todayInCairo();
  const at = cairoInstant(today, "08:30");
  await page.clock.install({ time: new Date(at) });
  const payloads = [
    ["services", { id: crypto.randomUUID(), org_id, name: "كشف عام", duration_minutes: 30, default_price: 30000, is_active: true, rev: 1 }],
    ["schedules", { id: crypto.randomUUID(), practitioner_id, location_id, weekday: weekdayOf(today), start_time: "09:00", end_time: "14:00",
      mode: "slots", slot_minutes: 30, max_capacity: null, resource_count: 1, rev: 1 }],
    ["patients", { id: crypto.randomUUID(), org_id, full_name: "مريض المزامنة", phone: null, gender: null,
      birth_year: null, note: null, archived_at: null, created_at: at, rev: 1 }],
  ] as const;
  let disabled = false;
  let calls = 0;
  await page.route("**/api/health", (route) => route.fulfill({ json: { time: at } }));
  await page.route("**/api/devices/register", (route) => route.fulfill({ json: {
    token: "1|suspension-test", device_id: route.request().postDataJSON().device_id, org_id, location_id,
    membership_id: member.id, series: 1, organization: { id: org_id, name: "عيادة المزامنة", plan_tier: "small", created_at: at },
    locations: [{ id: location_id, org_id, name: "الفرع الرئيسي", is_active: true }],
    practitioners: [{ id: practitioner_id, org_id, user_id: member.user_id, full_name: member.display_name, is_active: true, rev: 1 }],
    memberships: [member], users: [{ id: member.user_id, full_name: member.display_name, is_active: true }],
  } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: { ...member, membership_id: member.id, must_change_password: false } }));
  await page.route(/\/api\/(sync|audit)\//, (route) => {
    calls++;
    if (disabled) return route.fulfill({ status: 403, json: { error: "org_disabled" } });
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      return route.fulfill({ json: { results: (body.ops ?? body.rows ?? []).map((op: { op_id?: string; id?: string }) =>
        ({ op_id: op.op_id, id: op.id, status: "accepted", rev: 1 })) } });
    }
    return route.fulfill({ json: { cursor: "1", has_more: false,
      rows: request.url().includes("/audit/") ? [] : payloads.map(([entity, payload]) => ({ entity, entity_id: payload.id, rev: 1, payload })) } });
  });
  await page.goto("/");
  const registration = page.getByRole("dialog", { name: activation.formAria });
  await registration.getByLabel(activation.phoneLabel).fill("01001234567");
  await registration.getByLabel(activation.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await registration.getByRole("button", { name: activation.submitLabel }).click();
  await registration.getByRole("button", { name: activation.startLabel, exact: true }).click();
  const lock = lockOverlay(page);
  await lock.getByRole("button", { name: "تسجيل الدخول بالحساب" }).click();
  await lock.getByLabel("اسم المستخدم").fill("owner");
  await lock.getByLabel("كلمة المرور", { exact: true }).fill("fixture password");
  await lock.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await lock.getByLabel("الرقم السري", { exact: true }).fill("2468");
  await lock.getByLabel("أعد إدخاله").fill("2468");
  await lock.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(lock).toBeHidden();
  disabled = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expectSuspensionInFlow(page);
  const nav = page.getByRole("navigation", { name: SIDEBAR.navAriaLabel });
  for (const [screen, label] of Object.entries({ day: SIDEBAR.navDay, patients: SIDEBAR.navPatients,
    doctor: SIDEBAR.navDoctor, visit: SIDEBAR.navVisit, messages: SIDEBAR.navMessages,
    reports: SIDEBAR.navReports, audit: SIDEBAR.navAudit, settings: SIDEBAR.navSettings })) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    const notice = await expectSuspensionInFlow(page);
    if (screen === 'audit' || screen === 'settings') {
      await expect(page.getByRole('dialog').filter({ has: notice })).toBeVisible();
      const control = page.getByRole('dialog').filter({ has: notice }).getByRole('button').first();
      await expect(control).toBeVisible();
      await control.click({ trial: true });
    }
    await page.screenshot({ path: `${shotDirectory("e2e/admin-shots")}/b2-review-${testInfo.project.name}-${screen}.png` });
  }
  await nav.getByRole("button", { name: SIDEBAR.navDay, exact: true }).click();
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await expect(lock).toBeVisible();
  const lockNotice = await expectSuspensionInFlow(page);
  await expect(lock.locator('[data-organization-suspension]')).toHaveCount(1);
  await expect(page.locator('[data-organization-suspension]')).toHaveCount(1);
  expect(await lockNotice.evaluate(element => element.closest('[role="dialog"]')?.getAttribute('aria-label'))).toBe(AUTH.lockOverlayAria);
  await page.screenshot({ path: `${shotDirectory("e2e/admin-shots")}/b2-review-${testInfo.project.name}-locked.png` });
  await enterPin(page, "2468");
  await expect(lock).toBeHidden();
  await page.context().setOffline(true);
  const pausedCalls = calls;
  await bookFirstOpenSlot(page, "مريض المزامنة");
  const queued = await readStore<{ synced_at: string | null; failure_count: number; payload: { service_id?: string } }>(page, "sync_ops");
  expect(queued.some((op) => op.synced_at === null && op.failure_count === 0)).toBe(true);
  expect(queued.some((op) => op.payload.service_id === payloads[0][1].id)).toBe(true);
  expect(calls).toBe(pausedCalls);
  await page.screenshot({ path: `${shotDirectory("e2e/admin-shots")}/b2-review-${testInfo.project.name}-offline-queue.png` });
  disabled = false;
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(suspensionStrings.banner)).toHaveCount(0);
  await expect.poll(async () => (await readStore<{ synced_at: string | null }>(page, "sync_ops")).every((op) => op.synced_at !== null)).toBe(true);
});


test("registration shows the exact disabled clinic line without registering", async ({ page }, testInfo) => {
  await page.route("**/api/devices/register", (route) => route.fulfill({ status: 403, json: {
    error: "org_disabled", message: "حساب العيادة موقوف. كلّم فريق كلينترا.",
  } }));
  await page.goto("/");
  const registration = page.getByRole("dialog", { name: activation.formAria });
  await registration.getByLabel(activation.phoneLabel).fill("01001234567");
  await registration.getByLabel(activation.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await registration.getByRole("button", { name: activation.submitLabel }).click();
  await expect(page.getByText("العيادة دي حسابها موقوف. كلّم فريق كلينترا.")).toBeVisible();
  expect(await readStore(page, "device")).toHaveLength(0);
  await page.screenshot({ path: `${shotDirectory("e2e/admin-shots")}/b2-review-${testInfo.project.name}-registration.png` });
});
