import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { AUTH, lockOverlay, S } from "../e2e/support";
import { openDevice } from "./liveSupport";
import { provisionOrg, removeLiveOrgs, startApi, stopApi } from "./liveServer";

const exec = promisify(execFile);

function fixture(action: "prepare" | "enforce" | "deactivate", orgId: string) {
  return exec("php", [fileURLToPath(new URL("./identityFixture.php", import.meta.url)), action, orgId], {
    cwd: fileURLToPath(new URL("../../api/", import.meta.url)),
    env: { ...process.env, DB_DATABASE: "clintra_test" },
  });
}

async function accountSignIn(page: Page, username: string) {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  const lock = lockOverlay(page);
  await lock.getByRole("button", { name: "دخول بحساب" }).click();
  await lock.getByLabel("اسم المستخدم").fill(username);
  await lock.getByLabel("كلمة السر", { exact: true }).fill("Password for this live fixture");
  await lock.getByRole("button", { name: "دخول", exact: true }).click();
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
    return { synced: outbox?.synced_at != null, sealed: Boolean(outbox?.proof), reason: (await db.sync_review.toArray()).find((r) => r.op_id === op_id)?.reason };
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
      await expect(page.getByText(/التغيير ده اتعمل قبل الدخول بكلمة السر/)).toBeVisible();
      await expect(page.getByText(/التغيير ده مش موقّع من حساب على الجهاز ده/)).toBeVisible();
      await expect(page.getByText(/الحساب اللي عمل التغيير ده اتوقف قبل ما يوصل للسيرفر/)).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    await stopApi();
    if (orgId) await removeLiveOrgs([orgId]);
  }
});
