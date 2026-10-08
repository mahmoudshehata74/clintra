import { expect, test } from "@playwright/test";
import { registrationStrings as S } from "../src/auth/registrationStrings";
import { AUTH, SIDEBAR } from "./support";

// contract/pin-hash.json's own precomputed testVector — reused verbatim
// rather than importing src/auth/pinHash.ts and calling hashPin() here:
// that module transitively imports contract/pin-hash.json as bare JSON,
// which Vite's browser/vitest builds resolve but Playwright's own
// Node-side TS loader does not.
const OWNER_PIN = "1234";
const OWNER_PIN_SALT = "000102030405060708090a0b0c0d0e0f";
const OWNER_PIN_HASH = "fd2f78617f352bccb028644658898796b04bbedaa07d06ee028bbf0fef35f068";

/**
 * The install-day path this task adds: an empty device (no ?seedDay, no
 * ?demo — see src/domain/appMode.ts) shows the activation screen instead
 * of silently seeding demo data, and a successful activation reaches a
 * working day screen with the memberships that just arrived.
 *
 * POST /api/devices/register is mocked, not real — this repo's e2e job
 * runs Playwright against a static `vite preview` build with no Laravel
 * process alongside it (.github/workflows/ci.yml's `e2e` and `api` jobs
 * are entirely separate). The real, full-stack check (a live API,
 * php artisan clintra:provision, an actual activation code) is done by
 * hand — see the task report, not this file. What this spec proves is
 * everything client-side: RegistrationScreen's fields and states,
 * db/registration.ts's bootstrap (writing rows the PIN screen can then
 * read), and App.tsx's registration gate.
 */
test("an empty device activates, then unlocks with the owner's PIN into a working day screen", async ({ page }) => {
  const orgId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const ownerName = "منى الشريف";

  await page.route("**/api/devices/register", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { device_id: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "1|test-plain-text-token-for-e2e-only",
        device_id: body.device_id,
        org_id: orgId,
        location_id: locationId,
        membership_id: membershipId,
        organization: { id: orgId, name: "عيادة تجريبية", plan_tier: "small", created_at: new Date().toISOString() },
        locations: [
          { id: locationId, org_id: orgId, name: "الفرع الرئيسي", address: "شارع التحرير", phone: "+20221234567", is_active: true },
        ],
        practitioners: [],
        memberships: [
          {
            id: membershipId,
            user_id: userId,
            org_id: orgId,
            role: "owner",
            location_scope: "all",
            practitioner_scope: "all",
            practitioner_id: null,
            pin_hash: OWNER_PIN_HASH,
            pin_salt: OWNER_PIN_SALT,
            is_active: true,
            rev: 1,
          },
        ],
        users: [{ id: userId, full_name: ownerName, phone: "+201001234567", email: null, is_active: true }],
      }),
    });
  });

  await page.goto("/");

  const activationForm = page.getByRole("dialog", { name: S.formAria });
  await expect(activationForm).toBeVisible();
  // The whole app shell — not just this dialog — is replaced, not layered
  // under it: App.tsx renders RegistrationScreen instead of AppShell while
  // unregistered, never alongside it.
  await expect(page.getByRole("button", { name: SIDEBAR.navDay })).toHaveCount(0);

  await activationForm.getByLabel(S.phoneLabel).fill("01001234567");
  await activationForm.getByLabel(S.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await activationForm.getByRole("button", { name: S.submitLabel }).click();

  // The confirmation names the organization registration just stored.
  await expect(activationForm.getByText(`${S.confirmationPrefix} عيادة تجريبية`, { exact: true })).toBeVisible();
  await activationForm.getByRole("button", { name: S.startLabel, exact: true }).click();

  // "ابدأ" leads to the lock screen's picker ("دخول العيادة").
  await expect(page.getByRole("dialog", { name: AUTH.lockOverlayAria }).getByText(AUTH.lockClinicPrompt)).toBeVisible();

  // The PIN screen now shows exactly the membership registration just
  // bootstrapped — proof db/registration.ts wrote rows LockScreen.tsx can
  // actually read, joined to the user for a real name, not a blank row.
  const lockOverlay = page.getByRole("dialog").filter({ hasText: ownerName });
  await expect(lockOverlay.getByRole("button", { name: new RegExp(ownerName) })).toBeVisible();
  await lockOverlay.getByRole("button", { name: new RegExp(ownerName) }).click();
  for (const digit of OWNER_PIN) {
    await lockOverlay.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(lockOverlay).toBeHidden();

  // Reached the real app shell — no demo patients or visits anywhere,
  // since this device's org/location came from registration, not
  // db/seed.ts (whose own emptiness guard is what makes this safe).
  await expect(page.getByRole("button", { name: SIDEBAR.navDay })).toBeVisible();
});

test("the activation form asks for exactly the code, then the owner's phone — no SMS step", async ({ page }) => {
  await page.goto("/");
  const activationForm = page.getByRole("dialog", { name: S.formAria });
  await expect(activationForm).toBeVisible();

  const inputs = activationForm.locator("input");
  await expect(inputs).toHaveCount(2);
  await expect(inputs.nth(0)).toHaveAccessibleName(S.codeLabel);
  await expect(inputs.nth(1)).toHaveAccessibleName(S.phoneLabel);
  await expect(activationForm.getByText(S.codeHint, { exact: true })).toBeVisible();
  // Not shown before activation (settled deviation).
  await expect(activationForm.getByText(S.confirmationPrefix)).toHaveCount(0);
});

test("an incomplete code is refused on the code field before anything is sent", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/devices/register", async (route) => {
    requests += 1;
    await route.abort();
  });
  await page.goto("/");
  const activationForm = page.getByRole("dialog", { name: S.formAria });
  await activationForm.getByLabel(S.codeLabel).fill("CLT-7F3K");
  await activationForm.getByLabel(S.phoneLabel).fill("01001234567");
  await activationForm.getByRole("button", { name: S.submitLabel }).click();

  await expect(activationForm.getByText(S.invalidCode)).toBeVisible();
  await expect(activationForm.getByLabel(S.codeLabel)).toHaveAttribute("aria-invalid", "true");
  expect(requests).toBe(0);
});

test("a server refusal shows its own message for the whole form", async ({ page }) => {
  await page.route("**/api/devices/register", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ message: "كود التفعيل ده مستخدم قبل كده" }),
    });
  });
  await page.goto("/");
  const activationForm = page.getByRole("dialog", { name: S.formAria });
  await activationForm.getByLabel(S.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await activationForm.getByLabel(S.phoneLabel).fill("01001234567");
  await activationForm.getByRole("button", { name: S.submitLabel }).click();

  await expect(activationForm.getByRole("alert")).toHaveText("كود التفعيل ده مستخدم قبل كده");
  await expect(activationForm.getByRole("button", { name: S.submitLabel })).toBeEnabled();
});

test("a phone that does not normalize is refused on the phone field", async ({ page }) => {
  await page.goto("/");
  const activationForm = page.getByRole("dialog", { name: S.formAria });
  await activationForm.getByLabel(S.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
  await activationForm.getByLabel(S.phoneLabel).fill("123");
  await activationForm.getByRole("button", { name: S.submitLabel }).click();

  await expect(activationForm.getByText(S.invalidPhone)).toBeVisible();
  await expect(activationForm.getByLabel(S.phoneLabel)).toHaveAttribute("aria-invalid", "true");
});
