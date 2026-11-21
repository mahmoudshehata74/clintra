import { expect, test } from "@playwright/test";
import { registrationStrings as activation } from "../src/auth/registrationStrings";
import { suspensionStrings } from "../src/sync/organizationSuspension";
import { cairoInstant, todayInCairo, weekdayOf } from "../src/domain/time";
import { bookFirstOpenSlot, lockOverlay, readStore } from "./support";

test("a suspended clinic keeps local bookings and resumes on reconnect", async ({ page }) => {
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
  await expect(page.getByText(suspensionStrings.banner)).toBeVisible();
  const pausedCalls = calls;
  await bookFirstOpenSlot(page, "مريض المزامنة");
  const queued = await readStore<{ synced_at: string | null; failure_count: number; payload: { service_id?: string } }>(page, "sync_ops");
  expect(queued.some((op) => op.synced_at === null && op.failure_count === 0)).toBe(true);
  expect(queued.some((op) => op.payload.service_id === payloads[0][1].id)).toBe(true);
  expect(calls).toBe(pausedCalls);
  disabled = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(suspensionStrings.banner)).toHaveCount(0);
  await expect.poll(async () => (await readStore<{ synced_at: string | null }>(page, "sync_ops")).every((op) => op.synced_at !== null)).toBe(true);
});
