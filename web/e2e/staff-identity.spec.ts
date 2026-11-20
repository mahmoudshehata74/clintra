import { expect, test, type Page } from "@playwright/test";
import { registrationStrings as activation } from "../src/auth/registrationStrings";
import { lockOverlay, S, sidebar, SIDEBAR } from "./support";

const assistant = "سارة حسن";
const password = "test-only owner password";
const temporary = "TestPass7821";

async function registered(page: Page) {
  const org_id = crypto.randomUUID();
  const location_id = crypto.randomUUID();
  const practitioner_id = crypto.randomUUID();
  const owner = {
    id: crypto.randomUUID(), user_id: crypto.randomUUID(), org_id, role: "owner", username: "owner", permissions: [],
    location_scope: "all", practitioner_scope: "all", practitioner_id, is_active: true, rev: 1, display_name: "منى الشريف",
  };
  const staff = { ...owner, id: crypto.randomUUID(), user_id: crypto.randomUUID(), role: "assistant", username: "sara", display_name: assistant, practitioner_id: null };
  const at = new Date().toISOString();
  const device = { id: "", credential: crypto.randomUUID() };
  await page.route("**/api/devices/register", (route) => {
    device.id = route.request().postDataJSON().device_id;
    return route.fulfill({ json: {
      token: "1|staff-identity-fixture", id: device.id, device_id: device.id, org_id, location_id, membership_id: owner.id,
      series: 1, identity_enforced_at: at, organization: { id: org_id, name: "عيادة تجريبية", plan_tier: "small", created_at: at },
      locations: [{ id: location_id, org_id, name: "الفرع الرئيسي", address: "شارع التحرير", phone: "+20221234567", is_active: true }],
      practitioners: [{ id: practitioner_id, org_id, user_id: owner.user_id, full_name: "منى الشريف", is_active: true, title: "د.", rev: 1 }],
      memberships: [owner, staff], users: [owner, staff].map((row) => ({ id: row.user_id, full_name: row.display_name, is_active: true })),
    } });
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { time: new Date().toISOString() } }));
  await page.route(/\/api\/(sync\/(bootstrap|pull)|audit\/pull)(\?.*)?$/, (route) => route.fulfill({ json: { cursor: "0", has_more: false, rows: [], identity_enforced_at: at } }));
  await page.route("**/api/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ username: "owner", password });
    await route.fulfill({ json: { ...owner, membership_id: owner.id, must_change_password: false, pin_salt: "0011", pin_hash: "test" } });
  });
  await page.route("**/api/auth/owner-recovery", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ phone: "01001234567", code: "CLT-7F3K-9QRT-4XWM-2BCD", username: "owner", password });
    await route.fulfill({ json: { membership_id: owner.id, username: "owner" } });
  });
  await page.route(/\/api\/staff\//, async (route) => {
    const request = route.request();
    expect(request.headers()["x-clintra-person-proof"]).toMatch(/^v1\./);
    if (request.method() !== "GET") expect(request.postDataJSON().password).toBe(password);
    if (request.method() === "GET") {
      await route.fulfill({ json: { credentials: [{ id: device.credential, membership_id: staff.id, location_id, device_id: device.id, series: 1 }] } });
    } else if (request.method() === "DELETE") {
      await route.fulfill({ json: { revoked: true } });
    } else if (request.url().endsWith("/password-reset")) {
      await route.fulfill({ json: { temporary_password: temporary, must_change_password: true } });
    } else if (request.method() === "PUT") {
      expect(request.postDataJSON().username).toBe("sara.new");
      await route.fulfill({ json: { username: "sara.new", rev: 2, membership_id: staff.id } });
    } else {
      expect(request.postDataJSON().permissions).toEqual(["reports.view"]);
      await route.fulfill({ json: { permissions: ["reports.view"], rev: 3, membership_id: staff.id } });
    }
  });
  await page.goto("/");
  const form = page.getByRole("dialog", { name: activation.formAria });
  await form.getByLabel(activation.phoneLabel).fill("01001234567");
  await form.getByLabel(activation.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await form.getByRole("button", { name: activation.submitLabel }).click();
  await form.getByRole("button", { name: activation.startLabel, exact: true }).click();
}

async function staffWorkflow(page: Page, shot?: (screen: string) => Promise<void>) {
  await registered(page);
  const lock = lockOverlay(page);
  await lock.getByRole("button", { name: "دخول بحساب" }).click();
  await lock.getByRole("button", { name: "نسيت كلمة السر؟" }).click();
  await expect(lock.getByRole("heading", { name: "استرجاع حساب صاحب العيادة" })).toBeVisible();
  await shot?.("a3-owner-recovery");
  await lock.getByLabel("موبايل صاحب العيادة").fill("01001234567");
  await lock.getByLabel("كود الاسترجاع").fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await lock.getByLabel("اسم المستخدم").fill("owner");
  await lock.getByLabel("كلمة السر الجديدة").fill(password);
  await lock.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(lock).toBeHidden();

  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  const member = settings.getByRole("listitem").filter({ hasText: assistant });
  async function open(label: string, name: string) {
    await member.getByRole("button", { name: label, exact: true }).click();
    const heading = member.getByRole("heading", { name: label, exact: true });
    await expect(heading).toBeVisible();
    await heading.scrollIntoViewIfNeeded();
    await shot?.(name);
  }
  async function confirm() {
    await member.getByLabel("اكتب كلمة السر بتاعتك للتأكيد").fill(password);
    await member.getByRole("button", { name: "تأكيد", exact: true }).click();
  }

  await open("اسم المستخدم", "a3-username");
  await member.getByLabel("اسم المستخدم").fill("sara.new");
  await confirm();
  await open("إعادة تعيين كلمة السر", "a3-password-reset");
  await confirm();
  await expect(member.getByLabel("كلمة السر المؤقتة")).toHaveValue(temporary);
  await expect(member.getByText("اديها للموظف وهيغيّرها أول ما يدخل")).toBeVisible();
  await expect(member.getByRole("button", { name: "نسخ", exact: true })).toBeVisible();
  await shot?.("a3-temporary-password");
  await member.getByRole("button", { name: "رجوع", exact: true }).click();
  await expect(member.getByLabel("كلمة السر المؤقتة")).toHaveCount(0);

  await member.getByRole("button", { name: "الأجهزة اللي داخل منها", exact: true }).click();
  await expect(member.getByText("جهاز 1 · الفرع الرئيسي")).toBeVisible();
  await shot?.("a3-devices");
  await open("إلغاء الدخول من الجهاز ده", "a3-revoke");
  await confirm();
  await expect(member.getByText("مفيش أجهزة مسجّل دخول عليها")).toBeVisible();
  await member.getByRole("button", { name: "رجوع", exact: true }).click();

  await open("الصلاحيات", "a3-permissions");
  await expect(member.getByRole("switch")).toHaveCount(10);
  await member.getByRole("switch", { name: /عرض التقارير/ }).check();
  await confirm();
  await expect(member.getByRole("heading", { name: "الصلاحيات", exact: true })).toHaveCount(0);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test("owner recovery, staff account changes, device revoke and the permission editor", async ({ page }) => {
      await staffWorkflow(page);
    });
    test("staff identity screens @screenshot", async ({ page }, info) => {
      await staffWorkflow(page, async (screen) => {
        await page.screenshot({ path: `e2e/identity-shots/${screen}-${info.project.name}-${colorScheme}.png` });
      });
    });
  });
}
