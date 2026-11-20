import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { AUTH, lockOverlay, readStore, S, sidebar, SIDEBAR } from "../e2e/support";
import { eventually, openDevice, setUpClinic } from "./liveSupport";
import { mintCode, provisionOrg, removeLiveOrgs, startApi, stopApi } from "./liveServer";

const exec = promisify(execFile);

function fixture(action: "prepare" | "prepare-rollout" | "enforce" | "deactivate", orgId: string) {
  return exec("php", [fileURLToPath(new URL("./identityFixture.php", import.meta.url)), action, orgId], {
    cwd: fileURLToPath(new URL("../../api/", import.meta.url)),
    env: { ...process.env, DB_DATABASE: "clintra_test" },
  });
}

async function accountSignIn(page: Page, username: string) {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  const lock = lockOverlay(page);
  await lock.getByRole("button", { name: "تسجيل الدخول بالحساب" }).click();
  await lock.getByLabel("اسم المستخدم").fill(username);
  await lock.getByLabel("كلمة المرور", { exact: true }).fill("Password for this live fixture");
  await lock.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(lock).toBeHidden();
}

async function pushPatient(page: Page, orgId: string, proof: "valid" | "missing" | "invalid") {
  return page.evaluate(async ({ orgId, proof }) => {
    const path = "/src/";
    const { db } = await import(`${path}db/database.ts`) as typeof import("../src/db/database");
    const { getActiveMembershipId } = await import(`${path}auth/session.ts`) as typeof import("../src/auth/session");
    const { getDeviceId } = await import(`${path}db/deviceRegistration.ts`) as typeof import("../src/db/deviceRegistration");
    const { runPullCycle, runSyncCycle } = await import(`${path}sync/engine.ts`) as typeof import("../src/sync/engine");
    const { HttpTransport } = await import(`${path}sync/httpTransport.ts`) as typeof import("../src/sync/httpTransport");
    const device_id = getDeviceId();
    const device = await db.device.get(device_id);
    const deviceKey = await db.device_keys.get(device_id);
    const actor_membership_id = getActiveMembershipId();
    if (!actor_membership_id || !device?.token || !deviceKey) throw new Error("Live device must sign in first");

    const op_id = crypto.randomUUID();
    const entity_id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    await db.sync_ops.add({
      op_id, entity_id, actor_membership_id, created_at, device_id, entity: "patients", action: "create",
      payload: { id: entity_id, org_id: orgId, full_name: "مريض اختبار", created_at, phone: null, gender: null, birth_year: null, note: null, archived_at: null, rev: 1 },
      base_rev: null, synced_at: null, failure_count: 0, next_retry_at: null,
    });
    class ProbeTransport extends HttpTransport {
      override async pushOps(ops: Parameters<HttpTransport["pushOps"]>[0]) {
        return super.pushOps(ops.map((op) => {
          if (op.op_id !== op_id || proof === "valid") return op;
          return { ...op, proof: proof === "missing" ? null : "A".repeat(86) };
        }));
      }
    }
    const transport = new ProbeTransport({ token: device.token, deviceKey: async () => deviceKey.private_key });
    if (!device.identity_enforced_at) {
      await runPullCycle(db, transport);
      if (!(await db.device.get(device_id))?.identity_enforced_at) throw new Error("Pull must store the enforcement timestamp");
    }
    await runSyncCycle(db, transport);
    const outbox = await db.sync_ops.get(op_id);
    return { entityId: entity_id, synced: outbox?.synced_at != null, sealed: Boolean(outbox?.proof), reason: (await db.sync_review.toArray()).find((r) => r.op_id === op_id)?.reason };
  }, { orgId, proof });
}

