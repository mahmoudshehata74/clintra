import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const api = fileURLToPath(new URL('../../api/', import.meta.url));
const shots = fileURLToPath(new URL('../../web/e2e/admin-shots/', import.meta.url));
type Fixture = { id: string; email: string; password: string; recovery: string; org: string; logIds: string[] };
function fixtureCommand(command: string, id = '', extra = '') {
  return JSON.parse(execFileSync('php', [api + 'scripts/panel-test-fixtures.php', command, id, extra], { cwd: api, env: { ...process.env, APP_ENV: 'testing', DB_DATABASE: 'clintra_test' }, encoding: 'utf8', timeout: 30000 }));
}
function code(fixture: Fixture, offset = 0): string { return fixtureCommand('otp', fixture.id, String(offset)).otp; }
async function signIn(page: Page, fixture: Fixture, recovery = false) {
  await page.goto('/panel/sign-in');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(fixture.email);
  await page.getByLabel('كلمة السر', { exact: true }).fill(fixture.password);
  await page.getByLabel('كود التحقق', { exact: true }).fill(recovery ? fixture.recovery : code(fixture));
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
}
async function passwordFields(page: Page, fixture: Fixture) {
  await page.getByLabel('كلمة السر الحالية', { exact: true }).fill(fixture.password);
  await page.getByLabel('كلمة السر الجديدة', { exact: true }).fill('New-panel-password-456');
  await page.getByLabel('كرّر كلمة السر الجديدة', { exact: true }).fill('New-panel-password-456');
  await page.getByRole('button', { name: 'تغيير كلمة السر', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: shots + `b3-${test.info().project.name}-${test.info().title}-dialog.png` });
}
let fixture: Fixture;
test.beforeEach(async ({ context }) => {
  fixture = fixtureCommand('create');
  const hex = fixture.id.replaceAll('-', '').slice(0, 24).match(/.{4}/g)!.join(':');
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `2001:db8:${hex}` });
});
test.afterEach(async ({ page }, info) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: shots + `b3-${info.project.name}-${info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, fullPage: true });
  fixtureCommand('retire', fixture.id);
});

test('sign-in-totp-and-security', async ({ page, context }) => {
  const remote: string[] = []; page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:8001') && !request.url().startsWith('data:')) remote.push(request.url()); });
  const response = await page.goto('/panel/sign-in');
  expect(response!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response!.headers()['referrer-policy']).toBe('no-referrer');
  expect(response!.headers()['x-robots-tag']).toContain('noindex');
  expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
  const initial = (await context.cookies()).find(cookie => cookie.name === 'clintra_admin_session')!.value;
  await signIn(page, fixture);
  await expect(page).toHaveURL(/panel\/admin-log$/);
  await expect(page.getByRole('heading', { name: 'سجل الإدارة', exact: true })).toBeVisible();
  expect((await context.cookies()).map(cookie => cookie.name)).toEqual(['clintra_admin_session']);
  const cookie = (await context.cookies()).find(cookie => cookie.name === 'clintra_admin_session')!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Strict'); expect(cookie.secure).toBe(false); expect(cookie.value).not.toBe(initial);
  expect(remote).toEqual([]);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: shots + `b3-${test.info().project.name}-admin-log-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('sign-in-recovery-code-once', async ({ page }) => {
  await signIn(page, fixture, true); await expect(page).toHaveURL(/panel\/admin-log$/);
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page).toHaveURL(/panel\/sign-in$/);
  await signIn(page, fixture, true);
  await expect(page.getByRole('alert')).toHaveText('البيانات دي مش صح');
});

test('wrong-credentials', async ({ page }) => {
  await page.goto('/panel/sign-in');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(fixture.email);
  await page.getByLabel('كلمة السر', { exact: true }).fill('wrong-password');
  await page.getByLabel('كود التحقق', { exact: true }).fill(code(fixture));
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('البيانات دي مش صح');
});

