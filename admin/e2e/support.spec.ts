import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shotDirectory } from '../../web/e2e/browserArtifacts';
import { test, expect } from '../../web/node_modules/@playwright/test/index.mjs';

const api = fileURLToPath(new URL('../../api/', import.meta.url));
const shots = shotDirectory('e2e/admin-shots');
type Fixture = { id: string; email: string; password: string; recovery: string; org: string };
function fixtureCommand(command: string, id = '', extra = '') {
  return JSON.parse(execFileSync('php', [api + 'scripts/panel-test-fixtures.php', command, id, extra], {
    cwd: api, env: { ...process.env, APP_ENV: 'testing', DB_DATABASE: 'clintra_test' }, encoding: 'utf8', windowsHide: true,
  }));
}
let fixture: Fixture;
test.beforeEach(async ({ context }) => {
  fixture = fixtureCommand('create');
  fixtureCommand('b5', fixture.id);
  const hex = fixture.id.replaceAll('-', '').slice(0, 24).match(/.{4}/g)!.join(':');
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `2001:db8:${hex}` });
});
test.afterEach(() => fixtureCommand('retire', fixture.id));

async function signIn(page: import('../../web/node_modules/@playwright/test/index.mjs').Page) {
  await page.goto('/panel/sign-in');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(fixture.email);
  await page.getByLabel('كلمة السر', { exact: true }).fill(fixture.password);
  await page.getByLabel('كود التحقق', { exact: true }).fill(fixture.recovery);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await page.goto('/panel/support');
}
async function open(page: import('../../web/node_modules/@playwright/test/index.mjs').Page, code: string) {
  await page.getByLabel('كود الدعم', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'دخول دعم', exact: true }).click();
  await expect(page.locator('.step-up[open]')).toBeVisible();
  await page.locator('.step-up[open] [name="otp"]').fill(fixtureCommand('otp', fixture.id).otp);
  await page.locator('.step-up[open] [data-confirm-step-up]').click();
}
async function capture(page: import('../../web/node_modules/@playwright/test/index.mjs').Page, state: string, project: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: `${shots}/b6b-${project}-${state}-${theme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('support link is shown once and never appears in session or log', async ({ page }, info) => {
  await signIn(page);
  await capture(page, 'entry', info.project.name);
  const code = fixtureCommand('support-code', fixture.id).code;
  await open(page, code.slice(4));
  const link = page.locator('[data-support-link]');
  await expect(link).toHaveText('افتح التطبيق');
  await expect(page.getByText('الرابط ده شغال دقيقتين بس')).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/\/#support=CLT-/);
  const exchange = decodeURIComponent(href!.split('#support=')[1]);
  await capture(page, 'link', info.project.name);
  await page.reload();
  await expect(link).toHaveCount(0);
  await page.goto('/panel/admin-log');
  await expect(page.locator('body')).not.toContainText(exchange);
  const cookies = await page.context().cookies();
  expect(JSON.stringify(cookies)).not.toContain(exchange);
  await page.goto('/panel/support');
  await expect(page.locator('body')).not.toContainText(exchange);
});

for (const [reason, message] of [
  ['not_found', 'الكود ده مش صحيح'],
  ['used', 'الكود ده اتستخدم قبل كده'],
  ['expired', 'الكود ده خلص، اطلب من المالك كود جديد'],
  ['org_disabled', 'حساب العيادة موقوف'],
  ['no_owner', 'اللي عمل الكود مبقاش مالك للعيادة'],
  ['support_active', 'فيه دعم شغال للعيادة دي دلوقتي'],
] as const) {
  test(`support refusal ${reason}`, async ({ page }, info) => {
    await signIn(page);
    const code = reason === 'not_found' ? 'CLT-7F3K-9QRT-4XWM-2BCD'
      : fixtureCommand('support-code', fixture.id, JSON.stringify({ case: reason })).code;
    await open(page, code);
    await expect(page.getByRole('alert')).toHaveText(message);
    await capture(page, `refusal-${reason}`, info.project.name);
  });
}
