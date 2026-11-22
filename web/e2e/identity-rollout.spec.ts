import { shotDirectory } from "./browserArtifacts";
import { expect, test, type Page } from "@playwright/test";
import { registrationStrings as activation } from "../src/auth/registrationStrings";
import { lockOverlay, sidebar, SIDEBAR } from "./support";

const password = "a fixture password";
const code = "CLT-7F3K-9QRT-4XWM-2BCD";
const phone = "+201001234567";
const timestamp = "2026-11-20T10:00:00Z";

async function rollout(page: Page, shot?: (screen: string) => Promise<void>) {
  const org_id = crypto.randomUUID();
  const location_id = crypto.randomUUID();
  const practitioner_id = crypto.randomUUID();
  const owner = {
    id: crypto.randomUUID(), org_id, user_id: crypto.randomUUID(), display_name: "منى الشريف", role: "owner",
    practitioner_id, location_scope: "all", practitioner_scope: "all", is_active: true, rev: 1,
  };
  const staff = { ...owner, id: crypto.randomUUID(), user_id: crypto.randomUUID(), role: "assistant", practitioner_id: null, display_name: "سارة حسن" };
  let deviceId: string;
  let prepared = false;
  let enabled = false;
  function status() {
    return {
      ready: prepared, waiting: !prepared, auto_at: timestamp, identity_enforced_at: enabled ? timestamp : null,
      blockers: prepared ? [] : ["rolloutUsernamesMissing", "rolloutDevicesUnbound"],
      members: [
        { ...owner, has_username: true, has_password: true, signed_in: true },
        { ...staff, has_username: prepared, has_password: prepared, signed_in: prepared },
      ],
      devices: [{ id: deviceId, location_id, series: 1, bound: true }, { id: "second", location_id, series: 2, bound: prepared }],
    };
  }
  await page.route("**/api/devices/register", (route) => {
    deviceId = route.request().postDataJSON().device_id;
    return route.fulfill({ json: {
      token: "1|rollout-fixture", device_id: deviceId, org_id, location_id, membership_id: owner.id, series: 1,
      organization: { id: org_id, name: "عيادة تجريبية", plan_tier: "small", created_at: timestamp },
      memberships: [owner, staff], users: [owner, staff].map((member) => ({ id: member.user_id, full_name: member.display_name, is_active: true })),
      locations: [{ id: location_id, org_id, name: "الفرع الرئيسي", is_active: true }],
      practitioners: [{ id: practitioner_id, org_id, user_id: owner.user_id, full_name: owner.display_name, is_active: true, title: "د.", rev: 1 }],
    } });
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { time: new Date().toISOString() } }));
  await page.route(/\/api\/(sync\/(bootstrap|pull)|audit\/pull)(\?.*)?$/, (route) => route.fulfill({ json: {
    cursor: "0", has_more: false, rows: [],
    ...(enabled ? { identity_enforced_at: timestamp } : { identity_rollout_auto_at: timestamp }),
  } }));
  await page.route("**/api/auth/owner-recovery", (route) => {
    expect(route.request().postDataJSON()).toEqual({ phone, code, username: "owner", password });
    return route.fulfill({ json: { membership_id: owner.id, username: "owner" } });
  });
  await page.route("**/api/auth/login", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ username: "owner", password, device_public_key: { crv: "P-256" } });
    return route.fulfill({ json: { ...owner, membership_id: owner.id, username: "owner", must_change_password: false } });
  });
  await page.route("**/api/auth/rollout", (route) => {
    expect(route.request().headers()["x-clintra-person-proof"]).toMatch(/^v1\./);
    return route.fulfill({ json: status() });
  });
  await page.route("**/api/auth/rollout/enable", (route) => {
    expect(route.request().headers()["x-clintra-person-proof"]).toMatch(/^v1\./);
    expect(route.request().postDataJSON()).toEqual({ password });
    expect(prepared).toBe(true);
    enabled = true;
    return route.fulfill({ json: status() });
  });

  await page.goto("/");
  const registration = page.getByRole("dialog", { name: activation.formAria });
  await registration.getByLabel(activation.phoneLabel).fill(phone);
  await registration.getByLabel(activation.codeLabel).fill(code);
  await registration.getByRole("button", { name: activation.submitLabel }).click();
  await registration.getByRole("button", { name: activation.startLabel, exact: true }).click();
  const lock = lockOverlay(page);
  await lock.getByRole("button", { name: "إنشاء حسابك" }).click();
  await expect(lock.getByRole("heading", { name: "إنشاء حسابك" })).toBeVisible();
  await shot?.("a4-owner-setup");
  await lock.getByLabel("رقم هاتف مالك العيادة").fill(phone);
  await lock.getByLabel("رمز التفعيل").fill(code);
  await lock.getByLabel("اسم المستخدم").fill("owner");
  await lock.getByLabel("كلمة المرور الجديدة").fill(password);
  await lock.getByRole("button", { name: "حفظ", exact: true }).click();
  await lock.getByLabel("الرقم السري", { exact: true }).fill("2468");
  await lock.getByLabel("أعد إدخاله").fill("2468");
  await lock.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(lock).toBeHidden();
  await expect(page.getByText("بدأت المرحلة الأخيرة من إعداد الدخول بكلمة المرور.", { exact: false })).toBeVisible();
  await shot?.("a4-warning-banner");

  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: "الدخول بكلمة المرور", exact: true }).click();
  const enable = settings.getByRole("button", { name: "تفعيل للكل" });
  await expect(enable).toBeDisabled();
  await expect(settings.getByText("انتهت فترة الإعداد.", { exact: false })).toBeVisible();
  await expect(settings.getByRole("list", { name: "حالة الموظفين" }).getByText("عيّن اسم مستخدم من قسم الموظفين.")).toBeVisible();
  await expect(settings.getByRole("list", { name: "حالة الأجهزة" }).getByText("سجّل الدخول بكلمة المرور مرة واحدة على هذا الجهاز.")).toBeVisible();
  await shot?.("a4-readiness-waiting");

  prepared = true;
  await settings.getByRole("button", { name: "تحديث الحالة" }).click();
  await expect(enable).toBeEnabled();
  await shot?.("a4-readiness-ready");
  await enable.click();
  const input = settings.getByLabel("اكتب كلمة المرور الخاصة بك للتأكيد");
  await input.scrollIntoViewIfNeeded();
  await shot?.("a4-enable-confirm");
  await input.fill(password);
  await expect(settings.locator("bdi")).toHaveAttribute("dir", "ltr");
  await expect(settings.locator("bdi")).toHaveText("0");
  await settings.getByRole("button", { name: "تفعيل للكل", exact: true }).click();
  await expect(settings.getByText("الدخول بكلمة المرور مفعّل لجميع الموظفين.")).toBeVisible();
  await shot?.("a4-enforced");
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });
    test("owner sets up with a recovery code, inspects readiness and enables the organization", async ({ page }) => {
      await rollout(page);
    });

    test("identity rollout screens @screenshot", async ({ page }, info) => {
      await rollout(page, async (screen) => {
        await page.screenshot({ path: `${shotDirectory("e2e/identity-shots")}/${screen}-${info.project.name}-${colorScheme}.png` });
      });
    });
  });
}
