import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { registrationStrings as activation } from "../src/auth/registrationStrings";
import { AUTH, enterPin, lockOverlay, S, sidebar, SIDEBAR } from "./support";

const ownerPassword = "owner lifecycle password";
const temporary = "TempLifecycle7821";
const staffPassword = "staff lifecycle password";
const recovery = "CLT-7F3K-9QRT-4XWM-2BCD";
const phone = "+201001234567";

test("an enforced clinic goes from owner setup through staff onboarding, cross-device permissions, reset, revoke and recovery", async ({ page: a, browser }, info) => {
  const context = await browser.newContext({ viewport: info.project.use.viewport });
  const b = await context.newPage();
  const org_id = crypto.randomUUID();
  const location_id = crypto.randomUUID();
  const practitioner_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const owner = {
    id: crypto.randomUUID(), org_id, user_id: crypto.randomUUID(), display_name: "منى الشريف", role: "owner",
    practitioner_id, location_scope: "all", practitioner_scope: "all", is_active: true, rev: 1,
    username: "owner", permissions: [] as string[],
  };
  const staff = { ...owner, id: crypto.randomUUID(), user_id: crypto.randomUUID(), display_name: "سارة حسن",
    role: "assistant", practitioner_id: null, username: "", permissions: [] as string[] };
  const credentials: { id: string; membership_id: string; device_id: string; created_at: string; series: number; location_id: string }[] = [];
  const devices = new Map<BrowserContext, string>();
  const passwords = new Map([[owner.id, ownerPassword]]);
  let mustChange = true;
  let enforced = false;
  let recovered = 0;
  const changes: { entity: string; entity_id: string; rev: number; payload: typeof staff }[] = [];

  async function install(target: Page, series: number) {
    await target.route("**/api/devices/register", (route) => {
      const device_id = route.request().postDataJSON().device_id as string;
      devices.set(target.context(), device_id);
      return route.fulfill({ json: {
        token: `1|lifecycle-${series}`, device_id, org_id, location_id, membership_id: owner.id, series,
        organization: { id: org_id, name: "عيادة دورة الحساب", plan_tier: "small", created_at: now },
        memberships: [owner, staff], users: [owner, staff].map((member) => ({ id: member.user_id, full_name: member.display_name, is_active: true })),
        locations: [{ id: location_id, org_id, name: "الفرع الرئيسي", is_active: true }],
        practitioners: [{ id: practitioner_id, org_id, user_id: owner.user_id, full_name: owner.display_name, is_active: true, rev: 1 }],
      } });
    });
    await target.route("**/api/health", (route) => route.fulfill({ json: { time: new Date().toISOString() } }));
    await target.route("**/api/auth/rollout", (route) => route.fulfill({ json: {
      members: [{ ...owner, has_username: true }, { ...staff, has_username: Boolean(staff.username) }],
    } }));
    await target.route(/\/api\/(sync\/(bootstrap|pull)|audit\/pull)(\?.*)?$/, (route) => route.fulfill({ json: {
      cursor: String(changes.length), has_more: false, rows: route.request().url().includes("/audit/") ? [] : changes,
      ...(enforced ? { identity_enforced_at: now } : {}),
    } }));
    await target.route("**/api/auth/owner-recovery", (route) => {
      expect(route.request().postDataJSON()).toEqual({ phone, code: recovery, username: "owner", password: ownerPassword });
      recovered++;
      return route.fulfill({ json: { membership_id: owner.id, username: "owner" } });
    });
    await target.route("**/api/auth/login", (route) => {
      const body = route.request().postDataJSON();
      const member = body.username === owner.username ? owner : staff;
      expect(body.username).toBe(member.username);
      expect(body.password).toBe(passwords.get(member.id));
      expect(route.request().headers()["x-clintra-device-proof"]).toMatch(/^v1\./);
      credentials.push({ id: body.credential_id, membership_id: member.id, device_id: devices.get(target.context())!,
        created_at: now, series, location_id });
      return route.fulfill({ json: { ...member, membership_id: member.id, must_change_password: member.id === staff.id && mustChange } });
    });
    await target.route("**/api/auth/password", (route) => {
      expect(route.request().postDataJSON()).toEqual({ current_password: temporary, password: staffPassword });
      expect(route.request().headers()["x-clintra-person-proof"]).toMatch(/^v1\./);
      passwords.set(staff.id, staffPassword);
      mustChange = false;
      return route.fulfill({ json: { must_change_password: false } });
    });
    await target.route(/\/api\/staff\//, (route) => {
      const request = route.request();
      expect(request.headers()["x-clintra-person-proof"]).toMatch(/^v1\./);
      if (request.method() === "GET") return route.fulfill({ json: { credentials } });
      expect(request.postDataJSON().password).toBe(ownerPassword);
      if (request.method() === "PUT") {
        staff.username = request.postDataJSON().username;
        staff.rev++;
        return route.fulfill({ json: { membership_id: staff.id, username: staff.username, rev: staff.rev } });
      }
      if (request.url().endsWith("/password-reset")) {
        passwords.set(staff.id, temporary);
        mustChange = true;
        for (let i = credentials.length - 1; i >= 0; i--) if (credentials[i].membership_id === staff.id) credentials.splice(i, 1);
        return route.fulfill({ json: { temporary_password: temporary, must_change_password: true } });
      }
      if (request.method() === "DELETE") {
        const id = request.url().split("/").at(-1);
        const index = credentials.findIndex((credential) => credential.id === id);
        expect(index).toBeGreaterThanOrEqual(0);
        credentials.splice(index, 1);
        return route.fulfill({ json: { revoked: true } });
      }
      staff.permissions = request.postDataJSON().permissions;
      staff.rev++;
      changes.push({ entity: "memberships", entity_id: staff.id, rev: staff.rev, payload: { ...staff } });
      return route.fulfill({ json: { membership_id: staff.id, permissions: staff.permissions, rev: staff.rev } });
    });
    await target.goto("/");
    const registration = target.getByRole("dialog", { name: activation.formAria });
    await registration.getByLabel(activation.phoneLabel).fill(phone);
    await registration.getByLabel(activation.codeLabel).fill(recovery);
    await registration.getByRole("button", { name: activation.submitLabel }).click();
    await registration.getByRole("button", { name: activation.startLabel, exact: true }).click();
  }

  async function confirmPin(target: Page) {
    const lock = lockOverlay(target);
    await lock.getByLabel("الرقم السري", { exact: true }).fill("2468");
    await lock.getByLabel("أعد إدخاله").fill("2468");
    await lock.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(lock).toBeHidden();
  }
  async function staffRows() {
    await sidebar(a).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
    await a.getByRole("dialog").getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
    return a.getByRole("dialog").getByRole("listitem").filter({ hasText: staff.display_name });
  }
  async function stepUp() {
    const row = a.getByRole("dialog").getByRole("listitem").filter({ hasText: staff.display_name });
    await row.getByLabel("اكتب كلمة المرور الخاصة بك للتأكيد").fill(ownerPassword);
    await row.getByRole("button", { name: "تأكيد", exact: true }).click();
  }
  try {
    await install(a, 1);
    await lockOverlay(a).getByRole("button", { name: "إنشاء حسابك" }).click();
    await lockOverlay(a).getByLabel("رقم هاتف مالك العيادة").fill(phone);
    await lockOverlay(a).getByLabel("رمز التفعيل").fill(recovery);
    await lockOverlay(a).getByLabel("اسم المستخدم").fill("owner");
    await lockOverlay(a).getByLabel("كلمة المرور الجديدة").fill(ownerPassword);
    await lockOverlay(a).getByRole("button", { name: "حفظ", exact: true }).click();
    await confirmPin(a);
    const member = await staffRows();
    await member.getByRole("button", { name: "اسم المستخدم", exact: true }).click();
    await member.getByLabel("اسم المستخدم").fill("sara");
    await stepUp();
    await member.getByRole("button", { name: "إعادة تعيين كلمة المرور" }).click();
    await stepUp();
    await expect(member.getByLabel("كلمة المرور المؤقتة")).toHaveValue(temporary);
    await member.getByRole("button", { name: "رجوع", exact: true }).click();
    await a.keyboard.press("Escape");
    enforced = true;
    await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await install(b, 2);
    await lockOverlay(b).getByRole("button", { name: "تسجيل الدخول بالحساب" }).click();
    await lockOverlay(b).getByLabel("اسم المستخدم").fill("sara");
    await lockOverlay(b).getByLabel("كلمة المرور", { exact: true }).fill(temporary);
    await lockOverlay(b).getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
    await expect(lockOverlay(b).getByRole("heading", { name: "تغيير كلمة المرور" })).toBeVisible();
    await lockOverlay(b).getByLabel("كلمة المرور الحالية").fill(temporary);
    await lockOverlay(b).getByLabel("كلمة المرور الجديدة").fill(staffPassword);
    await lockOverlay(b).getByLabel("أعد كتابتها").fill(staffPassword);
    await lockOverlay(b).getByRole("button", { name: "حفظ", exact: true }).click();
    await confirmPin(b);
    await b.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
    await enterPin(b, "2468");
    await expect(lockOverlay(b)).toBeHidden();
    await expect(sidebar(b).getByRole("button", { name: SIDEBAR.navMessages, exact: true })).toHaveCount(0);
    const row = await staffRows();
    await row.getByRole("button", { name: "الصلاحيات", exact: true }).click();
    await row.getByRole("switch", { name: /إرسال الرسائل/ }).check();
    await stepUp();
    await expect.poll(async () => {
      await b.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      return sidebar(b).getByRole("button", { name: SIDEBAR.navMessages, exact: true }).count();
    }).toBe(1);
    await expect(sidebar(b).getByRole("button", { name: SIDEBAR.navMessages, exact: true })).toBeVisible();
    await row.getByRole("button", { name: "إعادة تعيين كلمة المرور" }).click();
    await stepUp();
    await expect(row.getByLabel("كلمة المرور المؤقتة")).toHaveValue(temporary);
    await row.getByRole("button", { name: "رجوع", exact: true }).click();
    // A fresh sign-in is required after the reset and yields a credential
    // that the owner can revoke independently of the device.
    await b.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
    await lockOverlay(b).getByRole("button", { name: "تسجيل الدخول بالحساب" }).click();
    await lockOverlay(b).getByLabel("اسم المستخدم").fill("sara");
    await lockOverlay(b).getByLabel("كلمة المرور", { exact: true }).fill(temporary);
    await lockOverlay(b).getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
    await expect(lockOverlay(b).getByRole("heading", { name: "تغيير كلمة المرور" })).toBeVisible();
    await row.getByRole("button", { name: "الأجهزة المسجَّل الدخول منها" }).click();
    await row.getByRole("button", { name: "إلغاء تسجيل الدخول من هذا الجهاز" }).click();
    await row.getByLabel("اكتب كلمة المرور الخاصة بك للتأكيد").fill(ownerPassword);
    await row.getByRole("button", { name: "إلغاء الدخول", exact: true }).click();
    await expect(row.getByText("لا توجد أجهزة مسجَّل الدخول منها")).toBeVisible();
    await a.keyboard.press("Escape");
    await a.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
    await lockOverlay(a).getByRole("button", { name: "تسجيل الدخول بالحساب" }).click();
    await lockOverlay(a).getByRole("link", { name: "نسيت كلمة المرور؟" }).click();
    await lockOverlay(a).getByLabel("رقم هاتف مالك العيادة").fill(phone);
    await lockOverlay(a).getByLabel("رمز الاسترداد").fill(recovery);
    await lockOverlay(a).getByLabel("اسم المستخدم").fill("owner");
    await lockOverlay(a).getByLabel("كلمة المرور الجديدة").fill(ownerPassword);
    await lockOverlay(a).getByRole("button", { name: "حفظ", exact: true }).click();
    await confirmPin(a);
    expect(recovered).toBe(2);
  } finally {
    await context.close();
  }
});