test('database-and-http-rate-limits', async ({ page }) => {
  await page.goto('/panel/sign-in');
  for (let i = 0; i < 10; i++) {
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(fixture.email);
    await page.getByLabel('كلمة السر', { exact: true }).fill('wrong-password');
    await page.getByLabel('كود التحقق', { exact: true }).fill('wrong-code');
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(i < 5 ? 'البيانات دي مش صح' : 'محاولات كتير، استنى ربع ساعة');
  }
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(fixture.email);
  await page.getByLabel('كلمة السر', { exact: true }).fill('wrong-password');
  await page.getByLabel('كود التحقق', { exact: true }).fill('wrong-code');
  const refused = page.waitForResponse(response => response.url().endsWith('/sign-in') && response.status() === 429);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click(); await refused;
  await expect(page.getByRole('alert')).toHaveText('محاولات كتير، استنى ربع ساعة');
  await expect(page.locator('[data-screen="sign-in"] .logo')).toHaveText('C');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
  for (const label of ['البريد الإلكتروني', 'كلمة السر', 'كود التحقق']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await page.screenshot({ path: shots + `b3-review-${test.info().project.name}-http-429.png`, fullPage: true });
});

test('must-change-and-step-up-success', async ({ page }) => {
  fixtureCommand('retire', fixture.id); fixture = fixtureCommand('create', 'must');
  await signIn(page, fixture, true); await expect(page).toHaveURL(/panel\/change-password$/);
  await expect(page.getByText('لازم تغيّر كلمة السر الأول', { exact: true })).toBeVisible();
  await page.goto('/panel/admin-log'); await expect(page).toHaveURL(/panel\/change-password$/);
  await expect(page.getByRole('form', { name: 'فلاتر سجل الإدارة' })).toHaveCount(0);
  await page.screenshot({ path: shots + `b3-${test.info().project.name}-must-change-password.png`, fullPage: true });
  await passwordFields(page, fixture);
  await expect(page.getByRole('heading', { name: 'اكتب كود التحقق تاني' })).toBeVisible();
  await page.getByLabel('كود التحقق', { exact: true }).fill(code(fixture));
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(page).toHaveURL(/panel\/admin-log$/);
  await expect(page.locator('.notice[role="status"]')).toHaveText('اتغيّرت كلمة السر');
});

test('step-up-failure-and-lockout', async ({ page }) => {
  await signIn(page, fixture, true); await expect(page).toHaveURL(/panel\/admin-log$/);
  await page.getByRole('link', { name: 'تغيير كلمة السر', exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await passwordFields(page, fixture);
    const wrong = fixtureCommand('wrong-otp', fixture.id).otp;
    await page.getByLabel('كود التحقق', { exact: true }).fill(wrong);
    await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(i < 4 ? 'كود التحقق مش صح أو اتستخدم قبل كده' : 'اتقفلت كل جلساتك بعد محاولات غلط كتير، ادخل تاني بعد ربع ساعة');
  }
  await expect(page).toHaveURL(/panel\/sign-in$/);
  for (const row of fixtureCommand('sessions', fixture.id).sessions) expect(row.ended_at).not.toBeNull();
  await page.goto('/panel/admin-log'); await expect(page).toHaveURL(/panel\/sign-in$/);
});

test('idle-expiry', async ({ page }) => {
  await signIn(page, fixture); await expect(page).toHaveURL(/panel\/admin-log$/);
  fixtureCommand('idle', fixture.id); await page.reload(); await expect(page).toHaveURL(/panel\/sign-in$/);
});

test('log-filters-and-keyset-paging', async ({ page }) => {
  await signIn(page, fixture); await expect(page).toHaveURL(/panel\/admin-log$/);
  await page.getByLabel('المسؤول', { exact: true }).fill(fixture.id);
  await page.getByLabel('العيادة', { exact: true }).fill(fixture.org);
  await page.getByLabel('الإجراء', { exact: true }).selectOption({ label: 'إيقاف العيادة' });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  await page.getByLabel('من', { exact: true }).fill(today); await page.getByLabel('لحد', { exact: true }).fill(today);
  await page.getByLabel('عدد الصفوف').selectOption('1'); await page.getByRole('button', { name: 'تصفية', exact: true }).click();
  const rows = page.locator('tbody tr[data-seq]'); await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('td').nth(2)).toHaveText('إيقاف العيادة');
  expect(new URL(page.url()).searchParams.get('action')).toBe('org.disable');
  const first = await rows.first().getAttribute('data-seq');
  await page.getByRole('link', { name: 'الأقدم', exact: true }).click();
  await expect(rows).toHaveCount(1); expect(BigInt((await rows.first().getAttribute('data-seq'))!)).toBeLessThan(BigInt(first!));
  await expect(page.getByRole('link', { name: 'الأقدم', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'الأحدث', exact: true }).click();
  await expect(rows.first()).toHaveAttribute('data-seq', first!);
  await page.getByRole('link', { name: 'مسح الفلاتر', exact: true }).click();
  await expect(page).toHaveURL(/panel\/admin-log$/);
});

test('allowlist-on-off-and-untrusted-forwarding', async ({ page, request }) => {
  await page.goto('/panel/sign-in'); await expect(page.getByRole('heading', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
  const denied = await request.get('http://127.0.0.1:8002/panel/sign-in', { headers: { 'X-Forwarded-For': '192.0.2.1' } });
  expect(denied.status()).toBe(403); expect(await denied.text()).toBe('Forbidden');
  const allowed = await request.get('http://127.0.0.1:8003/panel/sign-in'); expect(allowed.status()).toBe(200);
});

test('sign-out', async ({ page }) => {
  await signIn(page, fixture); await expect(page).toHaveURL(/panel\/admin-log$/);
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page).toHaveURL(/panel\/sign-in$/);
  await page.goto('/panel/admin-log'); await expect(page).toHaveURL(/panel\/sign-in$/);
});

test('background-covers-scroll-height-in-light-and-dark', async ({ page }) => {
  await signIn(page, fixture); await expect(page).toHaveURL(/panel\/admin-log$/);
  const width = page.viewportSize()!.width;
  await page.setViewportSize({ width, height: 450 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const geometry = await page.locator('body').evaluate((bodyElement) => {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(bodyElement);
      return { root: root.backgroundColor, body: body.backgroundColor, attachment: body.backgroundAttachment,
        height: bodyElement.getBoundingClientRect().height, scroll: document.documentElement.scrollHeight, viewport: innerHeight };
    });
    expect(geometry.scroll).toBeGreaterThan(geometry.viewport);
    expect(geometry.height).toBeGreaterThanOrEqual(geometry.scroll - 1);
    expect(geometry.root).toBe(geometry.body);
    expect(geometry.root).not.toBe('rgba(0, 0, 0, 0)');
    expect(geometry.attachment).toBe('scroll');
    await page.screenshot({ path: shots + `b3-review-${test.info().project.name}-background-${colorScheme}.png`, fullPage: true });
  }
});
