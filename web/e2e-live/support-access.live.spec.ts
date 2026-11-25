import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shotDirectory } from "../e2e/browserArtifacts";
import { expect, test } from "@playwright/test";
import { rowFor, sidebar, SIDEBAR } from "../e2e/support";
import { bookNew, nudge, openDevice, pushed, setUpClinic } from "./liveSupport";
import { provisionOrg, removeLiveOrgs, startAdmin, startApi, stopAdmin, stopApi } from "./liveServer";

const api = fileURLToPath(new URL('../../api/', import.meta.url));
const shots = shotDirectory('e2e/admin-shots');
function fixtureCommand(command: string, id = '', extra = '') {
  return JSON.parse(execFileSync('php', [api + 'scripts/panel-test-fixtures.php', command, id, extra], {
    cwd: api, env: { ...process.env, APP_ENV: 'testing', DB_DATABASE: 'clintra_test' }, encoding: 'utf8', windowsHide: true,
  }));
}

test('owner and panel open, read, and end a real support session', async ({ browser }) => {
  await startApi();
  await startAdmin();
  let orgId: string | undefined;
  let admin: { id: string; email: string; password: string; recovery: string } | undefined;
  try {
    const org = await provisionOrg();
    orgId = org.orgId;
    const owner = await openDevice(browser, org, 'A');
    const panel = await browser.newContext({ baseURL: 'http://127.0.0.1:8001' });
    const support = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const panelPage = await panel.newPage();
    const supportPage = await support.newPage();
    try {
      await setUpClinic(owner);
      await bookNew(owner, 'Live Support Patient');
      await expect.poll(async () => { await nudge(owner); return pushed(owner); }).toBe(true);
      await sidebar(owner.page).getByRole('button', { name: SIDEBAR.navSettings, exact: true }).click();
      const settings = owner.page.getByRole('dialog').first();
      await settings.getByRole('button', { name: 'دعم كلينترا' }).click();
      await settings.getByRole('button', { name: 'إنشاء كود دعم' }).click();
      const notice = settings.getByText(/كود الدعم: CLT-/);
      await expect(notice).toBeVisible();
      const code = (await notice.innerText()).match(/CLT(?:-[A-Z0-9]{4}){4}/)?.[0];
      expect(code).toBeTruthy();
      admin = fixtureCommand('create');
      await panelPage.goto('/panel/sign-in');
      await panelPage.getByLabel('البريد الإلكتروني', { exact: true }).fill(admin.email);
      await panelPage.getByLabel('كلمة السر', { exact: true }).fill(admin.password);
      await panelPage.getByLabel('كود التحقق', { exact: true }).fill(admin.recovery);
      await panelPage.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
      await panelPage.goto('/panel/support');
      await panelPage.getByLabel('كود الدعم', { exact: true }).fill(code!);
      await panelPage.getByRole('button', { name: 'دخول دعم', exact: true }).click();
      await panelPage.locator('.step-up[open] [name="otp"]').fill(fixtureCommand('otp', admin.id).otp);
      await panelPage.locator('.step-up[open] [data-confirm-step-up]').click();
      const link = panelPage.locator('[data-support-link]');
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href).toMatch(/#support=CLT-/);
      await supportPage.goto(href!);
      await expect(supportPage).not.toHaveURL(/#support=/);
      await expect(supportPage.locator('[data-support-device]')).toContainText('جهاز دعم — قراءة بس — بينتهي');
      await expect(rowFor(supportPage, 'Live Support Patient')).toBeVisible();
      await supportPage.screenshot({ path: `${shots}/b6b-live-support-day.png`, fullPage: true });
      const refused = await supportPage.evaluate(async () => {
        const request = indexedDB.open('clintra-support');
        const database: IDBDatabase = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const transaction = database.transaction('device', 'readonly');
          const getAll = transaction.objectStore('device').getAll();
          const devices: { token: string }[] = await new Promise((resolve, reject) => {
            getAll.onsuccess = () => resolve(getAll.result);
            getAll.onerror = () => reject(getAll.error);
          });
          return (await fetch('/api/sync/push', { method: 'POST', headers: {
            Authorization: `Bearer ${devices[0].token}`, 'Content-Type': 'application/json',
          }, body: JSON.stringify({ ops: [] }) })).status;
        } finally { database.close(); }
      });
      expect(refused).toBe(403);
      await expect.poll(async () => { await nudge(owner); return owner.page.locator('[data-support-sessions]:visible').count(); }).toBeGreaterThan(0);
      await expect(owner.page.locator('[data-support-sessions]:visible')).toContainText('فريق كلينترا عنده وصول للقراءة بس لحد');
      await owner.page.screenshot({ path: `${shots}/b6b-live-owner-session.png`, fullPage: true });
      await settings.getByRole('button', { name: 'إنهاء الدعم دلوقتي' }).click();
      await owner.page.getByRole('dialog').last().getByRole('button', { name: 'تأكيد الإنهاء' }).click();
      await expect(settings.getByText(/جهاز دعم كلينترا/)).toHaveCount(0);
      await expect.poll(async () => { await supportPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); return supportPage.getByText('انتهى وصول الدعم').count(); }).toBe(1);
      await expect(supportPage.getByText('انتهى وصول الدعم')).toBeVisible();
      expect(owner.errors).toEqual([]);
    } finally {
      await support.close();
      await panel.close();
      await owner.context.close();
    }
  } finally {
    if (admin) fixtureCommand('retire', admin.id);
    await stopAdmin();
    await stopApi();
    if (orgId) await removeLiveOrgs([orgId]);
  }
});