test("an enforced organization accepts signed operations and shows the three identity refusals", async ({ browser }) => {
  await startApi();
  let orgId: string | undefined;
  try {
    const org = await provisionOrg();
    orgId = org.orgId;
    await fixture("prepare", orgId);
    const { page, context, errors } = await openDevice(browser, org, "identity");
    try {
      await accountSignIn(page, "live-owner");
      await accountSignIn(page, "live-assistant");
      await page.evaluate(() => {
        // Control when this test sends its outbox through the real transport.
        Object.defineProperty(document, "visibilityState", { value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await fixture("enforce", orgId);
      expect(await pushPatient(page, orgId, "valid")).toMatchObject({ synced: true, sealed: true });
      expect(await pushPatient(page, orgId, "missing")).toMatchObject({ synced: false, reason: "proof_missing" });
      expect(await pushPatient(page, orgId, "invalid")).toMatchObject({ synced: false, reason: "proof_invalid" });
      await fixture("deactivate", orgId);
      expect(await pushPatient(page, orgId, "valid")).toMatchObject({ synced: false, reason: "actor_deactivated" });

      await page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
      await expect(page.getByText("أُجري التغيير قبل تسجيل الدخول بكلمة المرور. على من أجراه تسجيل الدخول على هذا الجهاز.")).toBeVisible();
      await expect(page.getByText("لم يُحفظ التغيير لأن توقيعه غير صالح على هذا الجهاز. سجّل الدخول مرة أخرى باستخدام كلمة المرور.")).toBeVisible();
      await expect(page.getByText("لم يُحفظ التغيير لأن حساب من أجراه عُطّل قبل وصوله إلى الخادم.")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    await stopApi();
    if (orgId) await removeLiveOrgs([orgId]);
  }
});

test("an owner activates identity while two devices sync, and a pre-sign-in operation is refused with its Arabic label", async ({ browser }) => {
  await startApi();
  let orgId: string | undefined;
  try {
    const org = await provisionOrg();
    orgId = org.orgId;
    await fixture("prepare-rollout", orgId);
    const recoveryCode = await mintCode(org, "owner-recovery");
    const a = await openDevice(browser, org, "A");
    const b = await openDevice(browser, org, "B");
    try {
      await a.page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
      const lock = lockOverlay(a.page);
      await lock.getByRole("button", { name: "إنشاء حسابك" }).click();
      await lock.getByLabel("رقم هاتف مالك العيادة").fill(org.ownerPhone);
      await lock.getByLabel("رمز الاسترداد").fill(recoveryCode);
      await lock.getByLabel("اسم المستخدم").fill("live-owner");
      await lock.getByLabel("كلمة المرور الجديدة").fill("Password for this live fixture");
      await lock.getByRole("button", { name: "حفظ", exact: true }).click();
      await expect(lock).toBeHidden();

      // Signing in can nudge sync even in a hidden tab. Keep B's sync
      // traffic offline through that sign-in, while allowing the login.
      const sync = /\/api\/sync\/(push|pull|bootstrap)(\?.*)?$/;
      await b.page.route(sync, (route) => route.abort());
      const queued = await b.page.evaluate(async (orgId) => {
        const src = "/src/";
        const { db } = await import(`${src}db/database.ts`) as typeof import("../src/db/database");
        const { getActiveMembershipId } = await import(`${src}auth/session.ts`) as typeof import("../src/auth/session");
        const { getDeviceId } = await import(`${src}db/deviceRegistration.ts`) as typeof import("../src/db/deviceRegistration");
        const actor_membership_id = getActiveMembershipId();
        if (!actor_membership_id) throw new Error("A legacy owner session must be active on B");
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        const op_id = crypto.randomUUID();
        const id = crypto.randomUUID();
        const created_at = new Date().toISOString();
        await db.sync_ops.add({
          op_id, entity_id: id, actor_membership_id, created_at, device_id: getDeviceId(), entity: "patients", action: "create",
          payload: { id, org_id: orgId, full_name: "تغيير قبل تسجيل الدخول", created_at, phone: null, gender: null, birth_year: null, note: null, archived_at: null, rev: 1 },
          base_rev: null, synced_at: null, failure_count: 0, next_retry_at: null,
        });
        return op_id;
      }, orgId);
      await accountSignIn(b.page, "live-assistant");

      await sidebar(a.page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
      const settings = a.page.getByRole("dialog");
      await settings.getByRole("button", { name: "الدخول بكلمة المرور", exact: true }).click();
      await expect(settings.getByRole("list", { name: "حالة الأجهزة" }).getByRole("listitem")).toHaveCount(2);
      await settings.getByRole("button", { name: "تفعيل للكل", exact: true }).click();
      await settings.getByLabel("اكتب كلمة المرور الخاصة بك للتأكيد").fill("Password for this live fixture");
      await settings.getByRole("button", { name: "تأكيد", exact: true }).click();
      await expect(settings.getByText("الدخول بكلمة المرور مفعّل لجميع الموظفين.")).toBeVisible();
      await a.page.keyboard.press("Escape");
      await expect(settings).toBeHidden();

      const before = (await readStore<{ op_id: string; synced_at: string | null; proof?: string }>(b.page, "sync_ops")).find((op) => op.op_id === queued);
      expect(before?.synced_at).toBeNull();
      expect(before?.proof).toBeFalsy();
      await b.page.unroute(sync);
      const refused = await b.page.evaluate(async (opId) => {
        const src = "/src/";
        const { db } = await import(`${src}db/database.ts`) as typeof import("../src/db/database");
        const { getDeviceId } = await import(`${src}db/deviceRegistration.ts`) as typeof import("../src/db/deviceRegistration");
        const { runSyncCycle } = await import(`${src}sync/engine.ts`) as typeof import("../src/sync/engine");
        const { HttpTransport } = await import(`${src}sync/httpTransport.ts`) as typeof import("../src/sync/httpTransport");
        const device = await db.device.get(getDeviceId());
        const key = device && await db.device_keys.get(device.id);
        if (!device?.token || !key || device.identity_enforced_at) throw new Error("B must push its pre-sign-in operation before its next pull");
        await runSyncCycle(db, new HttpTransport({ token: device.token, deviceKey: async () => key.private_key }));
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        return (await db.sync_review.where("op_id").equals(opId).first())?.reason;
      }, queued);
      expect(refused).toBe("proof_missing");
      await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
      await expect(b.page.getByText("أُجري التغيير قبل تسجيل الدخول بكلمة المرور. على من أجراه تسجيل الدخول على هذا الجهاز.")).toBeVisible();

      const fromA = await pushPatient(a.page, orgId, "valid");
      const fromB = await pushPatient(b.page, orgId, "valid");
      expect(fromA).toMatchObject({ synced: true, sealed: true });
      expect(fromB).toMatchObject({ synced: true, sealed: true });
      await eventually([a, b], async () => {
        const [patientsA, patientsB] = await Promise.all([a, b].map((device) => readStore<{ id: string }>(device.page, "patients")));
        return patientsA.some(({ id }) => id === fromB.entityId) && patientsB.some(({ id }) => id === fromA.entityId);
      }, true);
      const staff = (await readStore<{ role: string; permissions?: string[] }>(b.page, "memberships")).find((member) => member.role === "assistant");
      expect(staff?.permissions).toEqual(["messages.send"]);
      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  } finally {
    await stopApi();
    if (orgId) await removeLiveOrgs([orgId]);
  }
});

test("a permission removed on A closes the gated action on B and rejects B's offline operation", async ({ browser }) => {
  await startApi();
  let orgId: string | undefined;
  try {
    const org = await provisionOrg();
    orgId = org.orgId;
    await fixture("prepare", orgId);
    const a = await openDevice(browser, org, "A");
    const b = await openDevice(browser, org, "B");
    try {
      await setUpClinic(a);
      await accountSignIn(a.page, "live-owner");
      await accountSignIn(b.page, "live-assistant");
      await fixture("enforce", orgId);
      await eventually([a, b], async () => {
        const devices = await Promise.all([a, b].map((d) => readStore<{ identity_enforced_at?: string }>(d.page, "device")));
        return devices.every((rows) => Boolean(rows[0]?.identity_enforced_at));
      }, true);

      await sidebar(a.page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
      const settings = a.page.getByRole("dialog");
      await settings.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
      const assistant = settings.getByRole("listitem").filter({ hasText: "Live Identity Assistant" });
      async function changeMessagePermission(checked: boolean) {
        await assistant.getByRole("button", { name: "الصلاحيات", exact: true }).click();
        await assistant.getByRole("switch", { name: /إرسال الرسائل/ }).setChecked(checked);
        await assistant.getByLabel("اكتب كلمة المرور الخاصة بك للتأكيد").fill("Password for this live fixture");
        await assistant.getByRole("button", { name: "تأكيد", exact: true }).click();
        await expect(assistant.getByRole("heading", { name: "الصلاحيات", exact: true })).toHaveCount(0);
      }

      await changeMessagePermission(true);
      const messages = sidebar(b.page).getByRole("button", { name: SIDEBAR.navMessages, exact: true });
      await eventually([b], () => messages.count(), 1);
      await messages.click();
      await b.context.setOffline(true);
      const opId = await b.page.evaluate(async () => {
        const src = "/src/";
        const { db } = await import(`${src}db/database.ts`) as typeof import("../src/db/database");
        const { saveTemplateBody } = await import(`${src}db/messages.ts`) as typeof import("../src/db/messages");
        const { MessageTemplateKey } = await import(`${src}domain/messageTemplates.ts`) as typeof import("../src/domain/messageTemplates");
        await saveTemplateBody(db, MessageTemplateKey.BookingConfirmation, "قالب اتكتب من الجهاز وهو غير متصل");
        return (await db.sync_ops.toArray()).find((op) => op.entity === "message_templates" && op.synced_at === null)?.op_id;
      });
      expect(opId).toBeTruthy();
      await changeMessagePermission(false);
      await b.context.setOffline(false);

      await eventually([b], () => messages.count(), 0);
      await eventually([b], async () => (await readStore<{ op_id: string; reason: string }>(b.page, "sync_review")).find((row) => row.op_id === opId)?.reason, "permission_denied");
      await b.page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
      await expect(b.page.getByText("لم يُحفظ التغيير لأن من أجراه لا يملك الصلاحية اللازمة.")).toBeVisible();
      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  } finally {
    await stopApi();
    if (orgId) await removeLiveOrgs([orgId]);
  }
});
