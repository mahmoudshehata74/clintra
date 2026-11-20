import { expect, test, type Page } from "@playwright/test";
import { registrationStrings as activation } from "../src/auth/registrationStrings";
import { enterPin, lockOverlay } from "./support";

const ownerName = "منى الشريف";

async function activate(page: Page) {
  const orgId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const membership = {
    id: membershipId, user_id: userId, org_id: orgId, role: "owner", display_name: ownerName,
    location_scope: "all", practitioner_scope: "all", practitioner_id: null, pin_hash: "", pin_salt: null, is_active: true, rev: 1,
  };
  await page.route("**/api/devices/register", async (route) => {
    const { device_id } = route.request().postDataJSON() as { device_id: string };
    await route.fulfill({ json: {
      token: "1|identity-fixture", device_id, org_id: orgId, location_id: locationId, membership_id: membershipId, series: 1,
      organization: { id: orgId, name: "عيادة تجريبية", plan_tier: "small", created_at: new Date().toISOString() },
      locations: [{ id: locationId, org_id: orgId, name: "الفرع الرئيسي", address: "شارع التحرير", phone: "+20221234567", is_active: true }],
      practitioners: [], memberships: [membership], users: [{ id: userId, full_name: ownerName, phone: "+201001234567", email: null, is_active: true }],
    } });
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { time: new Date().toISOString() } }));
  await page.route("**/api/auth/login", async (route) => {
    const proof = route.request().headers()["x-clintra-device-proof"];
    expect(proof).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{86}$/);
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ username: "owner", device_public_key: { crv: "P-256" }, credential_public_key: { crv: "P-256" } });
    expect(body.device_public_key).not.toHaveProperty("d");
    expect(body.credential_public_key).not.toHaveProperty("d");
    await route.fulfill({ json: { ...membership, membership_id: membershipId, credential_id: body.credential_id, must_change_password: true } });
  });
  await page.route("**/api/auth/password", async (route) => {
    expect(route.request().headers()["x-clintra-person-proof"]).toMatch(/^v1\.[a-f0-9-]{36}\.\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{86}$/);
    expect(route.request().postDataJSON()).toEqual({ current_password: "temporary password", password: "a new test password" });
    await route.fulfill({ json: { must_change_password: false } });
  });
  await page.route(/\/api\/(sync\/(bootstrap|pull)|audit\/pull)(\?.*)?$/, (route) => route.fulfill({ json: { cursor: "0", has_more: false, rows: [] } }));
  await page.goto("/");
  const form = page.getByRole("dialog", { name: activation.formAria });
  await form.getByLabel(activation.phoneLabel).fill("01001234567");
  await form.getByLabel(activation.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await form.getByRole("button", { name: activation.submitLabel }).click();
  await form.getByRole("button", { name: activation.startLabel, exact: true }).click();
}

async function firstSignIn(page: Page, capture?: (screen: string) => Promise<void>) {
  const lock = lockOverlay(page);
  await lock.getByRole("button", { name: "تسجيل الدخول بالحساب" }).click();
  await expect(lock.getByRole("heading", { name: "تسجيل الدخول بالحساب" })).toBeVisible();
  await capture?.("sign-in");
  await lock.getByLabel("اسم المستخدم").fill("owner");
  const password = lock.getByLabel("كلمة المرور", { exact: true });
  await password.fill("temporary password");
  await expect(password).toHaveAttribute("type", "password");
  await lock.getByRole("button", { name: "إظهار كلمة المرور" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await lock.getByRole("button", { name: "إخفاء كلمة المرور" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await lock.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(lock.getByRole("heading", { name: "تغيير كلمة المرور" })).toBeVisible();
  await expect(lock.getByLabel("كلمة المرور الجديدة")).toHaveAccessibleDescription("10 أحرف على الأقل");
  await expect(lock.getByLabel("أعد كتابتها")).toHaveAccessibleDescription("10 أحرف على الأقل");
  await capture?.("change-password");
  await lock.getByLabel("كلمة المرور الحالية").fill("temporary password");
  await lock.getByLabel("كلمة المرور الجديدة").fill("a new test password");
  await lock.getByLabel("أعد كتابتها").fill("a new test password");
  await lock.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(lock.getByRole("heading", { name: "اختر رقمًا سريًا" })).toBeVisible();
  await capture?.("choose-pin");
  await lock.getByLabel("الرقم السري", { exact: true }).fill("2468");
  await lock.getByLabel("أعد إدخاله").fill("2468");
  await lock.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(lock).toBeHidden();
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("a temporary password is replaced and the new PIN unlocks after reloading offline", async ({ page, context }) => {
      await activate(page);
      await firstSignIn(page);
      await page.reload();
      const lock = lockOverlay(page);
      await lock.getByRole("button", { name: new RegExp(ownerName) }).click();
      await context.setOffline(true);
      await enterPin(page, "2468");
      await expect(lock).toBeHidden();
    });

    test("identity screens @screenshot", async ({ page }, info) => {
      await activate(page);
      await firstSignIn(page, async (screen) => {
        await page.screenshot({ path: `e2e/identity-shots/${screen}-${info.project.name}-${colorScheme}.png` });
      });
    });
  });
}
