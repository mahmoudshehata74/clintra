import { shotDirectory } from "./browserArtifacts";
import { expect, test } from "@playwright/test";
import { registrationStrings as activation } from "../src/auth/registrationStrings";
import { lockOverlay } from "./support";

test("panel code notice appears on every clinic screen and expires on desktop and mobile", async ({ page }, info) => {
  const now = "2026-11-23T12:00:00Z";
  await page.clock.install({ time: new Date(now) });
  const org_id = crypto.randomUUID();
  const location_id = crypto.randomUUID();
  const practitioner_id = crypto.randomUUID();
  const member = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), org_id, role: "owner", practitioner_id,
    display_name: "منى الشريف", is_active: true, location_scope: "all", practitioner_scope: "all", rev: 1 };
  const notices = [
    { id: crypto.randomUUID(), purpose: "device", issued_at: "2026-11-23T10:00:00Z" },
    { id: crypto.randomUUID(), purpose: "owner_recovery", issued_at: "2026-11-15T10:00:00Z" },
  ];
  await page.route("**/api/health", (route) => route.fulfill({ json: { time: now } }));
  await page.route("**/api/devices/register", (route) => route.fulfill({ json: {
    token: "1|code-notice-test", device_id: route.request().postDataJSON().device_id, org_id, location_id,
    membership_id: member.id, series: 1, organization: { id: org_id, name: "عيادة الإشعار", plan_tier: "small", created_at: now },
    locations: [{ id: location_id, org_id, name: "الفرع الرئيسي", is_active: true }],
    practitioners: [{ id: practitioner_id, org_id, user_id: member.user_id, full_name: member.display_name, is_active: true, rev: 1 }],
    memberships: [member], users: [{ id: member.user_id, full_name: member.display_name, is_active: true }],
  } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: { ...member, membership_id: member.id, must_change_password: false } }));
  await page.route(/\/api\/(sync|audit)\//, (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { results: [] } });
    return route.fulfill({ json: { cursor: "1", has_more: false, rows: [], code_notices: notices } });
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
  await expect(page.locator('[data-code-notices]:visible').first()).toContainText("فريق كلينترا أصدر كود تفعيل جهاز جديد للعيادة في");
  await expect(page.locator('[data-code-notices]:visible').first()).not.toContainText("كود استرجاع");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `${shotDirectory("e2e/admin-shots")}/b5-web-notice-${info.project.name}-${colorScheme}.png`, fullPage: true });
  }
  await page.reload();
  await expect(page.locator('[data-code-notices]:visible').first()).toContainText("فريق كلينترا أصدر كود تفعيل جهاز جديد للعيادة في");
  await page.clock.fastForward(7 * 24 * 60 * 60 * 1000);
  await expect(page.locator('[data-code-notices]:visible')).toHaveCount(0);
});
