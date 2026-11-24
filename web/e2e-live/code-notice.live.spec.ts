import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shotDirectory } from "../e2e/browserArtifacts";
import { expect, test } from "@playwright/test";
import { eventually, openDevice } from "./liveSupport";
import { provisionOrg, removeLiveOrgs, startAdmin, startApi, stopAdmin, stopApi } from "./liveServer";

const api = fileURLToPath(new URL('../../api/', import.meta.url));
function fixtureCommand(command: string, id = '', extra = '') {
  return JSON.parse(execFileSync('php', [api + 'scripts/panel-test-fixtures.php', command, id, extra], {
    cwd: api, env: { ...process.env, APP_ENV: 'testing', DB_DATABASE: 'clintra_test' }, encoding: 'utf8', windowsHide: true,
  }));
}

test('a panel mint appears on another clinic device through the real pull', async ({ browser }) => {
  await startApi();
  await startAdmin();
  let orgId: string | undefined;
  let admin: { id: string; email: string; password: string; recovery: string; org: string } | undefined;
  let others: string[] = [];
  try {
    const org = await provisionOrg();
    orgId = org.orgId;
    const a = await openDevice(browser, org, 'A');
    const b = await openDevice(browser, org, 'B');
    const panel = await browser.newContext({ baseURL: 'http://127.0.0.1:8001' });
    const page = await panel.newPage();
    try {
      await expect(b.page.locator('[data-code-notices]:visible')).toHaveCount(0);
      admin = fixtureCommand('create');
      others = fixtureCommand('solo', admin.id).others;
      await page.goto('/panel/sign-in');
      await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(admin.email);
      await page.getByLabel('كلمة السر', { exact: true }).fill(admin.password);
      await page.getByLabel('كود التحقق', { exact: true }).fill(admin.recovery);
      await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
      await page.goto(`/panel/clinic/${org.orgId}`);
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'طلب كود تفعيل جهاز' }) });
      await form.locator('[name="location_id"]').selectOption(org.locationId);
      await form.getByRole('button', { name: 'طلب كود تفعيل جهاز' }).click();
      await form.locator('[name="otp"]').fill(fixtureCommand('otp', admin.id).otp);
      await form.locator('[data-confirm-step-up]').click();
      await expect(page.locator('[data-minted-code]')).toContainText(/^CLT-/);
      await eventually([b], async () => b.page.locator('[data-code-notices]:visible').count(), 1);
      await expect(b.page.locator('[data-code-notices]:visible')).toContainText('فريق كلينترا أصدر كود تفعيل جهاز جديد للعيادة في');
      await eventually([a], async () => a.page.locator('[data-code-notices]:visible').count(), 1);
      await b.page.screenshot({ path: `${shotDirectory('e2e/admin-shots')}/b5-live-other-device-notice.png`, fullPage: true });
      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
    } finally {
      await panel.close();
      await a.context.close();
      await b.context.close();
    }
  } finally {
    if (admin) {
      fixtureCommand('restore', admin.id, JSON.stringify(others));
      fixtureCommand('retire', admin.id);
    }
    await stopAdmin();
    await stopApi();
    if (orgId) await removeLiveOrgs([orgId]);
  }
});
