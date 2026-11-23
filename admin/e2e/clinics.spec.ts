import { test, expect, type Page } from '../../web/node_modules/@playwright/test/index.mjs';
import { shotDirectory } from '../../web/e2e/browserArtifacts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const api = fileURLToPath(new URL('../../api/', import.meta.url));
const shots = shotDirectory('e2e/admin-shots');
type Fixture = { id: string; email: string; password: string; recovery: string; org: string; orgName: string };
function command(action: string, id = '', extra = '') {
  return JSON.parse(execFileSync('php', [api + 'scripts/panel-test-fixtures.php', action, id, extra], {
    cwd: api, env: { ...process.env, APP_ENV: 'testing', DB_DATABASE: 'clintra_test' }, encoding: 'utf8',
  }));
}
let fixture: Fixture;
async function signIn(page: Page) {
  await page.goto('/panel/sign-in');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(fixture.email);
  await page.getByLabel('كلمة السر', { exact: true }).fill(fixture.password);
  await page.getByLabel('كود التحقق', { exact: true }).fill(fixture.recovery);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).toHaveURL(/panel\/admin-log$/);
}
async function screens(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.locator('[data-screen] header').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/b4-${test.info().project.name}-${name}-${colorScheme}.png` });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeEach(async ({ context }) => {
  fixture = command('create');
  command('clinic', fixture.id);
  const hex = fixture.id.replaceAll('-', '').slice(0, 24).match(/.{4}/g)!.join(':');
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `2001:db8:${hex}` });
});
test.afterEach(() => { command('retire', fixture.id); });

test('clinics-period-detail-and-responsive-cards', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'العيادات', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'العيادات', exact: true })).toBeVisible();
  for (const label of ['من', 'لحد']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('placeholder', 'YYYY-MM-DD');
    await page.getByLabel(label, { exact: true }).fill('2026-07-01');
  }
  await page.getByRole('button', { name: 'تصفية', exact: true }).click();
  const row = page.locator(`tr[data-org-id="${fixture.org}"]`);
  expect(new URL(page.url()).searchParams.get('from')).toBe('2026-07-01');
  await expect(row.locator('[data-figure="billed_piastres"]')).toHaveText('123.45');
  await expect(row.locator('[data-figure="collected_piastres"]')).toHaveText('100.01');
  const viewport = page.viewportSize()!;
  if (viewport.width <= 640) {
    await row.getByText('عرض التفاصيل', { exact: true }).click();
    await expect(row.locator('details')).toHaveAttribute('open', '');
    await expect(row.locator('details')).toContainText('المطلوب');
    await expect(row.locator('details')).toContainText('123.45');
  }
  await row.scrollIntoViewIfNeeded();
  await screens(page, 'clinics');
  await page.setViewportSize({ ...viewport, width: 640 });
  expect(await row.evaluate(element => getComputedStyle(element).display)).toBe('block');
  expect(await page.locator('.responsive-table').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ ...viewport, width: 641 });
  expect(await row.evaluate(element => getComputedStyle(element).display)).toBe('table-row');
  await page.setViewportSize(viewport);
  await row.getByRole('link', { name: fixture.orgName, exact: true }).click();
  await expect(page.getByRole('heading', { name: fixture.orgName, exact: true })).toBeVisible();
  await expect(page.locator('[data-clinic-name]')).toHaveText(fixture.orgName);
  await expect(page.locator('[data-location-name]')).toHaveText('فرع التجربة');
  await expect(page.getByText('شغّالة', { exact: true })).toBeVisible();
  await screens(page, 'clinic');
  await page.getByRole('link', { name: 'سجل الإدارة للعيادة', exact: true }).click();
  await expect(page.getByLabel('العيادة', { exact: true })).toHaveValue(fixture.org);
  const logs = page.locator('tr[data-log-id]');
  expect(await logs.count()).toBeGreaterThan(0);
  for (const log of await logs.all()) await expect(log.locator('[data-log-clinic]')).toHaveText(fixture.orgName);
  await expect(page.getByLabel('العيادة', { exact: true }).locator('option').first()).toHaveText('كل العيادات');
  await logs.first().getByText('عرض التفاصيل', { exact: true }).click();
  await expect(logs.first().locator('[data-log-org-id]')).toHaveText(fixture.org);
  if (viewport.width <= 640) expect(await logs.first().evaluate(element => getComputedStyle(element).display)).toBe('block');
  await screens(page, 'admin-log');
  await page.getByLabel('العيادة', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'تصفية', exact: true }).click();
  expect(new URL(page.url()).searchParams.get('org_id')).toBe('');
});

test('disable-reason-step-up-refusal-chip-and-enable', async ({ page }) => {
  await signIn(page);
  await page.goto('/panel/clinic/' + fixture.org);
  const reason = page.getByLabel('سبب الإيقاف', { exact: true });
  await expect(reason).toHaveAttribute('required', '');
  await expect(reason).toHaveAttribute('maxlength', '200');
  await reason.fill('سبب التجربة');
  await page.getByRole('button', { name: 'إيقاف العيادة', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await screens(page, 'clinic-step-up');
  await page.getByLabel('كود التحقق', { exact: true }).fill(command('wrong-otp', fixture.id).otp);
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('كود التحقق مش صح أو اتستخدم قبل كده');
  expect(command('org-state', fixture.id)).toEqual({ disabled_at: null, disabled_reason: null });
  await reason.fill('سبب التجربة');
  await page.getByRole('button', { name: 'إيقاف العيادة', exact: true }).click();
  await page.getByLabel('كود التحقق', { exact: true }).fill(command('otp', fixture.id).otp);
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(page.locator('.notice[role="status"]')).toHaveText('اتوقفت العيادة');
  await expect(page.locator('[data-disabled-reason]')).toContainText('سبب التجربة');
  await expect(page.locator('.state-chip')).toHaveText('موقوفة');
  await page.getByRole('link', { name: 'العيادات', exact: true }).click();
  const row = page.locator(`tr[data-org-id="${fixture.org}"]`);
  await expect(row.locator('.state-chip')).toHaveText('موقوفة');
  await row.scrollIntoViewIfNeeded();
  await screens(page, 'clinics-disabled');
  await row.getByRole('link', { name: fixture.orgName, exact: true }).click();
  await page.getByRole('button', { name: 'تشغيل العيادة', exact: true }).click();
  await page.getByLabel('كود التحقق', { exact: true }).fill(command('otp', fixture.id, '1').otp);
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  await expect(page.locator('.notice[role="status"]')).toHaveText('اشتغلت العيادة');
  await expect(page.locator('[data-clinic-state]')).toHaveText('شغّالة');
  expect(command('org-state', fixture.id)).toEqual({ disabled_at: null, disabled_reason: null });
});

test('invalid-period-and-unknown-clinic-refusals', async ({ page }) => {
  await signIn(page);
  for (const query of ['from=bad', 'from=2026-02-30', 'from=2026-07-02&to=2026-07-01', 'from=2024-01-01&to=2025-01-01']) {
    await page.goto('/panel/clinics?' + query);
    await expect(page.getByRole('alert')).toHaveText('راجع البيانات وحاول تاني');
    await expect(page.locator('tr[data-org-id]')).toHaveCount(0);
  }
  await page.goto('/panel/clinic/00000000-0000-0000-0000-000000000001');
  await expect(page.getByRole('alert')).toHaveText('البيانات دي مش موجودة');
});

test('hostile-clinic-and-location-names-stay-literal', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await signIn(page);
  for (const payload of ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '{{7*7}}']) {
    command('clinic', fixture.id, JSON.stringify({ name: payload, location: payload }));
    await page.goto('/panel/clinics');
    const row = page.locator(`tr[data-org-id="${fixture.org}"]`);
    await expect(row.locator('.clinic-name')).toHaveText(payload);
    await expect(row.locator('script,img,[onerror]')).toHaveCount(0);
    await row.getByRole('link').click();
    await expect(page.locator('[data-clinic-name]')).toHaveText(payload);
    await expect(page.locator('[data-location-name]')).toHaveText(payload);
    await expect(page.locator('[data-screen="clinic"] script,[data-screen="clinic"] img,[data-screen="clinic"] [onerror]')).toHaveCount(0);
    await page.getByRole('link', { name: 'سجل الإدارة للعيادة', exact: true }).click();
    for (const clinic of await page.locator('[data-log-clinic]').all()) await expect(clinic).toHaveText(payload);
    await expect(page.getByLabel('العيادة', { exact: true }).locator(`option[value="${fixture.org}"]`)).toHaveText(payload);
    await expect(page.locator('[data-screen="admin-log"] script,[data-screen="admin-log"] img,[data-screen="admin-log"] [onerror]')).toHaveCount(0);
  }
  expect(dialogs).toEqual([]);
});


test('clinic-cards-counter-danger-and-disabled-Cairo-summary', async ({ page }) => {
  await signIn(page);
  await page.goto('/panel/clinic/' + fixture.org);
  await expect(page.locator('h1')).toHaveText(fixture.orgName);
  await expect(page.getByRole('heading', { name: 'الفروع (1)', exact: true })).toBeVisible();
  await expect(page.locator('.location-card li')).toHaveText(['فرع التجربة']);
  const reason = page.getByLabel('سبب الإيقاف', { exact: true });
  const action = page.getByRole('button', { name: 'إيقاف العيادة', exact: true });
  await action.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#disable-reason-count')).toHaveText('0/200');
  await reason.fill('سبب التجربة');
  await expect(page.locator('#disable-reason-count')).toHaveText('11/200');
  const fieldBox = await reason.boundingBox();
  const formBox = await page.locator('.clinic-state-form').boundingBox();
  expect(Math.abs(fieldBox!.width - formBox!.width)).toBeLessThan(2);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await action.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await action.evaluate(element => { const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; element.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }));
  }
  await screens(page, 'review-clinic-enabled');
  await reason.fill('<img src=x onerror=alert(1)>');
  await action.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('كود التحقق', { exact: true }).fill(command('otp', fixture.id).otp);
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();
  const state = command('org-state', fixture.id);
  const minute = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(state.disabled_at));
  await expect(page.locator('[data-disabled-reason]')).toHaveText(`موقوفة من ${minute} — السبب: <img src=x onerror=alert(1)>`);
  await expect(page.locator('[data-disabled-reason] img')).toHaveCount(0);
  await expect(page.locator('[data-clinic-state]')).toHaveText('موقوفة');
  await expect(page.getByRole('button', { name: 'تشغيل العيادة', exact: true })).not.toHaveClass(/run-danger/);
  await screens(page, 'review-clinic-disabled');
  await page.getByRole('button', { name: 'تشغيل العيادة', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});


test('header-active-navigation-and-two-row-mobile-account', async ({ page }) => {
  await signIn(page);
  for (const [path, label, shot] of [
    ['/panel/clinics', 'العيادات', 'clinics'],
    ['/panel/clinic/' + fixture.org, 'العيادات', 'clinic'],
    ['/panel/admin-log?org_id=' + fixture.org, 'سجل الإدارة', 'log'],
  ]) {
    await page.goto(path);
    const active = page.locator('.panel-nav [aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveText(label);
    await expect(active).toHaveClass(/nav-active/);
    await screens(page, 'review-header-' + shot);
  }
  const viewport = page.viewportSize()!;
  for (const width of [390, 640]) {
    await page.setViewportSize({ ...viewport, width });
    const boxes = await page.locator('.panel-nav a').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { y: box.y, width: box.width }; }));
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThan(1);
    const header = await page.locator('.appbar').boundingBox();
    expect(header!.height).toBeLessThanOrEqual(130);
    await expect(page.getByRole('link', { name: 'تغيير كلمة السر', exact: true })).not.toBeVisible();
    const summary = page.locator('.mobile-account summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.mobile-account')).toHaveAttribute('open', '');
    await expect(page.getByRole('link', { name: 'تغيير كلمة السر', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تسجيل الخروج', exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.mobile-account')).not.toHaveAttribute('open', '');
  }
  await page.setViewportSize(viewport);
  if (viewport.width <= 640) {
    await page.locator('.mobile-account summary').click();
    await screens(page, 'review-header-account-open');
  } else {
    await expect(page.locator('.mobile-account')).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'تغيير كلمة السر', exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'تغيير كلمة السر', exact: true }).click();
  await expect(page).toHaveURL(/panel\/change-password$/);
});
